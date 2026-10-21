/** Stable graph/container states; these are distinct from Capability Host states. */
export const CapabilityGraphState = {
  /** Static registration is open, or a dynamic graph has not completed ready yet. */
  open: 'open',
  /** Static startup is running; external value visibility remains closed. */
  starting: 'starting',
  /** Readiness completed; individual dynamic nodes may still be unavailable. */
  ready: 'ready',
  /** Static startup failed and acquired resources were rolled back. */
  failed: 'failed',
  /** Disposal closed admission and is releasing graph-owned resources. */
  quiescing: 'quiescing',
  /** Final cleanup settled; create a new graph for further work. */
  terminal: 'terminal'
} as const

/** Stable per-node states used for diagnostics after startup and disposal. */
export const CapabilityGraphNodeState = {
  /** Definition is admitted but no instance is currently started. */
  registered: 'registered',
  /** Static startup is awaiting this node's primary instance. */
  starting: 'starting',
  /** The node's instance is available to permitted consumers. */
  ready: 'ready',
  /** Dynamic owner retained the instance while intentionally withholding service. */
  suspended: 'suspended',
  /** Startup or release failed with a retained diagnostic. */
  failed: 'failed',
  /** A provider or batch failure prevents service; a dynamic instance may still be retained. */
  blocked: 'blocked',
  /** Static startup or late-result cancellation relinquished this node's resources. */
  rolledBack: 'rolled-back',
  /** The static node's primary release completed. */
  released: 'released'
} as const

/** Whole-graph state domain, distinct from individual resource availability. */
export type ICapabilityGraphState = (typeof CapabilityGraphState)[keyof typeof CapabilityGraphState]
/** Per-node lifecycle and availability domain used by diagnostics. */
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

/** Provider-unavailability labels; states and reasons are not thrown error codes. */
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

/** Custody transitions reported to the composition-owned binding release callback. */
export type GraphBindingReleaseReason = keyof typeof GraphBindingReleaseReason
