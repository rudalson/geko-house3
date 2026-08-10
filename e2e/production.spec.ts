/**
 * 프로덕션 빌드 검증. (§19, S9 완료 조건 "콘솔 에러 0")
 *
 * 개발 서버가 아니라 **`vite build` 산출물**을 띄워 확인한다.
 * 여기서만 알 수 있는 것들이 있다.
 *
 *   - 디버그 UI 가 정말로 빠졌는지. 번들에서 문자열이 안 보이는 것과
 *     "눌러도 안 열린다"는 다르다. 요구되는 건 후자다.
 *   - 테스트용 전역 훅(`window.__GAME__`)이 사용자에게 노출되지 않는지.
 *   - DEV 전용 코드가 빠진 뒤에도 게임이 부팅되는지. 개발 서버에서만 돌던
 *     초기화가 있으면 여기서 드러난다.
 *
 * 내부 상태를 못 보므로 화면과 콘솔로만 판단한다 — 실제 사용자와 같은 조건이다.
 */

import { expect, test } from '@playwright/test';
import { collectConsoleErrors } from './helpers.ts';

test('프로덕션: 개발 훅 없이 부팅해서 타이틀까지 간다', async ({ page }, testInfo) => {
  const { errors } = collectConsoleErrors(page);

  await page.goto('/');
  await expect(page).toHaveTitle(/게코 하우스 서바이벌/);
  await expect(page.locator('#game-canvas')).toBeVisible();

  // 로딩을 지나 타이틀이 뜬다. 내부 상태를 못 보므로 화면으로 확인한다.
  await expect(page.locator('.title-screen')).toHaveClass(/visible/, { timeout: 30_000 });
  await expect(page.locator('.loading-screen')).not.toHaveClass(/visible/);

  // 테스트용 전역은 프로덕션에 있으면 안 된다 (§21-2 는 개발 모드 한정).
  expect(
    await page.evaluate(() => '__GAME__' in window),
    '개발용 전역 훅이 프로덕션 번들에 남아 있다',
  ).toBe(false);

  await testInfo.attach('prod-title', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  expect(errors, `콘솔 에러:\n${errors.join('\n')}`).toEqual([]);
});

test('프로덕션: 디버그 패널이 열리지 않는다 (§19)', async ({ page }) => {
  const { errors } = collectConsoleErrors(page);

  await page.goto('/');
  await expect(page.locator('.title-screen')).toHaveClass(/visible/, { timeout: 30_000 });

  await page.keyboard.press('Enter'); // 판 시작
  await expect(page.locator('.hud')).not.toHaveClass(/hidden/);

  // 개발 모드라면 여기서 패널이 동적으로 로드된다. 프로덕션에는 그 코드가 없다.
  await page.keyboard.press('Backquote');
  await page.waitForTimeout(1500); // 동적 import 가 있었다면 끝나고도 남을 시간
  await expect(page.locator('.debug-panel')).toHaveCount(0);

  // 없는 모듈을 부르려다 실패한 흔적도 없어야 한다.
  expect(errors, `콘솔 에러:\n${errors.join('\n')}`).toEqual([]);
});

test('프로덕션: 실제로 플레이가 진행된다', async ({ page }, testInfo) => {
  const { errors } = collectConsoleErrors(page);

  await page.goto('/');
  await expect(page.locator('.title-screen')).toHaveClass(/visible/, { timeout: 30_000 });
  await page.keyboard.press('Enter');

  // 배고픔 게이지가 줄어드는 것으로 시뮬레이션이 도는 걸 확인한다.
  // 내부 상태 대신 HUD 의 너비를 본다 — 사용자가 보는 것과 같은 신호다.
  const bar = page.locator('[data-hunger]');
  await expect(bar).toBeVisible();
  const width = async (): Promise<number> =>
    (await bar.evaluate((el) => el.getBoundingClientRect().width)) as number;

  const before = await width();
  await page.keyboard.down('KeyD');
  await page.waitForTimeout(2500);
  await page.keyboard.up('KeyD');

  expect(await width(), '배고픔이 줄지 않는다 — 시뮬레이션이 돌지 않았다').toBeLessThan(before);

  await testInfo.attach('prod-playing', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  expect(errors, `콘솔 에러:\n${errors.join('\n')}`).toEqual([]);
});
