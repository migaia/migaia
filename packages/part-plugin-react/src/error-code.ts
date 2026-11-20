/** Stable error domain owned by this code table; it names the part React renderer. */
export const ERROR_SOURCE = 'part.react'

/** The single declaration site for `part.react` error codes. Code values are public API. */
export const PartReactErrorCode = {
  /**
   * A rendered part has no `react` implementation in the catalog. The node renders empty; bind the
   * part with `bindReactComponent` and add the binding to a plugin's `implementations`.
   */
  bindingMissing: 'BINDING_MISSING',
  /**
   * A bound component with the default `element: 'ref'` never passed an element to its `ref` by the
   * first layout effect after mounting (for example a wrapper that does not forward `ref`).
   * Reported once per mount with the node address and part id, never thrown; the node gets no
   * element-dependent behaviour (modifiers, measuring, `data-part-address`) in that mount. Forward
   * `ref` from the component, or bind with `element: 'query'`.
   */
  elementMissing: 'PART_ELEMENT_MISSING',
  /** A node component threw while rendering; only that node is replaced by an empty placeholder. */
  renderFailed: 'RENDER_FAILED'
} as const

/** Value union of every `part.react` error code. */
export type IPartReactErrorCode = (typeof PartReactErrorCode)[keyof typeof PartReactErrorCode]
