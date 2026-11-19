/**
 * Plugin name of the devtools plugin; the no-op build uses the same name so either replaces the
 * other.
 */
export const DEVTOOLS_PLUGIN = 'part-devtools'

/** Attribute marking the panel's host element; production bundles must not contain it. */
export const PANEL_ATTRIBUTE = 'data-part-devtools-panel'

/** Marker naming the panel implementation in bundles. */
export const PANEL_MARKER = 'part-devtools-panel'

/** Attribute set on the page element of the selected address while it is highlighted. */
export const HIGHLIGHT_ATTRIBUTE = 'data-part-devtools-selected'

/** Longest JSON shown for one value before it is cut. */
export const VALUE_LIMIT = 200

/** Fixed labels of the panel. */
export const PanelText = {
  title: 'part devtools',
  pick: 'Pick',
  filter: 'Filter addresses',
  steps: 'Enhancement',
  resolved: 'Resolved config',
  state: 'State',
  derives: 'Derives',
  events: 'Events',
  none: '—'
} as const

/** Data attributes naming the panel's sections and controls, used by tests and styles. */
export const PanelPart = {
  pick: 'pick',
  filter: 'filter',
  tree: 'tree',
  steps: 'steps',
  resolved: 'resolved',
  state: 'state',
  derives: 'derives',
  events: 'events'
} as const
