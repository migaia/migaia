import { defineConfig } from 'vitest/config'
import { withDistFreshness } from '../../scripts/vitest-dist-freshness.mjs'

/** Test config: defaults plus the dist-freshness guard shared by every workspace package. */
export default defineConfig(withDistFreshness())
