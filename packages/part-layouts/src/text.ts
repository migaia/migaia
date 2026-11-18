/**
 * Default region labels of the built-in layouts. They are English defaults written into the
 * descriptors; a blueprint localises them through the layout's `labels` prop. Toggle buttons and
 * `aria-label` attributes show these strings, so changing one changes visible UI text.
 */
export const LayoutText = {
  /** Label of the `nav` region in `nav-content@1` and `nav-tree-content@1`. */
  mainNavigation: 'Main navigation',
  /** Label of the `tree` region in `nav-tree-content@1`. */
  contents: 'Contents'
} as const
