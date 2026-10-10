import { configDefaults, defineConfig } from 'vitest/config'
import { withDistFreshness } from '../../scripts/vitest-dist-freshness.mjs'

/** Foreign peers and resource checks run explicitly, serially, against fresh public builds. */
export default defineConfig(
  withDistFreshness({
    test: {
      include: ['test/process/conformance*.test.ts', 'test/bridge/conformance-faults.test.ts'],
      exclude: [...configDefaults.exclude],
      fileParallelism: false,
      maxWorkers: 1,
      testTimeout: 120_000,
      hookTimeout: 120_000,
      coverage: { enabled: false }
    }
  })
)
