import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 45000,
  reporter: [['list']],
  outputDir: 'playwright-results',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: process.env.ORQIVA_CHROMIUM_PATH
      ? {
          executablePath: process.env.ORQIVA_CHROMIUM_PATH,
          args: ['--no-sandbox', '--disable-dev-shm-usage', '--no-zygote'],
        }
      : {},
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } },
    },
  ],
  webServer: {
    command: 'npm run test:e2e:server',
    url: 'http://127.0.0.1:4173/api/health',
    reuseExistingServer: false,
    timeout: 45000,
    env: {
      DATABASE_PATH: './data/e2e.db',
      PORT: '4173',
      NODE_ENV: 'test',
      SEED_DEMO: 'false',
      SEED_PASSWORD: 'E2ETestPassword2026!',
      COOKIE_SECURE: 'false',
    },
  },
});
