import { expect, test, type Page } from '@playwright/test';
import {
  advanceGameTime,
  collectConsoleErrors,
  expectWithinGameTime,
  pressInteract,
  snap,
  startGame,
} from './helpers.ts';

/**
 * §21-2 스모크 테스트.
 *
 * 현재 검증 범위: 부팅 → 렌더 → 이동 → 충돌.
 * S2~S5 진행에 따라 음식 → 배변 → 달성률 → 승패 → 재시작 단계를 추가한다.
 */

/** 개발 모드에서 노출된 window.__GAME__ 을 통해 내부 상태를 읽는다. */
async function readPos(page: Page): Promise<{ x: number; z: number }> {
  return page.evaluate(() => ({
    x: window.__GAME__.state.player.pos.x,
    z: window.__GAME__.state.player.pos.z,
  }));
}

test('부팅: 로딩을 거쳐 타이틀에서 멈춘다', async ({ page }, testInfo) => {
  const { errors } = collectConsoleErrors(page);

  await page.goto('/');
  await expect(page).toHaveTitle(/게코 하우스 서바이벌/);
  await expect(page.locator('#game-canvas')).toBeVisible();

  // §16: 곧바로 플레이가 시작되지 않는다. 타이틀에서 입력을 기다려야 한다.
  await page.waitForFunction(
    () => '__GAME__' in window && window.__GAME__.state.phase === 'TITLE',
    undefined,
    { timeout: 20_000 },
  );
  await expect(page.locator('.title-screen')).toHaveClass(/visible/);
  await expect(page.locator('.loading-screen')).not.toHaveClass(/visible/);
  // 보류 기능은 타이틀에 안내만 노출한다 (ROADMAP §5)
  await expect(page.locator('.title-pending')).toContainText('열심히 싸는 중입니다');

  // 타이틀에서는 시간이 흐르지 않는다 — 뒤의 방은 그려지지만 판은 시작되지 않았다.
  await page.waitForTimeout(600);
  expect(await page.evaluate(() => window.__GAME__.state.elapsed)).toBe(0);

  await snap(page, testInfo, '01-title');
  expect(errors, `콘솔 에러:\n${errors.join('\n')}`).toEqual([]);
});

test('§0-6 오디오 언락: 타이틀 입력 전에는 AudioContext 를 만들지 않는다', async ({ page }) => {
  const { errors } = collectConsoleErrors(page);

  await page.goto('/');
  await page.waitForFunction(
    () => '__GAME__' in window && window.__GAME__.state.phase === 'TITLE',
    undefined,
    { timeout: 20_000 },
  );

  expect(
    await page.evaluate(() => window.__GAME__.debug.soundUnlocked()),
    '사용자 제스처 전에 AudioContext 를 만들면 브라우저가 경고를 남긴다',
  ).toBe(false);

  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__GAME__.state.phase === 'PLAYING');

  expect(
    await page.evaluate(() => window.__GAME__.debug.soundUnlocked()),
    '첫 입력에서 언락돼야 한다',
  ).toBe(true);

  expect(errors, `콘솔 에러:\n${errors.join('\n')}`).toEqual([]);
});

test('밸런스 모델과 BLOCKED 비율이 브라우저에서도 합격이다', async ({ page }) => {
  const { errors } = collectConsoleErrors(page);
  const logs: string[] = [];
  page.on('console', (m) => logs.push(m.text()));

  await startGame(page);

  const balanceLog = logs.find((l) => l.startsWith('[balance]'));
  expect(balanceLog, `밸런스 로그 없음:\n${logs.join('\n')}`).toBeDefined();
  // 정확한 값은 BalanceModel 이 계산한다. 여기서는 합격 범위만 확인해서
  // 상수를 조정할 때마다 E2E 를 고치지 않아도 되게 한다.
  const pStar = Number.parseFloat(/p\*=([\d.]+)/.exec(balanceLog!)?.[1] ?? '0');
  expect(pStar, `평형 점유율 ${pStar} 가 목표 0.44 를 넘지 못한다`).toBeGreaterThan(0.44);

  // 가구 배치에서 파생된 BLOCKED 비율이 허용 범위 안이어야 한다 (R1)
  const collisionLog = logs.find((l) => l.startsWith('[collision]'));
  expect(collisionLog, `충돌 로그 없음:\n${logs.join('\n')}`).toBeDefined();
  expect(collisionLog).toContain('✅');

  expect(errors, `콘솔 에러:\n${errors.join('\n')}`).toEqual([]);
});

test('렌더: 캔버스에 실제로 그려진다', async ({ page }, testInfo) => {
  const { errors } = collectConsoleErrors(page);

  await startGame(page);
  await page.waitForTimeout(500); // 첫 프레임들이 그려질 시간

  // gl.readPixels 는 쓸 수 없다. preserveDrawingBuffer: false 라 프레임이 끝나면
  // 드로잉 버퍼가 비워져 항상 빈 픽셀이 나온다. 렌더러 통계로 확인한다.
  const info = await page.evaluate(() => window.__GAME__.debug.info());

  expect(info.drawCalls, '드로우 콜이 0 — 아무것도 그려지지 않았다').toBeGreaterThan(0);
  expect(info.triangles, '삼각형이 0 — 지오메트리가 없다').toBeGreaterThan(100);
  expect(info.geometries, '지오메트리가 GPU 에 올라가지 않았다').toBeGreaterThan(0);

  await snap(page, testInfo, '02-rendered');
  expect(errors, `콘솔 에러:\n${errors.join('\n')}`).toEqual([]);
});

test('이동: 키 입력으로 좌표가 변한다', async ({ page }, testInfo) => {
  const { errors } = collectConsoleErrors(page);

  await startGame(page);

  const facing = (): Promise<number> =>
    page.evaluate(() => window.__GAME__.state.player.facing);

  // ── 선회 ──
  // 탱크 조작(§25)이라 A/D 는 **제자리에서 몸만 돌린다.** 좌표가 함께 변하면
  // 조작이 옛날 8방향으로 되돌아간 것이다.
  const spinFrom = await readPos(page);
  const headingFrom = await facing();

  await page.keyboard.down('KeyD');
  await page.waitForTimeout(300);
  await page.keyboard.up('KeyD');
  await page.waitForTimeout(100);

  expect(await facing(), 'D 를 눌러도 시선이 돌지 않는다').not.toBeCloseTo(headingFrom, 2);
  const spinTo = await readPos(page);
  expect(
    Math.hypot(spinTo.x - spinFrom.x, spinTo.z - spinFrom.z),
    '선회만 했는데 좌표가 움직였다',
  ).toBeLessThan(0.05);

  // ── 전진 ──
  const before = await readPos(page);
  const headingHeld = await facing();

  await page.keyboard.down('KeyW');
  await page.waitForTimeout(400);
  await page.keyboard.up('KeyW');
  await page.waitForTimeout(100);

  const after = await readPos(page);
  const travelled = Math.hypot(after.x - before.x, after.z - before.z);
  expect(travelled, `이동 전 ${JSON.stringify(before)} → 후 ${JSON.stringify(after)}`)
    .toBeGreaterThan(0.3);
  expect(await facing(), '전진했는데 시선이 흔들렸다').toBeCloseTo(headingHeld, 2);

  // 키를 떼면 멈춘다
  await page.waitForTimeout(300);
  const stopped = await readPos(page);
  expect(Math.hypot(stopped.x - after.x, stopped.z - after.z)).toBeLessThan(0.05);

  await snap(page, testInfo, '03-moved');
  expect(errors, `콘솔 에러:\n${errors.join('\n')}`).toEqual([]);
});

test('충돌: 벽 밖으로 나가지 못한다', async ({ page }, testInfo) => {
  const { errors } = collectConsoleErrors(page);

  await startGame(page);

  // 돌면서 계속 전진한다 — 곡선을 그리며 방을 훑어 벽·가구에 사방으로 부딪힌다.
  // 탱크 조작에서는 한 방향으로만 미는 것보다 이쪽이 더 많은 경계를 때린다. (§25)
  await page.keyboard.down('KeyW');
  await page.keyboard.down('KeyD');
  await page.waitForTimeout(3000);
  await page.keyboard.up('KeyW');
  await page.keyboard.up('KeyD');

  const pos = await readPos(page);
  const inside = await page.evaluate(() =>
    window.__GAME__.state.collision.canStand(
      window.__GAME__.state.player.pos,
      window.__GAME__.state.playerRadius,
    ),
  );

  expect(inside, `플레이어가 설 수 없는 위치에 있다: ${JSON.stringify(pos)}`).toBe(true);
  expect(Math.abs(pos.x)).toBeLessThanOrEqual(8);
  expect(Math.abs(pos.z)).toBeLessThanOrEqual(6);

  await snap(page, testInfo, '04-wall-collision');
  expect(errors, `콘솔 에러:\n${errors.join('\n')}`).toEqual([]);
});

test('배변: Space 로 영역이 확장되고 HUD 달성률이 오른다', async ({ page }, testInfo) => {
  const { errors } = collectConsoleErrors(page);

  await startGame(page);

  const before = await page.evaluate(() => window.__GAME__.state.ownedCells);
  expect(before).toBe(0);
  await expect(page.locator('[data-ratio]')).toHaveText('0.0%');

  // §21-2: 디버그 API 로 똥 게이지를 채운 뒤 배변한다.
  await page.evaluate(() => window.__GAME__.debug.fillPoop());
  await expect(page.locator('.hud-signal')).toHaveClass(/visible/);
  // 신호는 게이지 옆 배지 하나로 끝나지 않는다 — 줄 전체가 켜지고 토스트도 뜬다.
  // 알림이 약하다는 지적을 받은 자리라, 채널이 빠지면 테스트가 알려야 한다.
  await expect(page.locator('[data-poop-row]')).toHaveClass(/ready/);
  await expect(page.locator('.hud-toast')).toContainText('신호가 왔다');

  await page.keyboard.press('Space');

  // 배변 애니메이션이 끝나야 영역이 확보된다 — 시작 즉시가 아니다
  await expectWithinGameTime(
    page,
    () => window.__GAME__.state.ownedCells > 0,
    3,
    '배변 애니메이션이 끝나도 영역이 생기지 않는다',
  );

  const after = await page.evaluate(() => ({
    owned: window.__GAME__.state.ownedCells,
    ratio: window.__GAME__.state.territoryRatio,
    poop: window.__GAME__.state.player.poop,
  }));

  expect(after.owned).toBeGreaterThan(10);
  expect(after.poop, '배변 후 게이지가 초기화되어야 한다').toBe(0);

  // HUD 가 논리 격자 값과 일치하는지 (화면 색 분석이 아니라 데이터 기반, §26)
  const hudText = await page.locator('[data-ratio]').textContent();
  expect(Number.parseFloat(hudText!)).toBeCloseTo(after.ratio * 100, 0);

  await snap(page, testInfo, '05-poop-territory');
  expect(errors, `콘솔 에러:\n${errors.join('\n')}`).toEqual([]);
});

test('배변 차단: 게이지가 비면 안내만 뜨고 영역이 변하지 않는다', async ({ page }) => {
  const { errors } = collectConsoleErrors(page);

  await startGame(page);

  // 게이지가 비어 있는 상태 (시작 직후)
  expect(await page.evaluate(() => window.__GAME__.state.player.poop)).toBe(0);

  await page.keyboard.press('Space');
  await page.waitForTimeout(300);

  await expect(page.locator('.hud-toast')).toHaveClass(/visible/);
  expect(await page.evaluate(() => window.__GAME__.state.ownedCells)).toBe(0);

  expect(errors, `콘솔 에러:\n${errors.join('\n')}`).toEqual([]);
});

test('청소기: 똥 땅을 지우고 달성률이 감소한다', async ({ page }, testInfo) => {
  // 관측 예산이 게임 시간 20초다. 프레임이 밀리면 벽시계로는 그보다 오래 걸린다.
  test.setTimeout(90_000);
  const { errors } = collectConsoleErrors(page);

  await startGame(page);

  // 청소기에서 조금 떨어진 자리에 영역을 깐다.
  //
  // 예전에는 청소기 **발밑**에 깔았다. 그때는 통했다 — 청소기가 직선 구간이 끝날
  // 때마다 거의 반대 방향으로 돌아(평균 180도) 왔던 자리를 되밟았기 때문이다.
  // 지금은 덜 훑은 구역을 향해 떠나므로 그 자리로 곧장 돌아오지 않는다. 게다가
  // 발밑에 깔면 깔리는 순간 이미 지워져서, 관측이 시작될 때의 값이 곧 최고값이
  // 되어 "줄어드는 순간"을 영영 못 본다.
  await page.evaluate(() => {
    const g = window.__GAME__;
    const v = g.state.vacuums[0]!;
    // 청소기 주위를 한 바퀴 돌며 설 수 있는 자리를 찾는다. 가구 속은 피한다.
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const spot = { x: v.pos.x + Math.sin(a) * 2.5, z: v.pos.z + Math.cos(a) * 2.5 };
      if (g.state.collision.canStand(spot, g.state.playerRadius)) {
        g.debug.teleport(spot.x, spot.z);
        break;
      }
    }
    g.debug.fillPoop();
  });
  await page.keyboard.press('Space');

  // 배변이 끝나면 청소기를 그 자리로 향하게 한다.
  //
  // 이 테스트가 보려는 건 "청소기가 똥 땅 위를 지나가면 지워지는가"이지 "AI 가 그
  // 자리를 언제 고르는가"가 아니다. 경로 선택까지 얽으면 청소기가 방 반대편을
  // 훑는 시드에서만 깨지는 테스트가 된다. (커버리지는 tools/vacuum-coverage.ts 와
  // "한 자리에 갇히지 않는다" 단위 테스트가 따로 본다)
  await page.waitForFunction(() => window.__GAME__.state.player.poopAnimLeft === 0, undefined, {
    timeout: 10_000,
  });
  await page.evaluate(() => {
    const g = window.__GAME__;
    const v = g.state.vacuums[0]!;
    const p = g.state.player.pos;
    v.heading = Math.atan2(p.x - v.pos.x, p.z - v.pos.z);
    v.turnLeft = 0;
    v.straightLeft = 8;
  });

  // 관측을 **브라우저 안에서 끊김 없이** 한다.
  //
  // 청소기는 갓 깔린 영역 위에 있다가 곧 지나가 버린다. 감소가 보이는 창은
  // 짧다. Node 쪽에서 폴링하면 왕복 지연 동안 첫 삭제가 통째로 지나가고,
  // 그러면 청소기가 방을 한 바퀴 돌아 되돌아올 때까지 감소가 안 잡힌다.
  // (스위트 전체를 돌릴 때만 깨지던 이유가 이것이다 — 부하가 클수록 왕복이 느리다.)
  const result = await page.evaluate(async () => {
    const g = window.__GAME__;
    // 2.5 units 떨어져 있으니 4초면 닿는다. 나머지는 여유다.
    const until = g.state.elapsed + 20;
    let peak = 0;
    let pooped = false;

    while (g.state.elapsed < until) {
      const owned = g.state.ownedCells;
      if (owned > peak) {
        peak = owned;
        pooped = true;
      } else if (pooped && owned < peak) {
        return { peak, owned, erased: g.state.stats.erasedCells, ok: true };
      }
      await new Promise((r) => setTimeout(r, 16));
    }
    return { peak, owned: g.state.ownedCells, erased: g.state.stats.erasedCells, ok: false };
  });

  expect(result.peak, '배변이 완료되지 않았다').toBeGreaterThan(0);
  expect(result.ok, `게임 시간 20초 안에 영역이 줄지 않았다 (최고 ${result.peak}칸)`).toBe(true);
  expect(result.owned).toBeLessThan(result.peak);
  expect(result.erased, '지운 셀이 통계에 기록되어야 한다').toBeGreaterThan(0);

  await snap(page, testInfo, '06-after-cleaning');
  expect(errors, `콘솔 에러:\n${errors.join('\n')}`).toEqual([]);
});

test('청소기: 움직임이 읽힌다 — 직선 유지 후 예고 회전', async ({ page }) => {
  const { errors } = collectConsoleErrors(page);

  await startGame(page);

  // 4초 동안 heading 변화를 표본으로 모은다
  const samples = await page.evaluate(async () => {
    const out: { heading: number; turning: boolean }[] = [];
    for (let i = 0; i < 40; i++) {
      const v = window.__GAME__.state.vacuums[0]!;
      out.push({ heading: v.heading, turning: v.turnLeft > 0 });
      await new Promise((r) => setTimeout(r, 100));
    }
    return out;
  });

  // 회전하지 않는 동안에는 방향이 거의 고정이어야 한다 (읽히는 움직임)
  let jumpsWhileStraight = 0;
  for (let i = 1; i < samples.length; i++) {
    const prev = samples[i - 1]!;
    const cur = samples[i]!;
    if (prev.turning || cur.turning) continue;
    if (Math.abs(cur.heading - prev.heading) > 0.05) jumpsWhileStraight++;
  }

  expect(jumpsWhileStraight, '회전 연출 없이 방향이 튀면 회피를 학습할 수 없다').toBe(0);

  expect(errors, `콘솔 에러:\n${errors.join('\n')}`).toEqual([]);
});

test('클리어: 44% 도달 시 결과 화면이 뜬다', async ({ page }, testInfo) => {
  const { errors } = collectConsoleErrors(page);

  await startGame(page);

  await page.evaluate(() => window.__GAME__.debug.forceWin());
  await page.waitForFunction(() => window.__GAME__.state.phase === 'STAGE_CLEAR', undefined, {
    timeout: 3000,
  });

  await expect(page.locator('.result-screen')).toHaveClass(/visible/);
  await expect(page.locator('.result-screen')).toHaveClass(/cleared/);
  await expect(page.locator('[data-title]')).toContainText('44% 달성');

  // 결과 통계가 실제 상태와 맞는지
  const stats = await page.locator('.result-stats').textContent();
  expect(stats).toContain('생존 시간');
  expect(stats).toContain('청소기에게 지워진 셀');

  await snap(page, testInfo, '08-stage-clear');
  expect(errors, `콘솔 에러:\n${errors.join('\n')}`).toEqual([]);
});

test('게임 오버: 하트가 0 이면 결과 화면이 뜬다', async ({ page }, testInfo) => {
  const { errors } = collectConsoleErrors(page);

  await startGame(page);

  await page.evaluate(() => window.__GAME__.debug.forceGameOver());
  await page.waitForFunction(() => window.__GAME__.state.phase === 'GAME_OVER', undefined, {
    timeout: 3000,
  });

  await expect(page.locator('.result-screen')).toHaveClass(/visible/);
  await expect(page.locator('.result-screen')).not.toHaveClass(/cleared/);
  await expect(page.locator('[data-title]')).toContainText('게임 오버');
  expect(await page.evaluate(() => window.__GAME__.state.player.hearts)).toBe(0);

  await snap(page, testInfo, '09-game-over');
  expect(errors, `콘솔 에러:\n${errors.join('\n')}`).toEqual([]);
});

test('재시작: R 키로 상태가 완전히 초기화된다', async ({ page }) => {
  const { errors } = collectConsoleErrors(page);

  await startGame(page);

  // 진행 상태를 만들어 둔다
  await page.evaluate(() => {
    const g = window.__GAME__;
    g.debug.fillPoop();
    g.state.player.foodsEaten = 25;
    g.state.stats.erasedCells = 40;
  });
  await page.keyboard.press('Space');
  await expectWithinGameTime(
    page,
    () => window.__GAME__.state.ownedCells > 0,
    3,
    '배변이 완료되지 않는다',
  );

  await page.evaluate(() => window.__GAME__.debug.forceGameOver());
  await page.waitForFunction(() => window.__GAME__.state.phase === 'GAME_OVER');

  await page.keyboard.press('KeyR');
  await page.waitForFunction(() => window.__GAME__.state.phase === 'PLAYING', undefined, {
    timeout: 3000,
  });

  const fresh = await page.evaluate(() => {
    const s = window.__GAME__.state;
    return {
      hearts: s.player.hearts,
      owned: s.ownedCells,
      foods: s.player.foodsEaten,
      poop: s.player.poop,
      erased: s.stats.erasedCells,
      poops: s.stats.poops,
      elapsed: s.elapsed,
      hunger: s.player.hunger,
      vacuums: s.vacuums.length,
      activeFoods: s.foods.filter((f) => f.active).length,
    };
  });

  expect(fresh.hearts).toBe(3);
  expect(fresh.owned).toBe(0);
  expect(fresh.foods).toBe(0);
  expect(fresh.poop).toBe(0);
  expect(fresh.erased).toBe(0);
  expect(fresh.poops).toBe(0);
  expect(fresh.elapsed).toBeLessThan(1);
  expect(fresh.hunger).toBeGreaterThan(95);
  expect(fresh.vacuums, '재시작 후 청소기가 다시 배치되어야 한다').toBe(1);
  expect(fresh.activeFoods, '재시작 후 음식이 다시 스폰되어야 한다').toBeGreaterThan(0);

  await expect(page.locator('.result-screen')).not.toHaveClass(/visible/);
  expect(errors, `콘솔 에러:\n${errors.join('\n')}`).toEqual([]);
});

test('§8 누수: 3회 재시작해도 GPU 리소스가 누적되지 않는다', async ({ page }) => {
  const { errors } = collectConsoleErrors(page);

  await startGame(page);
  await page.waitForTimeout(600); // 첫 판 리소스가 GPU 에 올라갈 시간

  /**
   * 판정 지표는 **씬 그래프가 실제로 참조하는 리소스 수**다 (`sceneStats`).
   *
   * `renderer.info.memory` 를 쓰면 안 된다. three.js 는 지오메트리를 **처음
   * 그려질 때** GPU 에 올리므로, 그 값은 "무엇이 할당됐나" 가 아니라 "무엇이
   * 지금까지 화면에 나왔나" 를 센다. ROADMAP §3-8g 가 이 착시를 이미 짚고
   * R5 판정을 `sceneStats` 로 옮겼는데, 이 테스트만 옛 지표에 남아 있었다.
   *
   * 1인칭 전환(§25) 이 그걸 드러냈다. 카메라가 눈높이로 내려가면서 시야가
   * 좁아져 프러스텀 컬링이 훨씬 많이 걸리고, 그래서 **판마다 GPU 에 올라가는
   * 지오메트리가 달라진다** — 무엇을 쳐다보고 있었는지에 따라. 씬 그래프
   * 쪽은 판이 바뀌어도 정확히 같다 (실측 166/109/77 → 166/109/77).
   */
  const baseline = await page.evaluate(() => ({
    scene: window.__GAME__.debug.sceneStats(),
    textures: window.__GAME__.debug.info().textures,
  }));

  const counts: typeof baseline[] = [];
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => window.__GAME__.debug.restart());
    await page.waitForTimeout(600);
    counts.push(
      await page.evaluate(() => ({
        scene: window.__GAME__.debug.sceneStats(),
        textures: window.__GAME__.debug.info().textures,
      })),
    );
  }

  for (const [i, c] of counts.entries()) {
    const at = `${i + 1}회 재시작 후`;
    expect(
      c.scene.objects,
      `${at} 오브젝트 ${c.scene.objects} (첫 판 ${baseline.scene.objects})`,
    ).toBe(baseline.scene.objects);
    expect(
      c.scene.geometries,
      `${at} geometry ${c.scene.geometries} (첫 판 ${baseline.scene.geometries})`,
    ).toBe(baseline.scene.geometries);
    expect(
      c.scene.materials,
      `${at} material ${c.scene.materials} (첫 판 ${baseline.scene.materials})`,
    ).toBe(baseline.scene.materials);
    // 텍스처는 지연 업로드 대상이 아니라(생성 즉시 등록) 여전히 info 로 본다.
    expect(
      c.textures,
      `${at} texture ${c.textures} (첫 판 ${baseline.textures})`,
    ).toBe(baseline.textures);
  }

  expect(errors, `콘솔 에러:\n${errors.join('\n')}`).toEqual([]);
});

test('일시정지: Esc 로 멈추고 다시 눌러 재개한다', async ({ page }) => {
  const { errors } = collectConsoleErrors(page);

  await startGame(page);

  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__GAME__.state.phase === 'PAUSED', undefined, {
    timeout: 2000,
  });
  await expect(page.locator('.pause-overlay')).toHaveClass(/visible/);

  // 멈춘 동안에는 시간이 흐르지 않는다
  const t1 = await page.evaluate(() => window.__GAME__.state.elapsed);
  await page.waitForTimeout(700);
  const t2 = await page.evaluate(() => window.__GAME__.state.elapsed);
  expect(t2).toBe(t1);

  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__GAME__.state.phase === 'PLAYING', undefined, {
    timeout: 2000,
  });
  await expect(page.locator('.pause-overlay')).not.toHaveClass(/visible/);

  expect(errors, `콘솔 에러:\n${errors.join('\n')}`).toEqual([]);
});

test('은신·등반: E 로 진입하면 청소기 판정에서 빠지고 배변이 막힌다', async ({
  page,
}, testInfo) => {
  const { errors } = collectConsoleErrors(page);

  await startGame(page);

  // ── 가구 위로 ──
  await page.evaluate(() => window.__GAME__.debug.teleport(-4.5, -1.2));
  await pressInteract(page, 'climb-up');
  await page.waitForFunction(() => window.__GAME__.state.player.stance === 'ON_FURNITURE', undefined, {
    timeout: 3000,
  });
  await snap(page, testInfo, '11-on-furniture');

  // 가구 위에서는 배변이 막히고 안내만 뜬다
  await page.evaluate(() => window.__GAME__.debug.fillPoop());
  await page.keyboard.press('Space');
  // 안내 토스트는 몇 초 뒤 스스로 사라진다. 먼저 확인하고 시간을 흘린다.
  await expect(page.locator('.hud-toast')).toHaveClass(/visible/);
  await expect(page.locator('.hud-toast')).toContainText('여기선 못 싸');
  // 배변 애니메이션(1초)보다 길게 게임 시간이 흘러도 영역이 생기면 안 된다.
  await advanceGameTime(page, 1.4);
  expect(await page.evaluate(() => window.__GAME__.state.ownedCells)).toBe(0);

  await pressInteract(page, 'climb-down');
  await page.waitForFunction(() => window.__GAME__.state.player.stance === 'GROUND', undefined, {
    timeout: 3000,
  });

  // ── 담요 밑으로 ──
  await page.evaluate(() => window.__GAME__.debug.teleport(-5.8, 3.4));
  await pressInteract(page, 'blanket-hide');
  await page.waitForFunction(() => window.__GAME__.state.player.stance === 'HIDDEN', undefined, {
    timeout: 3000,
  });
  await snap(page, testInfo, '12-hidden');

  // 숨어 있으면 청소기가 덮쳐도 무사하다
  const hearts = await page.evaluate(() => {
    const s = window.__GAME__.state;
    s.vacuums[0]!.pos.x = s.player.pos.x;
    s.vacuums[0]!.pos.z = s.player.pos.z;
    return s.player.hearts;
  });
  await advanceGameTime(page, 1.0);
  expect(await page.evaluate(() => window.__GAME__.state.player.hearts)).toBe(hearts);

  expect(errors, `콘솔 에러:\n${errors.join('\n')}`).toEqual([]);
});

test('화장실: 변기 보너스가 영역을 덩어리로 확장하고 청소기를 늦춘다', async ({
  page,
}, testInfo) => {
  test.setTimeout(60_000);
  const { errors } = collectConsoleErrors(page);

  await startGame(page);

  // 문 앞으로 가서 화장실 진입
  await page.evaluate(() => {
    window.__GAME__.debug.teleport(0.5, -5.3);
    window.__GAME__.debug.fillPoop();
  });
  await pressInteract(page, 'bathroom-enter');
  await page.waitForFunction(() => window.__GAME__.state.player.stance === 'BATHROOM', undefined, {
    timeout: 3000,
  });

  // 화장실에서는 Space 배변이 막힌다
  await page.keyboard.press('Space');
  await advanceGameTime(page, 1.4);
  expect(await page.evaluate(() => window.__GAME__.state.ownedCells)).toBe(0);

  // 변기 사용
  await page.evaluate(() => window.__GAME__.debug.teleport(-1.8, -12.2));
  await pressInteract(page, 'toilet');
  await expectWithinGameTime(
    page,
    () => window.__GAME__.state.ownedCells > 0,
    20,
    '변기 보너스가 영역을 만들지 않는다',
  );

  const after = await page.evaluate(() => {
    const s = window.__GAME__.state;
    return {
      owned: s.ownedCells,
      expected: Math.round(s.effectiveCells * window.__GAME__.debug.config.TOILET_BONUS_RATIO),
      poop: s.player.poop,
      vacuumSlow: s.vacuums[0]?.slowLeft ?? 0,
    };
  });

  expect(after.owned).toBe(after.expected);
  expect(after.poop, '변기를 쓰면 게이지가 초기화된다').toBe(0);
  expect(after.vacuumSlow, '변기 보너스로 청소기가 감속해야 한다').toBeGreaterThan(0);

  await snap(page, testInfo, '13-toilet-bonus');
  expect(errors, `콘솔 에러:\n${errors.join('\n')}`).toEqual([]);
});

// ── S8 연출·UX 레이어 ────────────────────────────────────────────────────

test('파티클: 배변하면 터지고 스스로 사라진다', async ({ page }, testInfo) => {
  const { errors } = collectConsoleErrors(page);

  await startGame(page);

  expect(await page.evaluate(() => window.__GAME__.debug.particleCount()))
    .toBe(0);

  await page.evaluate(() => window.__GAME__.debug.fillPoop());
  await page.keyboard.press('Space');
  await expectWithinGameTime(
    page,
    () => window.__GAME__.debug.particleCount() > 0,
    4,
    '배변해도 파티클이 터지지 않는다',
  );

  const peak = await page.evaluate(() => window.__GAME__.debug.particleCount());
  expect(peak).toBeGreaterThan(5);
  await snap(page, testInfo, '14-particles');

  // 수명이 끝나면 풀로 돌아가야 한다 — 안 돌아가면 곧 풀이 마른다.
  await expectWithinGameTime(
    page,
    () => window.__GAME__.debug.particleCount() === 0,
    6,
    '파티클이 풀로 돌아오지 않는다',
  );

  expect(errors, `콘솔 에러:\n${errors.join('\n')}`).toEqual([]);
});

test('튜토리얼: 조건을 만족하면 다음 단계로 넘어간다', async ({ page }, testInfo) => {
  const { errors } = collectConsoleErrors(page);

  await startGame(page);

  // 1단계는 이동이다.
  expect(await page.evaluate(() => window.__GAME__.debug.tutorialStep())).toBe('move');
  await expect(page.locator('.tutorial')).toHaveClass(/visible/);
  await snap(page, testInfo, '15-tutorial');

  // 실제로 움직여서 넘긴다 — 치트로 단계를 건너뛰지 않는다.
  // 1단계 조건은 누적 이동 거리 3 units 라, 선회(A/D)만으로는 넘어가지 않는다.
  //
  // W 만 누르면 안 된다. 시작 지점(0, 0)에서 정면(+z)으로 1.2 units 앞에
  // 장난감 상자가 있어서 거기 박힌 채 3 units 를 못 채운다. W+D 로 돌면서
  // 나아가면 반지름 0.89 짜리 원을 그리며 빈 바닥을 돈다 — 가구에 걸리지 않고
  // 거리가 계속 쌓인다. (§25 탱크 조작)
  await page.keyboard.down('KeyW');
  await page.keyboard.down('KeyD');
  await page.waitForFunction(() => window.__GAME__.debug.tutorialStep() !== 'move', undefined, {
    timeout: 10_000,
  });
  await page.keyboard.up('KeyD');
  await page.keyboard.up('KeyW');

  expect(await page.evaluate(() => window.__GAME__.debug.tutorialStep())).toBe('eat');

  expect(errors, `콘솔 에러:\n${errors.join('\n')}`).toEqual([]);
});

test('디버그 패널: ` 로 열리고 밸런스 계측이 보인다 (§19)', async ({ page }, testInfo) => {
  const { errors } = collectConsoleErrors(page);

  await startGame(page);

  await expect(page.locator('.debug-panel')).toHaveCount(0);

  await page.keyboard.press('Backquote');
  await expect(page.locator('.debug-panel')).toHaveClass(/visible/, { timeout: 5000 });

  // R2 대응 — 예측이 아니라 실측 항이 화면에 떠 있어야 한다.
  const rows = page.locator('.debug-rows');
  await expect(rows).toContainText('G 증가율');
  await expect(rows).toContainText('S·p 감소율');
  await expect(rows).toContainText('순증가율');
  await snap(page, testInfo, '16-debug-panel');

  await page.keyboard.press('Backquote');
  await expect(page.locator('.debug-panel')).not.toHaveClass(/visible/);

  expect(errors, `콘솔 에러:\n${errors.join('\n')}`).toEqual([]);
});

test('음소거: M 으로 끄고 켤 수 있다', async ({ page }) => {
  const { errors } = collectConsoleErrors(page);

  await startGame(page);

  await page.keyboard.press('KeyM');
  await expect(page.locator('.hud-toast')).toContainText('음소거');

  await page.keyboard.press('KeyM');
  await expect(page.locator('.hud-toast')).toContainText('소리 켬');

  expect(errors, `콘솔 에러:\n${errors.join('\n')}`).toEqual([]);
});

// ── 짝 도마뱀·임신 (§24) ─────────────────────────────────────────────────

test('짝: 교미하면 느려지고, 임신이 끝나면 영역이 덩어리로 늘어난다', async ({
  page,
}, testInfo) => {
  // 임신 25초를 게임 시간으로 통과해야 한다. 벽시계로는 더 걸릴 수 있다.
  test.setTimeout(120_000);
  const { errors } = collectConsoleErrors(page);

  await startGame(page);

  // 등장만 앞당긴다. 교미·임신·산란은 실제 경로를 그대로 지난다.
  await page.evaluate(() => window.__GAME__.debug.summonMate());
  await expectWithinGameTime(
    page,
    () => window.__GAME__.state.mate.active,
    3,
    '짝이 나타나지 않는다',
  );
  await expect(page.locator('.hud-toast')).toContainText('짝이 나타났다');

  const before = await page.evaluate(() => {
    const s = window.__GAME__.state;
    // 음식이 겹쳐 있으면 먹기가 우선이라 E 가 짝으로 안 간다 (의도된 우선순위).
    for (const f of s.foods) f.active = false;
    for (const t of s.treats) t.active = false;
    window.__GAME__.debug.teleport(s.mate.pos.x, s.mate.pos.z);
    return { speed: s.moveSpeed, radius: s.playerRadius, owned: s.ownedCells };
  });
  expect(before.owned).toBe(0);

  await pressInteract(page, 'mate');
  await snap(page, testInfo, '17-mating');

  // ── 임신: 대가가 실제로 붙는가 ──
  await expectWithinGameTime(
    page,
    () => window.__GAME__.state.isPregnant,
    5,
    '교미해도 임신하지 않는다',
  );
  await expect(page.locator('.hud-preg')).toHaveClass(/visible/);

  const pregnant = await page.evaluate(() => {
    const s = window.__GAME__.state;
    return { speed: s.moveSpeed, radius: s.playerRadius };
  });
  expect(pregnant.speed, '임신해도 속도가 그대로다').toBeLessThan(before.speed);
  expect(pregnant.radius, '임신해도 히트박스가 그대로다').toBeGreaterThan(before.radius);

  // ── 산란 ──
  await expectWithinGameTime(
    page,
    () => window.__GAME__.state.player.eggsLaid > 0,
    35,
    '임신이 끝나도 산란하지 않는다',
  );

  const after = await page.evaluate(() => {
    const s = window.__GAME__.state;
    return {
      owned: s.ownedCells,
      expected: Math.round(s.effectiveCells * window.__GAME__.debug.config.MATE_EGG_BONUS_RATIO),
      speed: s.moveSpeed,
      pregnant: s.isPregnant,
      mateActive: s.mate.active,
      hatchlings: s.hatchlings.length,
    };
  });

  expect(after.owned, '산란 보너스가 반영되지 않았다').toBe(after.expected);
  expect(after.pregnant, '산란 후에도 임신 상태다').toBe(false);
  expect(after.speed, '산란 후에도 느리다 — 대가가 안 풀린다').toBeCloseTo(before.speed, 5);
  expect(after.mateActive, '산란 직후에 짝이 남아 있다').toBe(false);
  await expect(page.locator('.hud-preg')).not.toHaveClass(/visible/);

  // ── 새끼 ── 보상의 대부분이 여기에 있다 (§24, §3-8i)
  expect(after.hatchlings, '산란했는데 새끼가 없다').toBe(1);
  await expect(page.locator('.hud-hatch')).toHaveClass(/visible/);
  await expect(page.locator('.hud-toast')).toContainText('새끼가 태어났다');

  await snap(page, testInfo, '18-egg-laid');
  expect(errors, `콘솔 에러:\n${errors.join('\n')}`).toEqual([]);
});

test('새끼: 따라다니면서 플레이어 대신 영역을 넓힌다 (§24)', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const { errors } = collectConsoleErrors(page);

  await startGame(page);

  // 짝 → 교미까지는 위 테스트가 이미 검증한다. 여기서 보려는 것은 그 다음이다.
  await page.evaluate(() => window.__GAME__.debug.summonMate());
  await expectWithinGameTime(page, () => window.__GAME__.state.mate.active, 3, '짝이 나타나지 않는다');
  await page.evaluate(() => {
    const s = window.__GAME__.state;
    for (const f of s.foods) f.active = false;
    for (const t of s.treats) t.active = false;
    window.__GAME__.debug.teleport(s.mate.pos.x, s.mate.pos.z);
  });
  await pressInteract(page, 'mate');
  await expectWithinGameTime(page, () => window.__GAME__.state.isPregnant, 5, '임신하지 않는다');

  // 임신 25초를 그대로 기다리면 이 테스트만 40초를 잡아먹는다. 남은 시간만 줄인다 —
  // 산란·부화 경로 자체는 실제 코드가 그대로 지난다.
  await page.evaluate(() => {
    window.__GAME__.state.player.pregnantLeft = 0.3;
  });
  await expectWithinGameTime(
    page,
    () => window.__GAME__.state.hatchlings.length > 0,
    5,
    '산란했는데 새끼가 태어나지 않는다',
  );

  // ── 따라온다 ── 왼쪽으로 걸어가면 새끼도 따라와야 한다.
  const gapBefore = await page.evaluate(() => {
    const s = window.__GAME__.state;
    const h = s.hatchlings[0]!;
    // 일부러 멀찍이 떼어 놓고 시작한다.
    h.pos.x = s.player.pos.x + 3.5;
    return Math.hypot(h.pos.x - s.player.pos.x, h.pos.z - s.player.pos.z);
  });

  await expectWithinGameTime(
    page,
    () => {
      const s = window.__GAME__.state;
      const h = s.hatchlings[0];
      if (!h) return false;
      return Math.hypot(h.pos.x - s.player.pos.x, h.pos.z - s.player.pos.z) < 1.6;
    },
    8,
    `새끼가 따라오지 않는다 (${gapBefore.toFixed(2)} 에서 시작)`,
  );

  // ── 스스로 싼다 ── 플레이어는 게이지가 비어 있어 아무것도 못 한다.
  const ownedBefore = await page.evaluate(() => {
    window.__GAME__.state.player.poop = 0;
    return window.__GAME__.state.ownedCells;
  });

  await expectWithinGameTime(
    page,
    (owned) => window.__GAME__.state.ownedCells > owned,
    25,
    '새끼가 싸지 않아 영역이 늘지 않는다',
    ownedBefore,
  );

  const state = await page.evaluate(() => ({
    poop: window.__GAME__.state.player.poop,
    poops: window.__GAME__.state.stats.poops,
    hatchlings: window.__GAME__.state.hatchlings.length,
  }));
  expect(state.poop, '플레이어가 싼 게 아니어야 한다').toBe(0);
  expect(state.poops, '플레이어 배변 횟수가 늘었다 — 새끼의 몫이 아니다').toBe(0);
  expect(state.hatchlings).toBe(1);

  await snap(page, testInfo, '19-hatchling');
  expect(errors, `콘솔 에러:\n${errors.join('\n')}`).toEqual([]);
});
