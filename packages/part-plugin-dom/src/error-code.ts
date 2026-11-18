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
  stylesheetUnsupported: 'STYLESHEET_UNSUPPORTED',
  /**
   * A subscription references a modifier the catalog no longer has (its plugin was removed after
   * the blueprint loaded). Reported through diagnostics, never thrown; the subscription installs no
   * listener. The error carries `address`, `event` and `modifier`. Reinstall the plugin and
   * reload.
   */
  modifierUnavailable: 'MODIFIER_UNAVAILABLE',
  /**
   * A modifier's `create`, `place`, `handle` or `dispose` threw. Reported through diagnostics with
   * the original error on `cause` and `address`, `event`, `modifier` attached. Fix the modifier.
   */
  modifierFailed: 'MODIFIER_FAILED',
  /**
   * A delegated (template-row) subscription contains a modifier that moves the listener; delegated
   * listeners always sit on the template host. Reported through diagnostics, no `cause`.
   */
  modifierPlacementDelegated: 'MODIFIER_PLACEMENT_DELEGATED'
} as const

/** Value union of every `part.dom` error code. */
export type IPartDomErrorCode = (typeof PartDomErrorCode)[keyof typeof PartDomErrorCode]
