import { defineConfig, type PlaywrightTestConfig } from '@playwright/test'

/** Chromium + WebKit 固定矩阵；PLAYWRIGHT_BROWSER 可用于本地单引擎调试。 */
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
  use: { baseURL: 'http://127.0.0.1:4180', trace: 'retain-on-failure' },
  projects: (selectedBrowser ? [selectedBrowser] : (['chromium', 'webkit'] as const)).map(
    (browserName): NonNullable<PlaywrightTestConfig['projects']>[number] => ({
      name: browserName,
      use: { browserName }
    })
  ),
  webServer: {
    command: '../../node_modules/.bin/vite --config e2e/vite.config.ts',
    cwd: new URL('..', import.meta.url).pathname,
    port: 4180,
    reuseExistingServer: false,
    timeout: 30_000
  }
})
