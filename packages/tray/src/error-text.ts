/** Stable Tray boundary messages used by callers and tests. */
export const TrayErrorText = {
  /** Stable mesh R1 diagnostic for a host without a ready candidate. */
  hostUnavailable: 'tray host has no ready instance',
  /** Stable mesh R1 diagnostic shared by parent registration and child declaration checks. */
  routingUnknown: 'tray routing policy is unknown',
  /** Stable mesh R3 diagnostic for invalid publish and subscribe topic names. */
  topicInvalid: 'tray topic is invalid',
  /** Stable host-management diagnostic consumed by the instances boundary. */
  routingInvalid: 'tray routing policy is invalid',
  /** Stable host-management diagnostic consumed by the instances boundary. */
  hostInvalid: 'tray host definition is invalid',
  /** Stable host-management diagnostic consumed by the instances boundary. */
  hostUnknown: 'tray host is unknown',
  /** Stable host-management diagnostic consumed by the instances boundary. */
  hostMismatch: 'tray instance belongs to another host',
  /** Stable host-management diagnostic consumed by the instances boundary. */
  reservedName: 'tray plugin name is reserved',
  /** Stable host-management diagnostic consumed by the instances boundary. */
  valueNotPortable: 'tray value is not portable',
  /** Stable host-management diagnostic consumed by the instances boundary. */
  instanceDuplicate: 'tray instance id is duplicated',
  /** Stable host-management diagnostic consumed by the instances boundary. */
  instanceUnknown: 'tray instance is unknown',
  /** Stable host-management diagnostic consumed by the instances boundary. */
  instanceNotReady: 'tray instance is not ready',
  /** Stable host-management diagnostic consumed by the instances boundary. */
  instanceStartFailed: 'tray instance start failed',
  /** Stable host-management diagnostic consumed by the instances boundary. */
  pathNotExposed: 'tray path is not exposed',
  /** Stable host-management diagnostic consumed by the instances boundary. */
  childStateInvalid: 'tray child state is invalid',
  /** Stable host-management diagnostic consumed by the instances boundary. */
  disposed: 'tray is disposed',
  /** Stable loader contract diagnostic used for invalid definitions and descriptors. */
  loaderContractInvalid: 'tray loader contract is invalid',
  /** Stable loader execution diagnostic attached without replacing the source error. */
  loaderExecutionFailed: 'tray loader execution failed',
  /** Stable adapter contract diagnostic used for invalid adapters and plugin results. */
  adapterContractInvalid: 'tray adapter contract is invalid',
  /** Stable adapter execution diagnostic attached without replacing the source error. */
  adapterExecutionFailed: 'tray adapter execution failed',
  /** Stable runtime admission diagnostic for foreign hosts and malformed options. */
  runtimeContractInvalid: 'tray runtime contract is invalid',
  /** Stable runtime lifecycle diagnostic after disposal begins. */
  runtimeDisposed: 'tray runtime is disposed',
  /** Stable runtime callback diagnostic attached without replacing the callback error. */
  runtimeExecutionFailed: 'tray runtime execution failed',
  /** Stable runtime cancellation diagnostic for cooperative abort observation. */
  runtimeAborted: 'tray runtime was aborted',
  /** Stable artifact cleanup diagnostic for secondary cleanup observation. */
  artifactCleanupFailed: 'tray artifact cleanup failed',
  invalidEntry: 'tray entry is invalid',
  duplicateEntry: 'tray entry is duplicated',
  unknownEntry: 'tray entry is unknown',
  unavailable: 'tray entry is unavailable',
  gateReadFailed: 'tray readiness gate failed',
  /** Stable diagnostic for raw Host interference detected by the managed session receipt. */
  hostMutationBypass: 'managed host detected an escaped concrete host mutation'
} as const
