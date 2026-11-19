// Config of the usage-conversion check: extracted parts and every module `extract --usage` wrote,
// including the unreviewed effect drafts; no API plugins.
import { layoutsPlugin } from '@migaia/part-layouts'
import blackboxPlugin from './src/blueprints/blackbox/orders-page-1.tsx'
import effectsPlugin from './src/blueprints/effects/orders-page.ts'
import seedPlugin from './src/blueprints/orders-page.seed.ts'
import htmlPlugin from './src/blueprints/parts/html.ts'
import { uiPlugins } from './ui-plugin.ts'

/** Usage-conversion project. */
export default {
  plugins: [layoutsPlugin, ...uiPlugins, htmlPlugin, seedPlugin, effectsPlugin, blackboxPlugin],
  blueprints: ['src/blueprints/*.blueprint.json']
}
