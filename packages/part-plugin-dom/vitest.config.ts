import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'

/** Tests run in real Chromium: focus, top layer and adopted style sheets need a real browser. */
export default defineConfig({
  test: {
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [{ browser: 'chromium' }]
    }
  }
})
