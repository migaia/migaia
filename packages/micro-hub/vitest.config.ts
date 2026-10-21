import { defineConfig } from 'vitest/config'
import { withDistFreshness } from '../../scripts/vitest-dist-freshness.mjs'

/** Measure every source module while retaining the workspace dist-freshness guard. */
export default defineConfig(
  withDistFreshness({
    test: {
      coverage: {
        provider: 'v8',
        include: ['src/**/*.ts'],
        reporter: ['text', 'json-summary', 'json'],
        thresholds: {
          statements: 90,
          branches: 85,
          functions: 90,
          lines: 90
        }
      }
    }
  })
)
