import { defineConfig, type PlaywrightTestConfig } from '@playwright/test'
import { fileURLToPath } from 'node:url'

/** Select one engine for debugging; ordinary runs cover all three browser engines. */
const selectedBrowser = process.env.PLAYWRIGHT_BROWSER as
  | 'chromium'
  | 'webkit'
  | 'firefox'
  | undefined

/**
 * Firefox 153 still initializes shared application data despite Playwright's temporary profile.
 * macOS 27 protects that directory, so keep Firefox data in the disposable test output instead.
 * Remove this workaround once the bundled Firefox includes the Firefox 158 startup fix. See
 * https://github.com/microsoft/playwright/issues/42768.
 */
const firefoxEnvironment =
  process.platform === 'darwin'
    ? {
        ...process.env,
        MOZ_APP_DATA:
          process.env.MOZ_APP_DATA ??
          fileURLToPath(new URL('../../test-results/firefox/app-data/', import.meta.url)),
        MOZ_LOCAL_APP_DATA:
          process.env.MOZ_LOCAL_APP_DATA ??
          fileURLToPath(new URL('../../test-results/firefox/local-app-data/', import.meta.url))
      }
    : undefined

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  use: {
    baseURL: 'http://127.0.0.1:4180',
    trace: 'retain-on-failure'
  },
  projects: (selectedBrowser
    ? [selectedBrowser]
    : (['chromium', 'firefox', 'webkit'] as const)
  ).map((browserName): NonNullable<PlaywrightTestConfig['projects']>[number] => ({
    name: browserName,
    use: {
      browserName,
      launchOptions: {
        timeout: 30_000,
        env: browserName === 'firefox' ? firefoxEnvironment : undefined
      }
    }
  })),
  webServer: {
    command: '../../node_modules/.bin/vite --config test/e2e/vite.config.ts',
    cwd: new URL('../..', import.meta.url).pathname,
    port: 4180,
    reuseExistingServer: false,
    timeout: 30_000
  }
})
