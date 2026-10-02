import { configDefaults, defineConfig } from 'vitest/config'
import { withDistFreshness } from '../../scripts/vitest-dist-freshness.mjs'

/** Run the legacy parity aggregator after the default suite, avoiding two competing worker pools. */
export default defineConfig(
  withDistFreshness({
    test: {
      include: ['test/merge/suite-parity.test.ts'],
      exclude: [...configDefaults.exclude],
      fileParallelism: false,
      maxWorkers: 1,
      coverage: { enabled: false }
    }
  })
)
