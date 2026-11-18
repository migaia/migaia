import type { LayerLevel } from '@migaia/part-contract'

/**
 * Z-index per semantic layer; the only numeric stacking source of the platform. The key set is the
 * fixed six-member `LayerLevel` domain owned by the part contract.
 */
export const LAYER_Z_INDEX: Readonly<Record<LayerLevel, number>> = {
  base: 0,
  sticky: 100,
  dropdown: 1000,
  overlay: 1100,
  modal: 1200,
  toast: 1300
}

/**
 * Cascade layer order of host style sheets. `layout` holds only layout-attachment rules (grid
 * tracks, region placement, separators, toggles, skip link); `stacking` holds only layer-manager
 * z-index rules.
 */
export const STYLE_LAYERS = ['tokens', 'parts', 'blueprint', 'local', 'layout', 'stacking'] as const

/** One cascade layer name. */
export type IStyleLayer = (typeof STYLE_LAYERS)[number]

/** Attribute that maps rendered elements back to part addresses. */
export const ADDRESS_ATTRIBUTE = 'data-part-address'

/** Selector of keyboard-focusable elements. */
export const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable]:not([contenteditable="false"])'
