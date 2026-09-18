import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120000,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:3100',
    headless: true,
    viewport: { width: 1440, height: 1000 },
    launchOptions: existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
      ? { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' }
      : {},
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run start -- --port 3100',
    url: 'http://localhost:3100/login',
    reuseExistingServer: false,
    timeout: 60000,
    env: { APP_URL: 'http://localhost:3100', COOKIE_SECURE: 'false' },
  },
});
