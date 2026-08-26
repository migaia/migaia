/** Stable graph/container states; these are distinct from Capability Host states. */
export const CapabilityGraphState = {
  open: 'open',
  starting: 'starting',
  ready: 'ready',
  failed: 'failed',
  quiescing: 'quiescing',
  terminal: 'terminal'
} as const

/** Stable per-node states used for diagnostics after startup and disposal. */
export const CapabilityGraphNodeState = {
  registered: 'registered',
  starting: 'starting',
  ready: 'ready',
  failed: 'failed',
  blocked: 'blocked',
  rolledBack: 'rolled-back',
  released: 'released'
} as const

export type ICapabilityGraphState = (typeof CapabilityGraphState)[keyof typeof CapabilityGraphState]
export type ICapabilityGraphNodeState =
  (typeof CapabilityGraphNodeState)[keyof typeof CapabilityGraphNodeState]
