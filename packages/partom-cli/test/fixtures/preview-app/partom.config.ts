import { layoutsPlugin } from '@migaia/part-layouts'
import { fixturePlugin } from '../shared/parts.tsx'
import { appPlugin } from './panel.tsx'

/** Preview fixture project: built-in layouts, the shared fixture parts and a local panel part. */
export default {
  plugins: [layoutsPlugin, fixturePlugin, appPlugin],
  blueprints: ['*.blueprint.json']
}
