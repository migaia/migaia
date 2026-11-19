import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'

/**
 * Panel tests (`*.test.tsx`) run in real Chromium; the bundle test (`*.test.ts`) runs in Node
 * because it spawns `bun build`.
 */
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'browser',
          include: ['test/**/*.test.tsx'],
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            instances: [{ browser: 'chromium' }]
          }
        }
      },
      { test: { name: 'node', include: ['test/**/*.test.ts'], environment: 'node' } }
    ]
  }
})
