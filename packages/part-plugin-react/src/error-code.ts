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
   * After commit the component's root element could not be obtained although the node needs DOM
   * work. Forward `ref` from the component, or use `element: 'query'`.
   */
  elementUnresolved: 'ELEMENT_UNRESOLVED',
  /** A node component threw while rendering; only that node is replaced by an empty placeholder. */
  renderFailed: 'RENDER_FAILED'
} as const

/** Value union of every `part.react` error code. */
export type IPartReactErrorCode = (typeof PartReactErrorCode)[keyof typeof PartReactErrorCode]
