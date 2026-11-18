/**
 * Attributes the layout attachment reads and writes. The renderer writes the same names when it
 * creates the elements, and the style sheet builds `layout` layer selectors from them.
 */
export const LayoutAttribute = {
  /** Region element; value is the region name. */
  region: 'data-part-region',
  /** Separator element; value is the name of the region it resizes. */
  separator: 'data-part-separator',
  /** Collapse toggle button; value is the name of the region it opens. */
  toggle: 'data-part-toggle',
  /** Skip-to-main link; no value. */
  skip: 'data-part-skip',
  /** Set to `true` on a region while it is collapsed into a drawer. */
  collapsed: 'data-collapsed'
} as const

/**
 * Prefix of the `localStorage` keys holding resized region widths. The full key is
 * `part-layout:<blueprint id>:<layout address>:<region>`; changing it forgets saved sizes.
 */
export const LAYOUT_STORAGE_PREFIX = 'part-layout:'

/** Width of every separator grid track. */
export const SEPARATOR_TRACK = '6px'

/** Pixels one arrow key press moves a separator; Shift uses `SEPARATOR_STEP_LARGE`. */
export const SEPARATOR_STEP = 10

/** Pixels one Shift+arrow key press moves a separator. */
export const SEPARATOR_STEP_LARGE = 50

/** Drawer width for a collapsed region that has no pixel size of its own. */
export const DRAWER_FALLBACK_WIDTH = 280

/** Vertical offset between stacked visible collapse toggles, as a CSS length multiplier. */
export const TOGGLE_OFFSET = '2.5em'
