import { defineConfig } from 'vitest/config'
import { withDistFreshness } from '../../scripts/vitest-dist-freshness.mjs'
/** Native filesystem tests require no browser globals or emulated object service. */
export default defineConfig(withDistFreshness({ test: { environment: 'node' } }))
