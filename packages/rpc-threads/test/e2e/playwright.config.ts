import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  use: {
    baseURL: 'http://127.0.0.1:4180',
    launchOptions: { timeout: 30_000 },
    trace: 'retain-on-failure'
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'firefox', use: { browserName: 'firefox' } },
    { name: 'webkit', use: { browserName: 'webkit' } }
  ],
  webServer: {
    command: '../../node_modules/.bin/vite --config test/e2e/vite.config.ts',
    cwd: new URL('../..', import.meta.url).pathname,
    port: 4180,
    reuseExistingServer: false,
    timeout: 30_000
  }
})
