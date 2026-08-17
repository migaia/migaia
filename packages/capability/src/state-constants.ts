/** Capability lifecycle states; these are distinct from graph availability states. */
export const CapabilityState = {
  off: 'off',
  gated: 'gated',
  activating: 'activating',
  on: 'on',
  failed: 'failed'
} as const;

export const CapabilityEnableStatus = {
  enabled: 'enabled',
  gated: 'gated',
  cancelled: 'cancelled',
  failed: 'failed'
} as const;

export type ICapabilityStateValue = (typeof CapabilityState)[keyof typeof CapabilityState];
export type ICapabilityEnableStatusValue =
  (typeof CapabilityEnableStatus)[keyof typeof CapabilityEnableStatus];
