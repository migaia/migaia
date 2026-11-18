/** Public entry of the part layouts: `defineLayout`, the built-in layouts and their plugin. */
export { defineLayout, type ILayoutSpec } from './define-layout.ts'
export {
  headerContentFooterLayout,
  navContentLayout,
  navTreeContentLayout,
  singleLayout
} from './builtins.ts'
export { layoutsPlugin } from './plugin.ts'
export { PartLayoutsErrorCode, type IPartLayoutsErrorCode } from './error-code.ts'
