import { defineConfig, devices } from '@playwright/test';

const externalURL = process.env.PLAYWRIGHT_BASE_URL;
const baseURL = externalURL || 'http://127.0.0.1:5174';
const python =
  process.platform === 'win32'
    ? '.venv/Scripts/python.exe'
    : '.venv/bin/python';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : 3,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      testIgnore: '**/iphone.spec.ts',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'iphone13-webkit',
      testMatch: [
        '**/iphone.spec.ts',
        '**/volume.spec.ts',
        '**/practice.spec.ts',
        '**/advanced-trading.spec.ts',
        '**/checkpoints.spec.ts',
        '**/alerts.spec.ts',
        '**/insecure-origin.spec.ts',
        '**/replay-follow.spec.ts',
        '**/comparison-price.spec.ts',
        '**/multi-comparison.spec.ts',
        '**/multi-interval.spec.ts',
      ],
      use: {
        ...devices['iPhone 13'],
        // A full-height app WebView has no Safari browser chrome.
        viewport: { width: 390, height: 844 },
      },
    },
  ],
  // Keep tests independent of the user's running workspace and browser storage.
  // Only the upstream Yahoo client is replaced; HTTP/API behavior stays real.
  webServer: externalURL
    ? undefined
    : [
        {
          name: 'Test engine',
          command: 'npm run build:engine && node dist-engine/server.cjs',
          url: 'http://127.0.0.1:8004/health',
          env: { ENGINE_PORT: '8004' },
          reuseExistingServer: false,
        },
        {
          name: 'Test API',
          command: `${python} -m uvicorn tests.support.api:app --host 127.0.0.1 --port 8002`,
          url: 'http://127.0.0.1:8002/api/health',
          env: {
            REPLAY_E2E: '1',
            REPLAY_ENGINE_URL: 'http://127.0.0.1:8004',
            REPLAY_DATA_DIR: `/tmp/replay-tests-${process.pid}`,
          },
          reuseExistingServer: false,
          gracefulShutdown: { signal: 'SIGTERM', timeout: 5_000 },
          timeout: 30_000,
        },
        {
          name: 'Test UI',
          command: 'npm run dev -- --host 127.0.0.1 --port 5174 --strictPort',
          url: baseURL,
          env: { REPLAY_API_TARGET: 'http://127.0.0.1:8002' },
          reuseExistingServer: false,
          gracefulShutdown: { signal: 'SIGTERM', timeout: 5_000 },
          timeout: 30_000,
        },
      ],
});
