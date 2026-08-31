/** Stable Tray boundary messages used by callers and tests. */
export const TrayErrorText = {
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
