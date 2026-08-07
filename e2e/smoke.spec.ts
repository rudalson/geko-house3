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
  return page.evaluate(() => {
    const g = (
      window as unknown as {
        __GAME__: { state: { player: { pos: { x: number; z: number } } } };
      }
    ).__GAME__;
    return { x: g.state.player.pos.x, z: g.state.player.pos.z };
  });
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
  expect(balanceLog).toContain('p*=0.575');

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
  const info = await page.evaluate(() => {
    const g = (
      window as unknown as { __GAME__: { debug: { info(): Record<string, number> } } }
    ).__GAME__;
    return g.debug.info();
  });

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
  const inside = await page.evaluate(() => {
    const g = (
      window as unknown as {
        __GAME__: {
          state: {
            player: { pos: { x: number; z: number } };
            playerRadius: number;
            collision: { canStand(p: { x: number; z: number }, r: number): boolean };
          };
        };
      }
    ).__GAME__;
    return g.state.collision.canStand(g.state.player.pos, g.state.playerRadius);
  });

  expect(inside, `플레이어가 설 수 없는 위치에 있다: ${JSON.stringify(pos)}`).toBe(true);
  expect(Math.abs(pos.x)).toBeLessThanOrEqual(8);
  expect(Math.abs(pos.z)).toBeLessThanOrEqual(6);

  await snap(page, testInfo, '04-wall-collision');
  expect(errors, `콘솔 에러:\n${errors.join('\n')}`).toEqual([]);
});

test('성능: 60fps 목표에서 프레임 드랍 누적이 없다', async ({ page }) => {
  const { errors } = collectConsoleErrors(page);

  await page.goto('/');
  await page.waitForFunction(() => '__GAME__' in window);
  await page.waitForTimeout(2000);

  const info = await page.evaluate(() => {
    const g = (
      window as unknown as { __GAME__: { debug: { info(): Record<string, number> } } }
    ).__GAME__;
    return g.debug.info();
  });

  // 튄 프레임은 Game 이 걸러내므로 캐치업 한도를 넘겨 버려지는 시간이 없어야 한다.
  expect(info.droppedTime, `누락 시간 ${info.droppedTime}초`).toBe(0);
  expect(info.elapsed, '시뮬레이션 시간이 실시간을 크게 밑돈다').toBeGreaterThan(1.5);

  expect(errors, `콘솔 에러:\n${errors.join('\n')}`).toEqual([]);
});
