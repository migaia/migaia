import { defineFragment, definePartPlugin } from '@migaia/part-host'
import { fixturePlugin } from '../shared/parts.tsx'

/** Fragment that nests itself, so loading a blueprint that uses it throws a cycle error. */
const loop = defineFragment({
  id: 'loop@1',
  node: { tag: 'page@1', children: [{ tag: 'loop@1' }] }
})

/** Config without the DOM plugin: doctor adds it so built-in modifiers resolve. */
export default {
  plugins: [fixturePlugin, definePartPlugin({ name: 'loops', fragments: [loop] })],
  blueprints: ['*.blueprint.json']
}
