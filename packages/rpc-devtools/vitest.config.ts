import { defineConfig } from 'vitest/config'
import { withDistFreshness } from '../../scripts/vitest-dist-freshness.mjs'

/** Contract tests use package sources while peer dependencies resolve through their public entries. */
export default defineConfig(withDistFreshness({ test: { include: ['test/**/*.test.ts'] } }))
