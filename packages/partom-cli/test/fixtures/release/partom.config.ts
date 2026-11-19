import { appPlugin } from './app.tsx'

/** Release fixture: two blueprints, two lazy part modules and one remote effect module. */
export default {
  plugins: [appPlugin],
  blueprints: ['blueprints/*.blueprint.json'],
  release: {
    project: 'orders',
    parts: ['parts/*.part.tsx'],
    remote: { root: 'remote', modules: ['**/*.ts'] }
  }
}
