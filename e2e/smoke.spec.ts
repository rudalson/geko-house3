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

  await startGame(page);

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

  await startGame(page);

  const before = await page.evaluate(() => window.__GAME__.state.ownedCells);
  expect(before).toBe(0);
  await expect(page.locator('[data-ratio]')).toHaveText('0.0%');

  // §21-2: 디버그 API 로 똥 게이지를 채운 뒤 배변한다.
  await page.evaluate(() => window.__GAME__.debug.fillPoop());
  await expect(page.locator('.hud-signal')).toHaveClass(/visible/);

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

  // 청소기 진행 경로 위에 영역을 깐다
  await page.evaluate(() => {
    const g = window.__GAME__;
    const v = g.state.vacuums[0]!;
    g.debug.teleport(v.pos.x, v.pos.z);
    g.debug.fillPoop();
  });
  await page.keyboard.press('Space');

  // 관측을 **브라우저 안에서 끊김 없이** 한다.
  //
  // 청소기는 갓 깔린 영역 위에 있다가 곧 지나가 버린다. 감소가 보이는 창은
  // 짧다. Node 쪽에서 폴링하면 왕복 지연 동안 첫 삭제가 통째로 지나가고,
  // 그러면 청소기가 방을 한 바퀴 돌아 되돌아올 때까지 감소가 안 잡힌다.
  // (스위트 전체를 돌릴 때만 깨지던 이유가 이것이다 — 부하가 클수록 왕복이 느리다.)
  const result = await page.evaluate(async () => {
    const g = window.__GAME__;
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

test('소크: 실제 키 입력으로 계속 플레이해도 상태가 망가지지 않는다', async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  const { errors } = collectConsoleErrors(page);

  await startGame(page);

  // 씬이 실제로 들고 있는 리소스 수. 보이든 안 보이든 다 센다.
  const before = await page.evaluate(() => window.__GAME__.debug.sceneStats());
  const beforeTextures = await page.evaluate(() => window.__GAME__.debug.info().textures);

  // 페이지 안에서 실제 KeyboardEvent 를 쏜다 — InputManager 를 포함한
  // 입력 경로 전체를 그대로 통과시키기 위해서다. (치트 없음)
  const run = await page.evaluate(async () => {
    const g = window.__GAME__;
    g.debug.setTimeScale(2);

    const held = new Set<string>();
    const press = (code: string, down: boolean): void => {
      window.dispatchEvent(
        new KeyboardEvent(down ? 'keydown' : 'keyup', { code, bubbles: true }),
      );
    };
    /** 눌러야 할 이동 키 집합을 그대로 맞춘다 (누른 채 유지되는 키라서) */
    const hold = (want: string[]): void => {
      for (const code of held) if (!want.includes(code)) press(code, false);
      for (const code of want) if (!held.has(code)) press(code, true);
      held.clear();
      for (const code of want) held.add(code);
    };

    // `Math.random()` 을 쓰면 실행마다 다른 조작이 되어 실패를 재현할 수 없다.
    // 시드 고정 LCG 로 흔들기만 한다. (§0-5)
    let rngState = 0x1a2b3c4d;
    const rand = (): number => {
      rngState = (rngState * 1664525 + 1013904223) >>> 0;
      return rngState / 0x1_0000_0000;
    };

    let tick = 0;
    // **게임 시간** 기준으로 돈다. 벽시계로 재면 느린 기계에서 진행이 모자란다.
    const started = g.state.elapsed;
    const until = started + 80;
    const wallCap = performance.now() + 100_000; // 진행이 멈췄을 때의 탈출구

    while (g.state.elapsed < until && performance.now() < wallCap) {
      const s = g.state;
      const p = s.player.pos;

      // ── 어디로 갈지 ──
      // 순수 무작위 보행은 시작점 주변만 맴돌다 끝난다 — 음식은 6.5 units 밖에
      // 스폰되므로 한 번도 먹지 못하고, 그러면 이 소크는 "게임을 계속 돌린" 게
      // 아니라 "이동만 반복한" 게 된다. 가장 가까운 음식을 향하되 가끔 흔든다.
      let want: string[] = [];
      const shake = tick % 7 === 6;
      let goal: { x: number; z: number } | null = null;
      if (!shake) {
        let bestD = Infinity;
        for (const f of s.foods) {
          if (!f.active) continue;
          const d = Math.hypot(f.pos.x - p.x, f.pos.z - p.z);
          if (d < bestD) {
            bestD = d;
            goal = f.pos;
          }
        }
      }
      if (goal) {
        if (goal.x - p.x > 0.2) want.push('KeyD');
        else if (goal.x - p.x < -0.2) want.push('KeyA');
        if (goal.z - p.z > 0.2) want.push('KeyS');
        else if (goal.z - p.z < -0.2) want.push('KeyW');
      } else {
        // 흔들기 — 벽·가구 구석처럼 평소 안 가는 자리로도 밀어 넣는다.
        want = [(['KeyW', 'KeyA', 'KeyS', 'KeyD'] as const)[Math.floor(rand() * 4)]!];
      }
      hold(want);

      // ── 무엇을 누를지 ──
      // E 는 상황을 보고 누른다. 매 틱 누르면 가구를 올랐다 내렸다만 반복한다.
      const kind = g.debug.interaction();
      if (kind === 'food' || kind === 'treat' || tick % 13 === 12) {
        press('KeyE', true);
        press('KeyE', false);
      }
      // 게이지가 찼을 때만 싼다 — 빈 게이지로 누르면 안내 토스트만 쌓인다.
      if (s.player.poop >= g.debug.config.POOP_MAX) {
        press('Space', true);
        press('Space', false);
      }

      tick++;
      await new Promise((r) => setTimeout(r, 220));
      if (g.state.phase !== 'PLAYING') break;
    }
    hold([]);
    g.debug.setTimeScale(1);
    return { ticks: tick, elapsed: g.state.elapsed - started };
  });

  const after = await page.evaluate(() => {
    const s = window.__GAME__.state;
    return {
      info: window.__GAME__.debug.info(),
      phase: s.phase,
      stance: s.player.stance,
      x: s.player.pos.x,
      z: s.player.pos.z,
      hunger: s.player.hunger,
      foods: s.player.foodsEaten,
      climbedOn: s.player.climbedOn,
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
  // `canStand` 는 **거실 바닥에 서 있을 때만** 맞는 잣대다.
  // 이 소크는 E 를 계속 눌러서 가구 위·담요 밑·화장실로도 들어간다.
  // 가구 위 좌표는 solid AABB 한가운데(예: 협탁 3.6, 2.6)라 canStand 가 false 인데,
  // 그건 정상이다. 자세를 보지 않고 단정하면 게임이 멀쩡한데 테스트가 깨진다.
  if (after.stance === 'GROUND') {
    expect(after.standable, `설 수 없는 자리에 있다 (${after.x}, ${after.z})`).toBe(true);
  } else {
    // 특수 자세면 그 자세의 데이터가 맞아떨어져야 한다. 자세만 남고 대상이
    // 사라지면 내려올 수도, 이동 범위를 제한할 수도 없다.
    expect(
      after.stance === 'ON_FURNITURE' ? after.climbedOn !== null : true,
      `ON_FURNITURE 인데 올라탄 가구가 없다`,
    ).toBe(true);
  }
  expect(after.vacuumOk).toBe(true);
  expect(after.activeFoods, '음식이 다시 스폰되지 않는다').toBeGreaterThan(0);

  // 소크가 실제로 게임을 돌렸는지 (조작만 반복한 게 아니라)
  expect(run.elapsed, '게임 시간이 목표만큼 흐르지 않았다').toBeGreaterThan(60);
  expect(run.ticks, '입력 틱이 너무 적다').toBeGreaterThan(50);

  // ── 지속 플레이 중 리소스 (R5) ──
  //
  // `renderer.info.memory` 로 재면 안 된다. three.js 는 메시가 **처음 그려질 때**
  // 지오메트리를 올리므로, Lvl 2 에서 인간이 등장하면 아무것도 새로 만들지
  // 않았는데 카운트가 오른다 (실측: 57 → 59 → 62). 그걸 누수로 읽으면
  // 멀쩡한 코드를 고치게 된다.
  //
  // 씬 그래프가 참조하는 **서로 다른** 리소스 수를 보면 그 착시가 없다.
  // 이 값이 그대로면 한 판 내내 아무것도 새로 할당되지 않은 것이다.
  const scene = await page.evaluate(() => window.__GAME__.debug.sceneStats());
  expect(scene.geometries, `플레이 중 지오메트리가 늘었다 (${before.geometries} → ${scene.geometries})`)
    .toBe(before.geometries);
  expect(scene.materials, `플레이 중 머티리얼이 늘었다 (${before.materials} → ${scene.materials})`)
    .toBe(before.materials);
  expect(scene.objects, `플레이 중 씬 오브젝트가 늘었다 (${before.objects} → ${scene.objects})`)
    .toBe(before.objects);
  expect(after.info.textures, '텍스처가 늘었다').toBe(beforeTextures);

  await snap(page, testInfo, '10-soak');
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

test('성능: 60fps 목표에서 프레임 드랍 누적이 없다', async ({ page }) => {
  const { errors } = collectConsoleErrors(page);

  await startGame(page);

  // 시작 직후를 재면 안 된다. 그 구간에는 타이틀 페이드아웃·HUD 등장·처음
  // 보이는 메시의 지연 업로드가 몰려 있어서, 한 번뿐인 히치가 지속적인 성능
  // 문제로 보고된다. 이 테스트가 알고 싶은 건 **누적**이므로 정상 구간을 잰다.
  await advanceGameTime(page, 2);

  const before = await page.evaluate(() => {
    const d = window.__GAME__.debug.info();
    return { dropped: d.droppedTime, elapsed: d.elapsed };
  });
  await page.waitForTimeout(2000);
  const after = await page.evaluate(() => {
    const d = window.__GAME__.debug.info();
    return { dropped: d.droppedTime, elapsed: d.elapsed };
  });

  const simulated = after.elapsed - before.elapsed;
  const dropped = after.dropped - before.dropped;

  // 헤드리스 렌더링은 실제 GPU 보다 느려서 프레임이 자주 늘어진다.
  // §0-5 대로 캐치업 한도를 넘긴 시간은 버려지므로 droppedTime 이 0 은 아니다.
  // 여기서 잡고 싶은 건 "죽음의 나선"(따라잡기가 계속 밀려 시뮬레이션이 정지)이다.
  expect(simulated, `시뮬레이션이 실시간의 절반도 못 따라간다 (${simulated.toFixed(2)}초/2초)`)
    .toBeGreaterThan(1.0);
  expect(dropped, `벽시계 2초 동안 ${dropped.toFixed(2)}초를 버렸다 — 성능 문제`)
    .toBeLessThan(1.0);

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
  await page.keyboard.down('KeyD');
  await page.waitForFunction(() => window.__GAME__.debug.tutorialStep() !== 'move', undefined, {
    timeout: 10_000,
  });
  await page.keyboard.up('KeyD');

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
