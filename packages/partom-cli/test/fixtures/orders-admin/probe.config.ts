// Config for `partom extract --probe --verify`: runs before the blueprint modules exist, so it only
// installs the built-in layouts the check page needs.
import { layoutsPlugin } from '@migaia/part-layouts'

/** Probe-time project. */
export default { plugins: [layoutsPlugin], blueprints: [] }
