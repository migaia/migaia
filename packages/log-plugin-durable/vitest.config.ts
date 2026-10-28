import { defineConfig } from 'vitest/config'
import { withDistFreshness } from '../../scripts/vitest-dist-freshness.mjs'

/** Durable subprocesses use the same publication freshness boundary as every package. */
export default defineConfig(withDistFreshness({ test: { maxWorkers: 2 } }))
