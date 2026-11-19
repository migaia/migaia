import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'

/**
 * Every test runs in real Chromium (Blob URL imports, Web Crypto, Workers). The global setup runs
 * in Node: it builds the fixture modules with `partom remote build` and starts the fake catalog.
 */
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    globalSetup: ['test/global-setup.ts'],
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [{ browser: 'chromium' }]
    }
  }
})
