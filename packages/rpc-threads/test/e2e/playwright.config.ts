import { defineConfig, type PlaywrightTestConfig } from '@playwright/test'

/**
 * Chromium + WebKit fixed matrix, matching storage-web. Firefox cannot launch on the current macOS
 * host, so it runs only when PLAYWRIGHT_BROWSER selects it for single-engine debugging.
 */
const selectedBrowser = process.env.PLAYWRIGHT_BROWSER as
  | 'chromium'
  | 'webkit'
  | 'firefox'
  | undefined

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
  projects: (selectedBrowser ? [selectedBrowser] : (['chromium', 'webkit'] as const)).map(
    (browserName): NonNullable<PlaywrightTestConfig['projects']>[number] => ({
      name: browserName,
      use: { browserName }
    })
  ),
  webServer: {
    command: '../../node_modules/.bin/vite --config test/e2e/vite.config.ts',
    cwd: new URL('../..', import.meta.url).pathname,
    port: 4180,
    reuseExistingServer: false,
    timeout: 30_000
  }
})
