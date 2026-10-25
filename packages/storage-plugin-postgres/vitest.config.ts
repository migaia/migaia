import { defineConfig } from 'vitest/config'
import { withDistFreshness } from '../../scripts/vitest-dist-freshness.mjs'
/** Native service tests retain the repository's original package freshness boundary. */
export default defineConfig(withDistFreshness({test:{environment:'node'}}))
