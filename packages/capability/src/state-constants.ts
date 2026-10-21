/** Capability lifecycle states; these are distinct from graph availability states. */
export const CapabilityState = {
  /** Allowed by the flag but not currently active. */
  off: 'off',
  /** Denied by the flag; enabling returns a gated outcome without activation. */
  gated: 'gated',
  /** One current activation is pending and may still be invalidated. */
  activating: 'activating',
  /** The current activation's handle has been adopted. */
  on: 'on',
  /** The current activation failed; error(name) retains its reason until a new transition. */
  failed: 'failed'
} as const

/** Outcomes returned by enable; cancellation and gating are normal results rather than errors. */
export const CapabilityEnableStatus = {
  /** A current activation is available, including a previously enabled entry. */
  enabled: 'enabled',
  /** The entry's flag denies activation when the outcome is classified. */
  gated: 'gated',
  /** Activation lost ownership through disable, disposal, or a newer attempt. */
  cancelled: 'cancelled',
  /** The current attempt failed and supplies its error in the result. */
  failed: 'failed'
} as const

/** Value domain of the structured enable-result discriminant. */
export type ICapabilityEnableStatusValue =
  (typeof CapabilityEnableStatus)[keyof typeof CapabilityEnableStatus]
