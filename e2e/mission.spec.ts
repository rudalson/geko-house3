import { expect, test } from '@playwright/test';
import { E2E_SEED, collectConsoleErrors, snap, startGame } from './helpers.ts';

/**
 * 미션 진행 — 거실(미션 1)을 클리어하면 야외 캠프장(미션 2)으로 넘어간다.
 *
 * 단위 테스트(`tests/stages.test.ts`)가 배치·규칙을 보고, 여기서는 **실제 화면 흐름**을
 * 본다: 클리어 화면의 다음 미션 버튼, Enter 로 넘어가기, 씬·지도가 새 미션으로
 * 바뀌는지, 서바이벌 키트 모델이 404 없이 받아지는지(콘솔 에러 0).
 */

test('미션 1 클리어 → Enter → 미션 2(야외)가 시작된다', async ({ page }, testInfo) => {
  const { errors } = collectConsoleErrors(page);
  await startGame(page);

  expect(await page.evaluate(() => window.__GAME__.state.stage.id)).toBe('house');
  await expect(page.locator('.minimap-label')).toContainText('미션 1');

  await page.evaluate(() => window.__GAME__.debug.forceWin());
  await page.waitForFunction(() => window.__GAME__.state.phase === 'STAGE_CLEAR');

  const next = page.locator('[data-next]');
  await expect(next).toBeVisible();
  await expect(next).toContainText('미션 2');
  await snap(page, testInfo, 'mission1-clear');

  await page.keyboard.press('Enter');
  await page.waitForFunction(
    () => window.__GAME__.state.phase === 'PLAYING' && window.__GAME__.state.stage.id === 'outdoor',
  );

  // 새 판이다 — 영역·통계가 넘어오지 않는다.
  const s = await page.evaluate(() => ({
    owned: window.__GAME__.state.ownedCells,
    poops: window.__GAME__.state.stats.poops,
    solids: window.__GAME__.state.collision.solids.map((b) => b.id),
  }));
  expect(s.owned).toBe(0);
  expect(s.poops).toBe(0);
  expect(s.solids).toContain('camp-tent');
  expect(s.solids).not.toContain('sofa');

  await expect(page.locator('.result-screen')).not.toHaveClass(/visible/);
  await expect(page.locator('.minimap-label')).toContainText('캠프장');
  // 지도는 미션마다 하나다 — 바꿀 때 예전 것을 떼지 않으면 두 장이 겹친다.
  await expect(page.locator('.minimap')).toHaveCount(1);
  // 키트 모델로 지어졌는지 — 모델이 없으면 텐트가 상자 조립으로 떨어진다.
  // `game.scene` 은 비공개 필드라 타입에 없다. 런타임에는 그대로 읽힌다.
  const hasTent = await page.evaluate(() => {
    type Node = { name: string };
    const game = (window.__GAME__ as unknown as {
      game: { scene: { scene: { getObjectByName(n: string): Node | undefined } } };
    }).game;
    return game.scene.scene.getObjectByName('camp-tent') !== undefined;
  });
  expect(hasTent).toBe(true);

  await snap(page, testInfo, 'mission2-start');
  expect(errors, `콘솔 에러:\n${errors.join('\n')}`).toEqual([]);
});

test('미션 2: R 은 미션 2 를 다시 하고, 클리어하면 다음 미션 버튼이 없다', async ({
  page,
}, testInfo) => {
  const { errors } = collectConsoleErrors(page);

  await page.goto(`/?seed=${E2E_SEED}&stage=outdoor`);
  await page.waitForFunction(
    () => '__GAME__' in window && window.__GAME__.state.phase === 'TITLE',
    undefined,
    { timeout: 20_000 },
  );
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__GAME__.state.phase === 'PLAYING');
  expect(await page.evaluate(() => window.__GAME__.state.stage.id)).toBe('outdoor');

  // 야외에는 화장실이 없다 — 거실 문 자리에서 E 를 눌러도 화장실로 가지 않는다.
  await page.evaluate(() => window.__GAME__.debug.teleport(0.625, -5.9));
  expect(await page.evaluate(() => window.__GAME__.debug.interaction())).not.toBe('bathroom-enter');

  await page.evaluate(() => window.__GAME__.debug.forceGameOver());
  await page.waitForFunction(() => window.__GAME__.state.phase === 'GAME_OVER');
  await page.keyboard.press('KeyR');
  await page.waitForFunction(() => window.__GAME__.state.phase === 'PLAYING');
  expect(await page.evaluate(() => window.__GAME__.state.stage.id)).toBe('outdoor');

  await page.evaluate(() => window.__GAME__.debug.forceWin());
  await page.waitForFunction(() => window.__GAME__.state.phase === 'STAGE_CLEAR');
  await expect(page.locator('[data-title]')).toContainText('모든 미션 클리어');
  await expect(page.locator('[data-next]')).toBeHidden();
  await expect(page.locator('.result-stats')).toContainText('잔디깎이');

  // 마지막 미션에서 Enter 는 아무 일도 하지 않는다.
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.__GAME__.state.phase)).toBe('STAGE_CLEAR');

  await snap(page, testInfo, 'mission2-clear');
  expect(errors, `콘솔 에러:\n${errors.join('\n')}`).toEqual([]);
});
