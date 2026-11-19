// Orders admin: the hand-written project config of the integration fixture. Every imported module
// under `src/` is produced by the `partom import`, `extract` and `extract --usage` runs of the test.
import { layoutsPlugin } from '@migaia/part-layouts'
import { apiPlugin, createHttpPlugin } from './src/api/index.ts'
import blackboxPlugin from './src/blueprints/blackbox/orders-page-1.tsx'
import effectsPlugin from './src/blueprints/effects/orders-page.ts'
import seedPlugin from './src/blueprints/orders-page.seed.ts'
import htmlPlugin from './src/blueprints/parts/html.ts'
import { projectRulesPlugin } from './rules.ts'
import { uiPlugins } from './ui-plugin.ts'

/**
 * Base URL of the test backend; the test process sets it, and the public prefix inlines it into
 * browser bundles.
 */
const baseUrl = process.env.PARTOM_PUBLIC_ORDERS_API_URL ?? 'http://localhost/'

/** Orders admin project. */
export default {
  plugins: [
    layoutsPlugin,
    createHttpPlugin({ baseUrl }),
    apiPlugin,
    ...uiPlugins,
    htmlPlugin,
    seedPlugin,
    effectsPlugin,
    blackboxPlugin,
    projectRulesPlugin
  ],
  blueprints: ['src/blueprints/*.blueprint.json'],
  release: {
    project: 'orders',
    parts: ['src/parts/data-table.part.tsx'],
    remote: { root: 'remote', modules: ['**/*.ts'] }
  }
}
