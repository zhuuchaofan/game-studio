import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  // Serial on CI: parallel Chromium instances contend for the shared
  // runner's CPU (software rendering), which stalls the game loop and
  // makes phase waits time out in the longest multi-day flow tests.
  workers: process.env.CI ? 1 : undefined,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  // CI runners are slower (software rendering + parallel workers): the
  // multi-day flow tests need more than Playwright's 30s test default,
  // and phase/animation waits need more than the 5s expect default.
  timeout: 90000,
  expect: {
    timeout: 15000,
  },
  use: {
    baseURL: 'http://127.0.0.1:4173',
    viewport: { width: 1280, height: 720 },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run preview -- --port 4173 --host 127.0.0.1 --strictPort',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
  },
});
