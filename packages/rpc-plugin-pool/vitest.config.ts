import { defineConfig } from 'vitest/config'
import { withDistFreshness } from '../../scripts/vitest-dist-freshness.mjs'

export default defineConfig(
  withDistFreshness({
    test: {
      maxWorkers: 1,
      coverage: {
        provider: 'v8',
        include: ['src/**/*.ts'],
        reporter: ['text-summary', 'json-summary']
      }
    }
  })
)
