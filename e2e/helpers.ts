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

/**
 * 페이지를 열고 **로딩 → 타이틀 → 플레이** 를 실제 흐름 그대로 통과한다. (§16)
 *
 * 타이틀을 건너뛰는 디버그 훅이 있지만 여기서는 쓰지 않는다.
 * 모든 테스트가 매번 이 경로를 지나면, 타이틀이 깨졌을 때 전용 테스트 하나가
 * 아니라 스위트 전체가 알려 준다.
 */
export async function startGame(page: Page): Promise<void> {
  await page.goto('/');

  await page.waitForFunction(
    () => '__GAME__' in window && window.__GAME__.state.phase === 'TITLE',
    undefined,
    { timeout: 20_000 },
  );

  // 타이틀은 "아무 키" 로 시작한다. Enter 는 게임 조작에 쓰이지 않아 부작용이 없다.
  await page.keyboard.press('Enter');

  await page.waitForFunction(() => window.__GAME__.state.phase === 'PLAYING', undefined, {
    timeout: 10_000,
  });
}

/** 단계별 스크린샷을 테스트 결과에 첨부한다. */
export async function snap(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const buffer = await page.screenshot();
  await testInfo.attach(name, { body: buffer, contentType: 'image/png' });
}
