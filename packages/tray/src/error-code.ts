/** Stable error codes exposed by the Tray admission and lookup boundary. */
export const TrayErrorCode = {
  /** Routing policy name or pick violates instances R1; provide a named synchronous policy. */
  routingInvalid: 'TRAY_ROUTING_INVALID',
  /** Host definition violates instances R1; provide an admitted host DSL. */
  hostInvalid: 'TRAY_HOST_INVALID',
  /** Spawn names an unregistered host in R3; register the host before spawning. */
  hostUnknown: 'TRAY_HOST_UNKNOWN',
  /** Remote host differs from the admission in R6; select the record's host. */
  hostMismatch: 'TRAY_HOST_MISMATCH',
  /** Expose uses a reserved internal plugin in R1; rename the business plugin. */
  reservedName: 'TRAY_RESERVED_NAME',
  /** Config or payload violates R3/R6 portable data; remove unsupported values. */
  valueNotPortable: 'TRAY_VALUE_NOT_PORTABLE',
  /** Spawn reuses an admitted id in R3; choose a free id or remove the admission. */
  instanceDuplicate: 'TRAY_INSTANCE_DUPLICATE',
  /** Lookup or remote uses an ended admission in R6; obtain a fresh remote. */
  instanceUnknown: 'TRAY_INSTANCE_UNKNOWN',
  /** Call targets a non-ready instance in R6; await its ready transition. */
  instanceNotReady: 'TRAY_INSTANCE_NOT_READY',
  /** Install or generation init fails in R3/R5; inspect the preserved cause. */
  instanceStartFailed: 'TRAY_INSTANCE_START_FAILED',
  /** Dispatcher receives a path outside R2 exposure; use an exposed Feature method. */
  pathNotExposed: 'TRAY_PATH_NOT_EXPOSED',
  /** Child init repeats or names another host in R2; init once per generation. */
  childStateInvalid: 'TRAY_CHILD_STATE_INVALID',
  /** Operation enters a closing registry in R3; create a new Tray. */
  disposed: 'TRAY_DISPOSED',
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
