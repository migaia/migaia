/** Stable error source owned by the runtime-neutral RPC contract layer. */
export const ERROR_SOURCE = 'rpc.contract'

/**
 * Public error codes owned by the runtime-neutral RPC contract layer.
 *
 * @error-source rpc.contract
 */
export const RpcContractErrorCode = {
  /**
   * A warning, scheduler, or timer-cleanup callback failed without an upstream semantic identity.
   * Mutable native errors retain identity/type/stack; other values remain on cause. Correct the
   * callback; cleanup failures are observed without replacing the current frame result.
   */
  callbackFailed: 'CALLBACK_FAILED',
  /** Invalid descriptor identity or shape; caller must correct the component configuration. */
  invalidDescriptor: 'INVALID_DESCRIPTOR',
  /** Invalid semantic envelope; caller must reject the untrusted message. */
  invalidEnvelope: 'INVALID_ENVELOPE',
  /**
   * Invalid stream event, field, sequence, or value budget under the streaming contract; reject
   * this frame and terminate only its stream.
   */
  invalidStream: 'INVALID_STREAM',
  /** Invalid frame grammar or empty/malformed physical batch; discard the physical frame. */
  invalidFrame: 'INVALID_FRAME',
  /** Reassembly or encoded physical batch exceeded its byte budget; split at member boundaries. */
  frameLimitExceeded: 'FRAME_LIMIT_EXCEEDED',
  /** Reassembly expired before all fragments arrived. */
  frameAssemblyExpired: 'FRAME_ASSEMBLY_EXPIRED',
  /** Invalid wire error payload; the caller must reject the received value. */
  invalidWireError: 'INVALID_WIRE_ERROR',
  /** Malformed UTF-8, JSON, shape, or negotiation fields in a handshake; close this channel. */
  handshakeInvalid: 'HANDSHAKE_INVALID',
  /**
   * No shared protocol identity/major version, or a runtime endpoint lacks required protocol 1.1,
   * v2 directory, or batch reception; the caller needs a compatible peer.
   */
  handshakeIncompatible: 'HANDSHAKE_INCOMPATIBLE',
  /** The remote peer rejected its handshake; inspect the preserved remote cause. */
  handshakeRejected: 'HANDSHAKE_REJECTED',
  /**
   * A required extension is unavailable or received extension traffic was not negotiated. R6 / BC2
   * rejects it before application execution; configure compatible extensions.
   */
  extensionNegotiationFailed: 'EXTENSION_NEGOTIATION_FAILED'
} as const

/** Union of this layer's stable semantic failure values, independent of serialized remote codes. */
export type IRpcContractErrorCode = (typeof RpcContractErrorCode)[keyof typeof RpcContractErrorCode]

/** Stable diagnostic source retained when this family moves between RPC packages. */
export const RPC_ENDPOINT_ERROR_SOURCE = 'rpc.endpoint'

/**
 * Defines the error codes owned by `rpc.endpoint` in one place.
 *
 * The `(source, code)` pair uniquely identifies a public semantic failure. `source` is always
 * `rpc.endpoint`. Throw sites reference these constants rather than inline literals.
 *
 * Code values are public API, so renaming one is a breaking change. Only codes with actual throw
 * sites remain here. Records historical reserved codes removed during migration.
 *
 * @error-source rpc.endpoint
 */
export const RpcCoreErrorCode = {
  /** Host creation requires one registered transport plugin. Add a transport before retrying. */
  hostTransportMissing: 'HOST_TRANSPORT_MISSING',
  /** R3 / BC1 rejects duplicate transport namespaces before acquisition; choose distinct names. */
  hostNamespaceDuplicate: 'HOST_NAMESPACE_DUPLICATE',
  /** R8 / A8 rejects two same-kind call features on one plugin; keep one complete instance. */
  featureCombinationConflict: 'FEATURE_COMBINATION_CONFLICT',
  /** Host creation received an object without SDK registration identity. Use the define tools. */
  hostPluginInvalid: 'HOST_PLUGIN_INVALID',
  /**
   * An incoming peer name is held by a responsive session, or another admission is probing it.
   * Choose a different name or close the current session.
   */
  hostPeerNameDuplicate: 'HOST_PEER_NAME_DUPLICATE',
  /**
   * A cold Probe listener, middleware installation callback, or diagnostic reporter throws. The
   * original remains reachable; callers repair the callback rather than retrying side effects.
   */
  callbackFailed: 'CALLBACK_FAILED',
  /**
   * The selected authenticated provider/caller generation no longer matches this task; select
   * again.
   */
  providerGenerationMismatch: 'PROVIDER_GENERATION_MISMATCH',
  /**
   * A signed route already contains this Host or the selected next Host. Forwarding rejects before
   * admission and sending; callers must choose a route that does not revisit a Host.
   */
  forwardLoop: 'FORWARD_LOOP',
  /**
   * Three forwarding nodes have already been visited. Forwarding rejects a fourth before admission
   * and sending; callers may establish a direct connect/listen channel instead.
   */
  forwardHopLimit: 'FORWARD_HOP_LIMIT',


  /**
   * A Runtime API operation requires a mode or capability absent from the actual peer agreement.
   * Choose a supported method/mode rather than retrying the same operation.
   */
  capabilityUnsupported: 'CAPABILITY_UNSUPPORTED',

  /**
   * A factory, middleware, or transport descriptor or configuration field is invalid. Replay
   * protection also rejects encrypt-only configuration, unavailable entropy, and exhausted
   * counters.
   *
   * This code identifies argument and configuration failures. The caller corrects the configuration
   * using `detail` before retrying.
   */
  invalidConfig: 'INVALID_CONFIG',

  /**
   * A probe emit, describe or redact callback, or a native observation disposer, fails. The
   * installed probe retains the original cause and isolates diagnostic failure from business
   * execution; callers should repair or disable the diagnostic sink or its cleanup callback.
   */
  probeFailed: 'PROBE_FAILED',

  /**
   * `provide()` registers the same method twice.
   *
   * A provider does not replace another provider with the same name. The caller combines the
   * implementations or changes the name.
   */
  providerDuplicated: 'PROVIDER_DUPLICATED',

  /**
   * A protocol codec, scheme, or envelope is invalid, the caller cannot reconstruct a response
   * error, or a provider receives an invalid abort payload. This is the base code for
   * `RpcProtocolError`.
   *
   * The caller checks that the protocol configuration matches the peer scheme. If the payload is
   * already sent or cancellation has taken effect, inspect the peer rather than retrying the same
   * message.
   */
  protocolInvalid: 'PROTOCOL_INVALID',

  /**
   * Contract fields, direction, or request/response correlation are invalid. This is the base code
   * for `RpcContractError`.
   *
   * The caller checks `version`, `identifier`, sender/target direction, or `taskId`/method
   * correlation.
   */
  contractInvalid: 'CONTRACT_INVALID',

  /**
   * A codec payload violates its input rules, or sender-side error serialization degrades a read or
   * data projection. This is the base code for `RpcSerializationError`. Physical batch
   * shape/encoding failures preserve the contract cause; malformed semantic members are reported
   * individually without discarding valid siblings.
   *
   * The caller checks the data, codec, or thrown value. Do not retry the same payload if it is
   * already sent or cancellation has taken effect.
   */
  payloadInvalid: 'PAYLOAD_INVALID',

  /**
   * The provider executor cannot find a provider for the target method (`Provider not found`).
   *
   * The caller checks whether `provide()` registers the method. Do not retry the failed lookup.
   * This is the wire code for an inbound provider lookup failure.
   */
  providerNotFound: 'PROVIDER_NOT_FOUND',


  /**
   * A provider throws an unhandled exception. This is the standard code for an `INTERNAL` response.
   *
   * Only local hooks receive the redacted original exception. The peer receives `RpcRemoteError`
   * with code `INTERNAL`.
   */
  internal: 'INTERNAL',

  /**
   * A target or receiver is unresolved, inactive, or outside the current binding.
   *
   * The caller checks whether `targetId` is registered or discovered, or whether `receiverSelector`
   * returns an unknown receiver.
   */
  targetUnknown: 'TARGET_UNKNOWN',


  /**
   * An endpoint operation runs after disposal (`RpcLifecycleError`).
   *
   * The caller creates a new endpoint instead of reusing the closed instance.
   */
  endpointDisposed: 'ENDPOINT_DISPOSED',

  /**
   * A keepalive call admitted during Session closing exceeds its in-flight prepared-message quota.
   * R21 counts the captured metadata/manifest and native sidecars before optional feature overhead.
   * The caller reduces the payload or waits for existing work to settle; final close is uncharged.
   */
  keepaliveQuotaExceeded: 'KEEPALIVE_QUOTA_EXCEEDED',

  /**
   * The caller's `AbortSignal` cancels a local send (`RpcAbortError`).
   *
   * The caller handles this cooperative cancellation separately from remote failures.
   */
  cancelled: 'CANCELLED',

  /**
   * A local deadline expires (`RpcTimeoutError`).
   *
   * The caller checks target reachability and the timeout duration. Treat the request failure as
   * the result of this transmission attempt.
   */
  deadlineExceeded: 'DEADLINE_EXCEEDED',

  /**
   * `ctx.success()` or `ctx.failed()` runs after the provider task ends.
   *
   * The expired result produces no wire effects. The caller keeps response logic within the
   * provider's synchronous or awaited lifetime.
   */
  contextExpired: 'PROVIDER_CONTEXT_EXPIRED',

  /**
   * A transport send fails, a terminal event occurs, or the transport closes (`RpcTransportError`).
   *
   * The code alone does not establish whether a send already executed. Retry only with independent
   * evidence that it did not execute, or use the existing idempotency/outcome reconciliation.
   */
  transport: 'TRANSPORT',

  /**
   * A per-frame authentication transform fails during encryption, signing, verification, or
   * decryption (`RpcAuthenticationError`). Replay protection rejects missing/invalid binding,
   * duplicate counters and untrusted physical sessions.
   *
   * The caller checks key and algorithm configuration. Failure details are not sent back to the
   * peer.
   */
  authenticationFailed: 'AUTHENTICATION_FAILED',

  /**
   * Method parameters or results violate the contract schema (`RpcSchemaValidationError`).
   *
   * The caller corrects the data using `data.issues` rather than retrying the same invalid data.
   */
  schemaInvalid: 'SCHEMA_INVALID',

  /**
   * A capability is published twice, or a frozen capability registry receives another write. Also
   * rejects folded Feature method collisions and ambiguous runtime instances.
   *
   * The caller checks middleware for duplicate declarations of reserved capabilities. This is a
   * configuration error.
   */
  capabilityConflict: 'CAPABILITY_CONFLICT',

  /**
   * A local capacity limit rejects new work in provider admission, the replay ledger, discovery
   * waiters, outbound IDs, or chunks.
   *
   * The caller reduces concurrency, shortens TTL, or increases capacity. This signals backpressure
   * rather than a logic error.
   */
  overloaded: 'OVERLOADED',

  /**
   * A stream frame may have been sent before its transport rejected; the caller must open a fresh
   * stream and never replay delivered values.
   */
  streamResultUnknown: 'STREAM_RESULT_UNKNOWN',

  /**
   * A chunk frame has an invalid format. This is the base code for `RpcChunkError`.
   *
   * The caller checks chunk configuration (`chunkSize` ≥ 4) and the peer implementation. An invalid
   * frame only invokes hooks and is not retried.
   */
  chunkInvalid: 'CHUNK_INVALID',

  /**
   * A getter or Proxy throws during `safeRead` without a synchronous reporter, or the reporter
   * itself throws. The caller repairs the input or supplies a synchronous `report` at a boundary
   * that owns a diagnostic sink.
   */
  propertyReadFailed: 'PROPERTY_READ_FAILED',

  /**
   * A keyed call already executed but its result was not retained for replay. The caller must
   * resolve the outcome before issuing another non-idempotent attempt.
   */
  idempotencyResultUnavailable: 'IDEMPOTENCY_RESULT_UNAVAILABLE',

  /**
   * A string conversion throws without a synchronous reporter, or its reporter throws (cleanup ).
   * The caller must repair the input or provide a synchronous diagnostic sink.
   */
  stringConversionFailed: 'STRING_CONVERSION_FAILED'
} as const

/**
 * Refines the existing authentication failure without creating another top-level code.
 *
 * @error-source rpc.endpoint
 */
export const RpcAuthenticationRejectionReason = {
  /** Receiver discarded or never issued this challenge; discard the cached challenge only. */
  sessionUnknown: 'SESSION_UNKNOWN',
  /** Signed challenge fields have invalid grammar or direction; repair the frame contract. */
  challengeInvalid: 'CHALLENGE_INVALID'
} as const

export type RpcAuthenticationRejectionReason =
  (typeof RpcAuthenticationRejectionReason)[keyof typeof RpcAuthenticationRejectionReason]

/** Semantic failure code owned by the canonical Core error source. */
export type IRpcCoreErrorCode = (typeof RpcCoreErrorCode)[keyof typeof RpcCoreErrorCode]

/** Stable diagnostic source retained when this family moves between RPC packages. */
export const RPC_REMOTE_ERROR_SOURCE = 'rpc.remote'

/**
 * Public remote failures; each code has one owner and one caller action.
 *
 * @error-source rpc.remote
 */
export const RpcRemoteLayerErrorCode = {
  /** A passive watch exceeded 100 unread events; query current state before subscribing again. */
  runtimeEventOverflow: 'RUNTIME_EVENT_OVERFLOW',
  /** A description or control payload violates the remote contract; correct it before retrying. */
  contractInvalid: 'REMOTE_CONTRACT_INVALID',
  /**
   * HostUnUse, including dryRun, lacks this connection's live adoption of the same remotely
   * installed definition. Complete hostUse before removing it.
   */
  hostNotAdopted: 'REMOTE_HOST_NOT_ADOPTED',
  /** A supervisor cannot provide a ready unit or a channel cannot open; inspect the cause. */
  startFailed: 'REMOTE_START_FAILED',
  /** The registration was released or its generation left; wait for another ready generation. */
  closed: 'REMOTE_CLOSED',
  /**
   * A sent request lost its result with the generation; reconcile before another non-idempotent
   * call.
   */
  resultUnknown: 'REMOTE_RESULT_UNKNOWN'
} as const

/** Remote registration, description and generation failure code. */
export type IRpcRemoteLayerErrorCode =
  (typeof RpcRemoteLayerErrorCode)[keyof typeof RpcRemoteLayerErrorCode]

/** Stable diagnostic source retained when this family moves between RPC packages. */
export const RPC_PROCESS_ERROR_SOURCE = 'rpc.transport.process'

/**
 * Process boundary failures; callers close or recreate the affected connection.
 *
 * @error-source rpc.transport.process
 */
export const RpcProcessErrorCode = {
  /** Native PID sampling failed; report its cause and display unavailable without retrying. */
  usageSampleFailed: 'PROCESS_USAGE_SAMPLE_FAILED',
  /** Host options are invalid before launch; callers must correct the named field. */
  hostInvalidOption: 'PROCESS_HOST_INVALID_OPTION',
  /** Facade release has begun; callers must create a new facade instead of enqueueing work. */
  hostClosed: 'PROCESS_HOST_CLOSED',
  /** Handshake exceeded its scheduler deadline; caller must open a new channel. */
  handshakeTimeout: 'PROCESS_HANDSHAKE_TIMEOUT',
  /** Peer authorization failed; caller must not retry without valid credentials. */
  authRejected: 'PROCESS_CHANNEL_AUTH_REJECTED',
  /**
   * A closed channel rejected work or its close observer/resource cleanup failed; inspect
   * cause/errors.
   */
  channelClosed: 'PROCESS_CHANNEL_CLOSED',
  /** Dial or launch could not establish a channel; caller may inspect the original cause. */
  connectFailed: 'PROCESS_CHANNEL_CONNECT_FAILED',
  /** The requested local listener could not bind; caller must choose an available address. */
  listenFailed: 'PROCESS_CHANNEL_LISTEN_FAILED',
  /** Invalid process-plugin options are rejected before launch; caller must correct the named field. */
  pluginInvalidOption: 'PROCESS_PLUGIN_INVALID_OPTION',
  /**
   * Invalid resilience limits, ownership, or health configuration; correct the named field before
   * opening a connection.
   */
  resilienceInvalidOption: 'PROCESS_RESILIENCE_INVALID_OPTION',
  /** A connection, call-rate, or payload limit rejected admission before provider execution. */
  connectionLimit: 'PROCESS_CONNECTION_LIMIT',
  /**
   * A shared target is suspended after an explicit instance-health event until a ready replacement
   * exists.
   */
  instanceUnhealthy: 'PROCESS_INSTANCE_UNHEALTHY',
  /**
   * An enabled native health ping returned false before its supervision deadline; the owner must
   * restart the unit.
   */
  healthPingFailed: 'PROCESS_HEALTH_PING_FAILED',
  /** A terminal registration rejects new remote calls before they reach its inactive generation. */
  terminalCall: 'PROCESS_TERMINAL_CALL',
  /** A liquidated registration cannot restart; the caller must create a new registration. */
  liquidated: 'PROCESS_LIQUIDATED'
} as const

/** Semantic Process error values; Core and supervision failures keep their own package identities. */
export type IRpcProcessErrorCode = (typeof RpcProcessErrorCode)[keyof typeof RpcProcessErrorCode]

/** Stable diagnostic source retained when this family moves between RPC packages. */
export const RPC_THREAD_ERROR_SOURCE = 'rpc.transport.thread'

/**
 * Cold resource queries report failures without changing execution lifecycle.
 *
 * @error-source rpc.transport.thread
 */
export const RpcThreadErrorCode = {
  /** Native Worker sampling failed; retain its cause and display unavailable. */
  usageSampleFailed: 'THREAD_USAGE_SAMPLE_FAILED'
} as const
/** The Thread owner's diagnostic codes; RPC and supervision failures retain their own sources. */
export type IRpcThreadErrorCode = (typeof RpcThreadErrorCode)[keyof typeof RpcThreadErrorCode]

/** Stable diagnostic source retained when this family moves between RPC packages. */
export const RPC_BROWSER_ERROR_SOURCE = 'rpc.transport.browser'

/**
 * Browser Peer configuration failures have stable semantic identities independent from Core
 * control.
 *
 * @error-source rpc.transport.browser
 */
export const RpcBrowserErrorCode = {
  /** Requires a nonempty explicit Window origin; provide the destination origin before connecting. */
  windowOriginRequired: 'WINDOW_ORIGIN_REQUIRED',
  /** Requires ordered reliable RTC delivery; use a reliable channel or the Endpoint API. */
  rtcChannelUnreliable: 'RTC_CHANNEL_UNRELIABLE',
  /** Allows one active listener per SharedWorker scope; close or reuse that listener first. */
  listenerAlreadyBound: 'LISTENER_ALREADY_BOUND',
  /** Rejects conflicting or unsupported sources; supply one concrete connect source or listen scope. */
  invalidPeerSource: 'INVALID_PEER_SOURCE',
  /** Rejects malformed RTC JSON and retains the decoder cause; correct the remote wire input. */
  messageDecodeFailed: 'MESSAGE_DECODE_FAILED'
} as const
/**
 * Value union of Browser-owned admission/decoding codes; adapters also retain Core error
 * identities.
 */
export type IRpcBrowserErrorCode = (typeof RpcBrowserErrorCode)[keyof typeof RpcBrowserErrorCode]

/** Stable diagnostic source retained when this family moves between RPC packages. */
export const RPC_COROUTINE_ERROR_SOURCE = 'rpc.transport.coroutine'

/**
 * Invalid sources cannot acquire task ports or supervision authority.
 *
 * @error-source rpc.transport.coroutine
 */
export const RpcCoroutineErrorCode = {
  /** Supply exactly one callable task or a genuine connection received by that task generation. */
  sourceInvalid: 'COROUTINE_SOURCE_INVALID'
} as const

/** The package's public admission error values. */
export type IRpcCoroutineErrorCode =
  (typeof RpcCoroutineErrorCode)[keyof typeof RpcCoroutineErrorCode]

/** Stable diagnostic source retained when this family moves between RPC packages. */
export const RPC_POOL_ERROR_SOURCE = 'rpc.pool'

/**
 * Only pool-owned failures receive these registered codes; Peer errors pass through unchanged.
 *
 * @error-source rpc.pool
 */
export const RpcPoolErrorCode = {
  /** Invalid construction or resize arguments are rejected before any native acquisition. */
  invalidOptions: 'INVALID_OPTIONS',
  /** Listener and parent-only sources cannot open independent members; choose spawn or connect. */
  transportUnsupported: 'POOL_TRANSPORT_UNSUPPORTED',
  /** Closing/closed admission rejects new calls, first stream next or resize; create another pool. */
  poolClosed: 'POOL_CLOSED',
  /**
   * All available slots are reserved and the bounded FIFO is full; the new call never reaches a
   * Peer.
   */
  queueFull: 'QUEUE_FULL',
  /**
   * Queued cancellation removes only its FIFO entry; a native AbortError retains the signal reason
   * on cause.
   */
  callAborted: 'CALL_ABORTED',
  /**
   * Final close attempted all members but retained one or more close failures, including earlier
   * retirement failures. Inspect AggregateError.errors/cause; the pool is terminal, not reopened.
   */
  closeFailed: 'CLOSE_FAILED'
} as const

/** Registered pool-owned failure values; original Peer errors keep their own identities. */
export type IRpcPoolErrorCode = (typeof RpcPoolErrorCode)[keyof typeof RpcPoolErrorCode]

/** Stable diagnostic source retained when this family moves between RPC packages. */
export const RPC_DEVTOOLS_ERROR_SOURCE = 'rpc.devtools'

/**
 * Public code owner for the record contract and collector lifecycle.
 *
 * @error-source rpc.devtools
 */
export const RpcDevtoolsErrorCode = {
  /** Captured service data cannot be encoded; inspect cause or disable content exposure. */
  serviceResultInvalid: 'SERVICE_RESULT_INVALID',
  /** Collector options violate their supported domain; fix the option before construction. */
  invalidOption: 'INVALID_OPTION',
  /** Collector is closed; create a new instance rather than reviving retained resources. */
  closed: 'CLOSED',
  /** A recording already owns the collector; stop it before starting another. */
  recordActive: 'RECORD_ACTIVE',
  /** No recording remains active; start one before stopping it. */
  recordNotActive: 'RECORD_NOT_ACTIVE',
  /** Record header or NDJSON is invalid; inspect cause and supply a version-1 record. */
  recordFormatInvalid: 'RECORD_FORMAT_INVALID',
  /** Redaction failed; report the original cause and discard content (collector). */
  redactFailed: 'REDACT_FAILED'
} as const

/** Semantic code union retains the registry's exact value spelling. */
export type IRpcDevtoolsErrorCode = (typeof RpcDevtoolsErrorCode)[keyof typeof RpcDevtoolsErrorCode]
