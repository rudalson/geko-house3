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
/**
 * 모든 E2E 가 쓰는 고정 시드. (§0-5)
 *
 * 기본 시드는 `Date.now()` 라 실행할 때마다 음식·특식 배치가 달라진다.
 * 그러면 "가구 옆에서 E" 같은 테스트가 하필 그 자리에 음식이 스폰된 실행에서만
 * 깨진다 — 재현이 안 되니 원인도 못 찾는다. 시드를 박아 두면 실패가 재현된다.
 */
export const E2E_SEED = 20260810;

export async function startGame(page: Page, seed = E2E_SEED): Promise<void> {
  await page.goto(`/?seed=${seed}`);

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

/**
 * **게임 시간**이 `seconds` 만큼 흐를 때까지 기다린다.
 *
 * `waitForTimeout` 을 쓰면 안 되는 곳이 있다. 헤드리스 렌더는 프레임이 늘어지고
 * §0-5 대로 캐치업 한도를 넘긴 시간은 버려지므로, **벽시계 2초가 게임 시간 2초가
 * 아니다.** 느린 기계에서만 깨지는 테스트는 그 차이에서 나온다.
 */
export async function advanceGameTime(page: Page, seconds: number): Promise<void> {
  const from = await page.evaluate(() => window.__GAME__.state.elapsed);
  await page.waitForFunction(
    (target) => window.__GAME__.state.elapsed >= target,
    from + seconds,
    // 벽시계 여유는 넉넉히 준다 — 여기서 재는 건 시간이 아니라 진행이다.
    { timeout: Math.max(10_000, seconds * 4000) },
  );
}

/**
 * **게임 시간** `budget` 초 안에 조건이 참이 되기를 기다린다.
 *
 * `waitForFunction(..., { timeout })` 의 timeout 은 벽시계다. 그런데 기다리는
 * 대상은 대개 게임 시간으로 정의돼 있다 — 배변 애니메이션 1초, 청소기가
 * 돌아오는 데 걸리는 시간처럼. 헤드리스에서 프레임이 밀리면 게임 시간 1초가
 * 벽시계 3초를 넘고, 그러면 코드가 멀쩡한데도 테스트가 깨진다.
 * (실제로 "청소기: 똥 땅을 지우고" 가 이 이유로 간헐 실패했다.)
 *
 * 여기서는 예산을 게임 시간으로 주고, 벽시계 제한은 안전망으로만 쓴다.
 */
export async function expectWithinGameTime(
  page: Page,
  predicate: (arg: number) => boolean,
  budgetSec: number,
  message: string,
  // 조건이 바깥 값을 참조해야 할 때 넘긴다 (클로저는 페이지로 넘어가지 않는다).
  arg = 0,
): Promise<void> {
  const deadline = (await page.evaluate(() => window.__GAME__.state.elapsed)) + budgetSec;
  // 벽시계는 "게임이 아예 멈췄을 때" 를 위한 안전망일 뿐, 판정 기준이 아니다.
  const wallCap = Date.now() + Math.max(15_000, budgetSec * 4000);

  for (;;) {
    if (await page.evaluate(predicate, arg)) return;

    const elapsed = await page.evaluate(() => window.__GAME__.state.elapsed);
    if (elapsed >= deadline) {
      throw new Error(`${message} — 게임 시간 ${budgetSec}초 안에 일어나지 않았다`);
    }
    if (Date.now() > wallCap) {
      throw new Error(`${message} — 게임이 진행되지 않는다 (경과 ${elapsed.toFixed(1)}초)`);
    }
    await page.waitForTimeout(50);
  }
}

/**
 * `E` 가 원하는 대상을 가리킬 때까지 기다린다.
 *
 * 음식은 사정거리 안이면 등반·화장실보다 **항상 우선**이다 (InteractionSystem).
 * 그러니 순간이동 직후 곧바로 E 를 누르면 무엇이 실행될지 알 수 없다.
 * 무엇이 걸려 있는지 확인하고 누르면 실패했을 때 원인이 바로 보인다.
 */
export async function pressInteract(page: Page, expected: string): Promise<void> {
  await page.waitForFunction(
    (kind) => window.__GAME__.debug.interaction() === kind,
    expected,
    { timeout: 10_000 },
  );
  await page.keyboard.press('KeyE');
}

/** 단계별 스크린샷을 테스트 결과에 첨부한다. */
export async function snap(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const buffer = await page.screenshot();
  await testInfo.attach(name, { body: buffer, contentType: 'image/png' });
}
