import {defineConfig} from 'vitest/config'
import {withDistFreshness} from '../../scripts/vitest-dist-freshness.mjs'
/** Native host tests use Node without DOM, IndexedDB or reactive globals. */
export default defineConfig(withDistFreshness({test:{environment:'node'}}))
