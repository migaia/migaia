import { defineConfig } from '@playwright/test'
import { fileURLToPath } from 'node:url'

/** Reuse the old Chromium/Vite platform while keeping migrated tests outside Vitest discovery. */
export default defineConfig({
  testDir: fileURLToPath(new URL('.', import.meta.url)),
  testMatch: '*.browser.ts',
  timeout: 15_000,
  use: {
    baseURL: 'http://127.0.0.1:4173',
    browserName: 'chromium',
    headless: true
  },
  webServer: {
    command: 'pnpm exec vite --config test/browser/vite.config.ts',
    cwd: fileURLToPath(new URL('../..', import.meta.url)),
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false,
    timeout: 30_000
  }
})
