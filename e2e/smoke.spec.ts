import { expect, test, type Page } from '@playwright/test';
import { collectConsoleErrors, snap } from './helpers.ts';

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

test('부팅: 페이지가 콘솔 에러 없이 로드된다', async ({ page }, testInfo) => {
  const { errors } = collectConsoleErrors(page);

  await page.goto('/');
  await expect(page).toHaveTitle(/게코 하우스 서바이벌/);
  await expect(page.locator('#game-canvas')).toBeVisible();

  await snap(page, testInfo, '01-boot');
  expect(errors, `콘솔 에러:\n${errors.join('\n')}`).toEqual([]);
});

test('밸런스 모델과 BLOCKED 비율이 브라우저에서도 합격이다', async ({ page }) => {
  const { errors } = collectConsoleErrors(page);
  const logs: string[] = [];
  page.on('console', (m) => logs.push(m.text()));

  await page.goto('/');
  await page.waitForFunction(() => '__GAME__' in window);

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

  await page.goto('/');
  await page.waitForFunction(() => '__GAME__' in window);
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

  await page.goto('/');
  await page.waitForFunction(() => '__GAME__' in window);

  const before = await readPos(page);

  await page.keyboard.down('KeyD');
  await page.waitForTimeout(400);
  await page.keyboard.up('KeyD');
  await page.waitForTimeout(100);

  const after = await readPos(page);
  expect(after.x, `이동 전 ${JSON.stringify(before)} → 후 ${JSON.stringify(after)}`).toBeGreaterThan(
    before.x + 0.3,
  );

  // 키를 떼면 멈춘다
  await page.waitForTimeout(300);
  const stopped = await readPos(page);
  expect(Math.abs(stopped.x - after.x)).toBeLessThan(0.05);

  await snap(page, testInfo, '03-moved');
  expect(errors, `콘솔 에러:\n${errors.join('\n')}`).toEqual([]);
});

test('충돌: 벽 밖으로 나가지 못한다', async ({ page }, testInfo) => {
  const { errors } = collectConsoleErrors(page);

  await page.goto('/');
  await page.waitForFunction(() => '__GAME__' in window);

  // 오른쪽 아래로 계속 밀어붙인다
  await page.keyboard.down('KeyD');
  await page.keyboard.down('KeyS');
  await page.waitForTimeout(3000);
  await page.keyboard.up('KeyD');
  await page.keyboard.up('KeyS');

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

  await page.goto('/');
  await page.waitForFunction(() => '__GAME__' in window);

  const before = await page.evaluate(() => window.__GAME__.state.ownedCells);
  expect(before).toBe(0);
  await expect(page.locator('[data-ratio]')).toHaveText('0.0%');

  // §21-2: 디버그 API 로 똥 게이지를 채운 뒤 배변한다.
  await page.evaluate(() => window.__GAME__.debug.fillPoop());
  await expect(page.locator('.hud-signal')).toHaveClass(/visible/);

  await page.keyboard.press('Space');

  // 배변 애니메이션이 끝나야 영역이 확보된다 — 시작 즉시가 아니다
  await page.waitForFunction(() => window.__GAME__.state.ownedCells > 0, undefined, {
    timeout: 3000,
  });

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

  await page.goto('/');
  await page.waitForFunction(() => '__GAME__' in window);

  // 게이지가 비어 있는 상태 (시작 직후)
  expect(await page.evaluate(() => window.__GAME__.state.player.poop)).toBe(0);

  await page.keyboard.press('Space');
  await page.waitForTimeout(300);

  await expect(page.locator('.hud-toast')).toHaveClass(/visible/);
  expect(await page.evaluate(() => window.__GAME__.state.ownedCells)).toBe(0);

  expect(errors, `콘솔 에러:\n${errors.join('\n')}`).toEqual([]);
});

test('청소기: 똥 땅을 지우고 달성률이 감소한다', async ({ page }, testInfo) => {
  const { errors } = collectConsoleErrors(page);

  await page.goto('/');
  await page.waitForFunction(() => '__GAME__' in window);

  // 청소기 진행 경로 위에 영역을 깐다
  await page.evaluate(() => {
    const g = window.__GAME__;
    const v = g.state.vacuums[0]!;
    g.debug.teleport(v.pos.x, v.pos.z);
    g.debug.fillPoop();
  });
  await page.keyboard.press('Space');
  await page.waitForFunction(() => window.__GAME__.state.ownedCells > 0, undefined, {
    timeout: 3000,
  });

  const peak = await page.evaluate(() => window.__GAME__.state.ownedCells);
  await snap(page, testInfo, '06-before-cleaning');

  // 청소기가 지나가며 지우기를 기다린다
  await page.waitForFunction((p) => window.__GAME__.state.ownedCells < p, peak, {
    timeout: 15000,
  });

  const after = await page.evaluate(() => ({
    owned: window.__GAME__.state.ownedCells,
    erased: window.__GAME__.state.stats.erasedCells,
  }));

  expect(after.owned).toBeLessThan(peak);
  expect(after.erased, '지운 셀이 통계에 기록되어야 한다').toBeGreaterThan(0);

  await snap(page, testInfo, '07-after-cleaning');
  expect(errors, `콘솔 에러:\n${errors.join('\n')}`).toEqual([]);
});

test('청소기: 움직임이 읽힌다 — 직선 유지 후 예고 회전', async ({ page }) => {
  const { errors } = collectConsoleErrors(page);

  await page.goto('/');
  await page.waitForFunction(() => '__GAME__' in window);

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

  await page.goto('/');
  await page.waitForFunction(() => '__GAME__' in window);

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

  await page.goto('/');
  await page.waitForFunction(() => '__GAME__' in window);

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

  await page.goto('/');
  await page.waitForFunction(() => '__GAME__' in window);

  // 진행 상태를 만들어 둔다
  await page.evaluate(() => {
    const g = window.__GAME__;
    g.debug.fillPoop();
    g.state.player.foodsEaten = 25;
    g.state.stats.erasedCells = 40;
  });
  await page.keyboard.press('Space');
  await page.waitForFunction(() => window.__GAME__.state.ownedCells > 0, undefined, {
    timeout: 3000,
  });

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

  await page.goto('/');
  await page.waitForFunction(() => '__GAME__' in window);
  await page.waitForTimeout(600); // 첫 판 리소스가 GPU 에 올라갈 시간

  const baseline = await page.evaluate(() => window.__GAME__.debug.info());

  const counts: { geometries: number; textures: number }[] = [];
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => window.__GAME__.debug.restart());
    await page.waitForTimeout(600);
    const info = await page.evaluate(() => window.__GAME__.debug.info());
    counts.push({ geometries: info.geometries, textures: info.textures });
  }

  for (const [i, c] of counts.entries()) {
    expect(
      c.geometries,
      `${i + 1}회 재시작 후 geometry ${c.geometries} (첫 판 ${baseline.geometries})`,
    ).toBe(baseline.geometries);
    expect(
      c.textures,
      `${i + 1}회 재시작 후 texture ${c.textures} (첫 판 ${baseline.textures})`,
    ).toBe(baseline.textures);
  }

  expect(errors, `콘솔 에러:\n${errors.join('\n')}`).toEqual([]);
});

test('일시정지: Esc 로 멈추고 다시 눌러 재개한다', async ({ page }) => {
  const { errors } = collectConsoleErrors(page);

  await page.goto('/');
  await page.waitForFunction(() => '__GAME__' in window);

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

test('소크: 실제 키 입력으로 계속 플레이해도 상태가 망가지지 않는다', async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  const { errors } = collectConsoleErrors(page);

  await page.goto('/');
  await page.waitForFunction(() => '__GAME__' in window);

  // 페이지 안에서 실제 KeyboardEvent 를 쏜다 — InputManager 를 포함한
  // 입력 경로 전체를 그대로 통과시키기 위해서다. (치트 없음)
  const baseline = await page.evaluate(async () => {
    const g = window.__GAME__;
    g.debug.setTimeScale(2);

    const keys = ['KeyW', 'KeyA', 'KeyS', 'KeyD'];
    const press = (code: string, down: boolean): void => {
      window.dispatchEvent(
        new KeyboardEvent(down ? 'keydown' : 'keyup', { code, bubbles: true }),
      );
    };

    let held: string | null = null;
    const started = performance.now();
    let base = -1;

    while (performance.now() - started < 40_000) {
      // 지오메트리 기준선은 플레이가 시작된 뒤에 잡는다.
      // 음식 반짝임 링처럼 처음 보일 때 GPU 에 올라가는 것들이 있어서,
      // 시작 직후를 기준으로 삼으면 정상적인 지연 업로드가 누수로 잡힌다.
      if (base < 0 && performance.now() - started > 6_000) {
        base = g.debug.info().geometries;
      }
      // 방향을 자주 바꿔가며 방 전체를 훑는다
      const next = keys[Math.floor(Math.random() * keys.length)]!;
      if (held) press(held, false);
      press(next, true);
      held = next;

      // 상호작용과 배변을 섞는다
      press('KeyE', true);
      press('KeyE', false);
      press('Space', true);
      press('Space', false);

      await new Promise((r) => setTimeout(r, 220));
      if (g.state.phase !== 'PLAYING') break;
    }
    if (held) press(held, false);
    g.debug.setTimeScale(1);
    return { geometries: base, textures: g.debug.info().textures };
  });

  const after = await page.evaluate(() => {
    const s = window.__GAME__.state;
    return {
      info: window.__GAME__.debug.info(),
      phase: s.phase,
      x: s.player.pos.x,
      z: s.player.pos.z,
      hunger: s.player.hunger,
      foods: s.player.foodsEaten,
      standable: s.collision.canStand(s.player.pos, s.playerRadius),
      activeFoods: s.foods.filter((f) => f.active).length,
      vacuumOk: s.vacuums.every(
        (v) => Number.isFinite(v.pos.x) && Number.isFinite(v.pos.z),
      ),
    };
  });

  // 시뮬레이션이 실제로 진행됐다
  expect(after.info.elapsed, '시간이 흐르지 않았다').toBeGreaterThan(60);
  // 시스템이 살아 있다
  expect(after.hunger, '배고픔이 줄지 않았다 — HungerSystem 정지').toBeLessThan(100);
  expect(after.foods, '먹기가 한 번도 성공하지 않았다').toBeGreaterThan(0);
  // 상태가 깨지지 않았다
  expect(Number.isFinite(after.x) && Number.isFinite(after.z)).toBe(true);
  expect(after.standable, `플레이어가 설 수 없는 자리에 있다 (${after.x}, ${after.z})`).toBe(true);
  expect(after.vacuumOk).toBe(true);
  expect(after.activeFoods, '음식이 다시 스폰되지 않는다').toBeGreaterThan(0);
  // 지속 플레이 중에 리소스가 늘지 않는다 (재시작 누수는 별도 테스트가 본다)
  expect(after.info.geometries, '플레이 중 지오메트리가 계속 늘어난다').toBe(
    baseline.geometries,
  );
  expect(after.info.textures).toBe(baseline.textures);

  await snap(page, testInfo, '10-soak');
  expect(errors, `콘솔 에러:\n${errors.join('\n')}`).toEqual([]);
});

test('성능: 60fps 목표에서 프레임 드랍 누적이 없다', async ({ page }) => {
  const { errors } = collectConsoleErrors(page);

  await page.goto('/');
  await page.waitForFunction(() => '__GAME__' in window);
  await page.waitForTimeout(2000);

  const info = await page.evaluate(() => window.__GAME__.debug.info());

  // 헤드리스 렌더링은 실제 GPU 보다 느려서 프레임이 자주 늘어진다.
  // §0-5 대로 캐치업 한도를 넘긴 시간은 버려지므로 droppedTime 이 0 은 아니다.
  // 여기서 잡고 싶은 건 "죽음의 나선"(따라잡기가 계속 밀려 시뮬레이션이 정지)이다.
  expect(info.elapsed, `시뮬레이션이 실시간의 절반도 못 따라간다 (${info.elapsed}초/2초)`)
    .toBeGreaterThan(1.0);
  expect(info.droppedTime, `누락 시간 ${info.droppedTime}초 — 성능 문제`).toBeLessThan(1.0);

  expect(errors, `콘솔 에러:\n${errors.join('\n')}`).toEqual([]);
});
