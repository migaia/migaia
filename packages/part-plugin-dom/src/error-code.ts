/** Stable error domain owned by this code table; it names the part DOM layer. */
export const ERROR_SOURCE = 'part.dom'

/** The single declaration site for `part.dom` error codes. Code values are public API. */
export const PartDomErrorCode = {
  /**
   * A custom event was dispatched without a `plugin:` namespace prefix. Custom events cross the DOM
   * and must not collide with other libraries; prefix the event with the declaring plugin name.
   */
  customEventUnnamespaced: 'CUSTOM_EVENT_UNNAMESPACED',
  /**
   * The environment has no constructable style sheets / `adoptedStyleSheets`. Only hosts outside
   * the supported range reach this; the original TypeError is on `cause`.
   */
  stylesheetUnsupported: 'STYLESHEET_UNSUPPORTED'
} as const

/** Value union of every `part.dom` error code. */
export type IPartDomErrorCode = (typeof PartDomErrorCode)[keyof typeof PartDomErrorCode]
