import type { ConsoleMessage, Page, TestInfo } from '@playwright/test';

/**
 * 콘솔 에러 수집기. §21-2 는 "에러가 1건이라도 있으면 실패"를 요구한다.
 * 페이지를 열기 **전에** 붙여야 초기 로딩 에러를 놓치지 않는다.
 */
export function collectConsoleErrors(page: Page): { errors: string[] } {
  const errors: string[] = [];

  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error') errors.push(`[console] ${msg.text()}`);
  });
  page.on('pageerror', (err: Error) => {
    errors.push(`[pageerror] ${err.message}`);
  });
  page.on('requestfailed', (req) => {
    // 개발 서버 HMR 소켓 재연결은 무해하므로 제외한다.
    const url = req.url();
    if (url.includes('/@vite/client') || url.startsWith('ws')) return;
    errors.push(`[requestfailed] ${url} — ${req.failure()?.errorText ?? 'unknown'}`);
  });

  return { errors };
}

/** 단계별 스크린샷을 테스트 결과에 첨부한다. */
export async function snap(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const buffer = await page.screenshot();
  await testInfo.attach(name, { body: buffer, contentType: 'image/png' });
}
