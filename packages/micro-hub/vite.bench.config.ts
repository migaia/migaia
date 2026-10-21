import { defineConfig } from 'vitest/config'
import { withDistFreshness } from '../../scripts/vitest-dist-freshness.mjs'

/** One native fork hosts every comparison; dist modules bypass Vite's source transformer. */
export default defineConfig(
  withDistFreshness({
    test: {
      include: ['bench/**/*.bench.ts'],
      pool: 'forks',
      maxWorkers: 1,
      fileParallelism: false,
      execArgv: ['--expose-gc'],
      testTimeout: 2_400_000,
      server: { deps: { external: [/\/packages\/[^/]+\/dist\//, 'nanostores', 'zustand', 'mitt'] } }
    }
  })
)
