import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';
// This workflow creates users/tickets; refuse every environment except the isolated local stack.
if (
  process.env.APP_URL !== 'https://localhost:3443' ||
  process.env.POSTGRES_DB !== 'central_production_validation' ||
  process.env.COMPOSE_PROJECT_NAME !== 'central-suporte-prod-validation'
)
  throw new Error('Production browser validation requires the isolated local validation stack');
export default defineConfig({
  testDir: './e2e',
  testMatch: 'workflow.spec.ts',
  workers: 1,
  retries: 0,
  timeout: 120000,
  reporter: 'list',
  outputDir: '../test-results/production',
  use: {
    baseURL: process.env.APP_URL,
    ignoreHTTPSErrors: true,
    viewport: { width: 1440, height: 1000 },
    launchOptions: existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
      ? { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' }
      : {},
    screenshot: 'only-on-failure',
  },
});
