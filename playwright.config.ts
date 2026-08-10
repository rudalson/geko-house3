import { defineConfig, devices } from '@playwright/test';

/**
 * §21-2 스모크 테스트.
 * 에이전트는 사람처럼 플레이할 수 없으므로 여기서 자동 검증한다.
 * 각 단계마다 스크린샷을 남기고 콘솔 에러를 수집한다.
 *
 * 두 개의 서버를 띄운다.
 *
 * - `dev` (5173) — 대부분의 테스트. `window.__GAME__` 로 내부 상태를 직접 본다.
 * - `prod` (4173) — 실제 빌드 산출물. 개발 훅이 **없는** 상태를 검증한다. (§19)
 *
 * 프로덕션 검증을 문자열 grep 대신 실제 실행으로 하는 이유: 번들에서 이름이
 * 사라져도 코드가 남아 있을 수 있고, 반대로 이름이 남아도 실행되지 않을 수 있다.
 * "눌러도 안 열린다"가 실제로 요구되는 성질이다.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  outputDir: './test-results',

  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    viewport: { width: 1280, height: 800 },
  },

  projects: [
    {
      name: 'chromium',
      testIgnore: /production\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], baseURL: 'http://localhost:5173' },
    },
    {
      name: 'production',
      testMatch: /production\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], baseURL: 'http://localhost:4173' },
    },
  ],

  webServer: [
    {
      command: 'npm run dev',
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      // 빌드까지 포함해야 소스 변경이 반영된다. 빌드가 실패하면 여기서 멈춘다.
      command: 'npm run build && npm run preview -- --port 4173 --strictPort',
      url: 'http://localhost:4173',
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
  ],
});
