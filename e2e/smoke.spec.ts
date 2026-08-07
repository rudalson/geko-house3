import { expect, test } from '@playwright/test';
import { collectConsoleErrors, snap } from './helpers.ts';

/**
 * §21-2 스모크 테스트.
 *
 * 현재는 S0 범위(부팅·코어 로드)만 검증한다.
 * S1~S5 진행에 따라 이동 → 음식 → 배변 → 달성률 → 승패 → 재시작 단계를 여기에 추가한다.
 */

test('부팅: 페이지가 콘솔 에러 없이 로드된다', async ({ page }, testInfo) => {
  const { errors } = collectConsoleErrors(page);

  await page.goto('/');
  await expect(page).toHaveTitle(/게코 하우스 서바이벌/);
  await expect(page.locator('#game-canvas')).toBeVisible();

  await snap(page, testInfo, '01-boot');
  expect(errors, `콘솔 에러:\n${errors.join('\n')}`).toEqual([]);
});

test('코어: 밸런스 모델이 브라우저에서 그대로 동작한다', async ({ page }) => {
  const { errors } = collectConsoleErrors(page);
  const logs: string[] = [];
  page.on('console', (m) => logs.push(m.text()));

  await page.goto('/');
  await expect(page.locator('#ui-root')).toContainText('게코 하우스 서바이벌');

  // main.ts 가 개발 모드에서 밸런스 요약을 출력한다.
  const balanceLog = logs.find((l) => l.startsWith('[balance]'));
  expect(balanceLog, `밸런스 로그를 찾지 못함. 수집된 로그:\n${logs.join('\n')}`).toBeDefined();
  expect(balanceLog).toContain('p*=0.573');

  expect(errors, `콘솔 에러:\n${errors.join('\n')}`).toEqual([]);
});
