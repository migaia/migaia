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
  suspended: 'suspended',
  failed: 'failed',
  blocked: 'blocked',
  rolledBack: 'rolled-back',
  released: 'released'
} as const

export type ICapabilityGraphState = (typeof CapabilityGraphState)[keyof typeof CapabilityGraphState]
export type ICapabilityGraphNodeState =
  (typeof CapabilityGraphNodeState)[keyof typeof CapabilityGraphNodeState]

/** Stable provider-unavailability reasons shared by static diagnostics and dynamic propagation. */
export const GraphBlockedReason = {
  /** A required provider is absent from the current graph. */
  missing: 'missing',
  /** A required provider or its ancestor is suspended. */
  suspended: 'suspended',
  /** A required provider was explicitly removed from this graph. */
  removed: 'removed',
  /** A required provider failed to start or belongs to an unattributable failed batch. */
  failed: 'failed'
} as const

export type GraphBlockedReason = keyof typeof GraphBlockedReason

/** Stable custody-release reasons delivered to the composition-owned releaseBinding callback. */
export const GraphBindingReleaseReason = {
  /** The definition and its exact binding leave the graph. */
  remove: 'remove',
  /** Replacement relinquishes custody of the previous binding generation. */
  replace: 'replace',
  /** Terminal graph teardown relinquishes every remaining binding. */
  dispose: 'dispose'
} as const

export type GraphBindingReleaseReason = keyof typeof GraphBindingReleaseReason
