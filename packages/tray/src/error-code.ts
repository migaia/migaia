/** Stable error codes exposed by the Tray admission and lookup boundary. */
export const TrayErrorCode = {
  /** Loader shape or artifact descriptor is invalid; repair the loader contract before retrying. */
  loaderContractInvalid: 'LOADER_CONTRACT_INVALID',
  /** Loader execution failed; inspect the preserved source error before deciding whether to retry. */
  loaderExecutionFailed: 'LOADER_EXECUTION_FAILED',
  /** Adapter shape or produced plugin is invalid; repair adapter compatibility. */
  adapterContractInvalid: 'ADAPTER_CONTRACT_INVALID',
  /** Adapter execution failed; inspect the preserved artifact compatibility cause. */
  adapterExecutionFailed: 'ADAPTER_EXECUTION_FAILED',
  /** Runtime host, name, options, or callback violates the Runtime boundary contract. */
  runtimeContractInvalid: 'RUNTIME_CONTRACT_INVALID',
  /** Runtime admission was attempted after closing; create a fresh Runtime. */
  runtimeDisposed: 'RUNTIME_DISPOSED',
  /** Runtime callback failed after exact lease admission; inspect the preserved callback cause. */
  runtimeExecutionFailed: 'RUNTIME_EXECUTION_FAILED',
  /** Runtime cancellation or deadline was observed; callback settlement still owns the lease. */
  runtimeAborted: 'RUNTIME_ABORTED',
  /** Artifact cleanup failed after a primary mutation result; inspect cleanupErrors. */
  artifactCleanupFailed: 'ARTIFACT_CLEANUP_FAILED',
  /** Invalid entry descriptor or start result; caller must provide a complete static entry. */
  invalidEntry: 'TRAY_INVALID_ENTRY',
  /** Duplicate key during factory admission; caller must provide unique keys. */
  duplicateEntry: 'TRAY_DUPLICATE_ENTRY',
  /** Unknown lookup or dependency key; caller must use an admitted key. */
  unknownEntry: 'TRAY_UNKNOWN_ENTRY',
  /** Entry is not ready or gate failed; caller must await readiness or repair the gate. */
  unavailable: 'TRAY_UNAVAILABLE',
  /** Readiness getter failed; caller must inspect the preserved cause and fix the source. */
  gateReadFailed: 'TRAY_GATE_READ_FAILED',
  /** Managed reads detect a mutation made through the escaped concrete Host. */
  hostMutationBypass: 'HOST_MUTATION_BYPASS'
} as const

export type ITrayErrorCode = (typeof TrayErrorCode)[keyof typeof TrayErrorCode]
