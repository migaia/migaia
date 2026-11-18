import { definePartPlugin } from '@migaia/part-host'
import {
  headerContentFooterLayout,
  navContentLayout,
  navTreeContentLayout,
  singleLayout
} from './builtins.ts'

/**
 * Registers the four built-in layouts. Install it next to the renderer plugins to use them in
 * blueprints; custom layouts are registered by the application's own plugin.
 */
export const layoutsPlugin = definePartPlugin({
  name: 'part-layouts',
  parts: [singleLayout, navContentLayout, navTreeContentLayout, headerContentFooterLayout]
})
