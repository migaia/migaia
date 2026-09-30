import { defineConfig } from 'vite'
import { withDistFreshness } from '../../scripts/vitest-dist-freshness.mjs'

/** Runs elapsed-time scaling checks on demand, away from the default custody matrix. */
export default defineConfig(
  withDistFreshness({
    test: {
      include: ['bench/**/*.bench.ts'],
      fileParallelism: false
    }
  })
)
