/** Stable error codes exposed by the Tray admission and lookup boundary. */
export const TrayErrorCode = {
  /** The mesh has no ready host candidate; await a ready instance before calling again. */
  hostUnavailable: 'TRAY_HOST_UNAVAILABLE',
  /** The routing policy is absent from registration or declaration; register its branded definition. */
  routingUnknown: 'TRAY_ROUTING_UNKNOWN',
  /** The mesh requires a non-empty topic string; correct the topic before publishing or subscribing. */
  topicInvalid: 'TRAY_TOPIC_INVALID',
  /** Routing policy name or pick is invalid; provide a named synchronous policy. */
  routingInvalid: 'TRAY_ROUTING_INVALID',
  /** Host definition is invalid; provide an admitted host DSL. */
  hostInvalid: 'TRAY_HOST_INVALID',
  /** Spawn names an unregistered host; register the host before spawning. */
  hostUnknown: 'TRAY_HOST_UNKNOWN',
  /** Remote host differs from the admission; select the record's host. */
  hostMismatch: 'TRAY_HOST_MISMATCH',
  /** Expose uses a reserved internal plugin; rename the business plugin. */
  reservedName: 'TRAY_RESERVED_NAME',
  /** Config or payload is not portable data; remove unsupported values. */
  valueNotPortable: 'TRAY_VALUE_NOT_PORTABLE',
  /** Spawn reuses an admitted id; choose a free id or remove the admission. */
  instanceDuplicate: 'TRAY_INSTANCE_DUPLICATE',
  /** Lookup or remote uses an ended admission; obtain a fresh remote. */
  instanceUnknown: 'TRAY_INSTANCE_UNKNOWN',
  /** Call targets a non-ready instance; await its ready transition. */
  instanceNotReady: 'TRAY_INSTANCE_NOT_READY',
  /** Install or generation init fails; inspect the preserved cause. */
  instanceStartFailed: 'TRAY_INSTANCE_START_FAILED',
  /** Dispatcher receives a path outside the exposure; use an exposed Feature method. */
  pathNotExposed: 'TRAY_PATH_NOT_EXPOSED',
  /** Child init repeats or names another host; init once per generation. */
  childStateInvalid: 'TRAY_CHILD_STATE_INVALID',
  /** Operation enters a closing registry; create a new Tray. */
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
  /** Runtime could not acquire the target lease; inspect the retained admission failure or cause. */
  runtimeAborted: 'RUNTIME_ABORTED',
  /**
   * An unclassified artifact cleanup failed; existing lifecycle identities remain unchanged.
   * Inspect cleanupErrors.
   */
  artifactCleanupFailed: 'ARTIFACT_CLEANUP_FAILED',
  /**
   * An entry, managed factory result, or Host claim is invalid; provide a complete definition and
   * an unclaimed Host.
   */
  invalidEntry: 'TRAY_INVALID_ENTRY',
  /** Duplicate key during factory admission; caller must provide unique keys. */
  duplicateEntry: 'TRAY_DUPLICATE_ENTRY',
  /** Unknown get()/entryState() key; caller must use an admitted key. */
  unknownEntry: 'TRAY_UNKNOWN_ENTRY',
  /** Entry is not ready or gate failed; caller must await readiness or repair the gate. */
  unavailable: 'TRAY_UNAVAILABLE',
  /** Readiness getter failed; caller must inspect the preserved cause and fix the source. */
  gateReadFailed: 'TRAY_GATE_READ_FAILED',
  /** Managed reads detect a mutation made through the escaped concrete Host. */
  hostMutationBypass: 'HOST_MUTATION_BYPASS'
} as const

/**
 * Tray-owned failure domain; complete identities from other packages remain owned by those
 * packages.
 */
export type ITrayErrorCode = (typeof TrayErrorCode)[keyof typeof TrayErrorCode]
