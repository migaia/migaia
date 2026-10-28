import { defineConfig } from 'vitest/config'
import { withDistFreshness } from '../../scripts/vitest-dist-freshness.mjs'

/** Package tests consume only fresh built workspace dependencies. */
export default defineConfig(withDistFreshness())
