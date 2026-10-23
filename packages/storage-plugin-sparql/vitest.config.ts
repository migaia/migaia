import { defineConfig } from 'vitest/config'
import { withDistFreshness } from '../../scripts/vitest-dist-freshness.mjs'
/** Native protocol cases use actual peers and the shared external-service launcher. */
export default defineConfig(withDistFreshness({test:{environment:'node'}}))
