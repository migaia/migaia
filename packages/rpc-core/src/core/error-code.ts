/** Stable error source for core and browser adapters that throw core error classes. */
export const ERROR_SOURCE = '@migaia/rpc/core'

/**
 * Defines the error codes owned by `@migaia/rpc/core` in one place.
 *
 * The `(source, code)` pair uniquely identifies an error under `docs/contracts/error-codes.md`.
 * `source` is always `@migaia/rpc/core`. Throw sites reference these constants rather than inline
 * literals.
 *
 * Code values are public API, so renaming one is a breaking change. See
 * `docs/contracts/error-code-rollout.sdd.md` §1.2. Only codes with actual throw sites remain here.
 * `rpc-layering.sdd.md` R2 records historical reserved codes removed during migration.
 */
export const RpcCoreErrorCode = {
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
  /** U38 retires an admitted forward execution with its exact generation; never replay it. */
  providerGenerationRetired: 'PROVIDER_GENERATION_RETIRED',
  /**
   * A signed route already contains this Host or the selected next Host. D51 rejects before
   * admission and sending; callers must choose a route that does not revisit a Host.
   */
  forwardLoop: 'FORWARD_LOOP',
  /**
   * Three forwarding nodes have already been visited. D51 rejects a fourth before admission and
   * sending; callers may establish a direct connect/listen channel instead.
   */
  forwardHopLimit: 'FORWARD_HOP_LIMIT',
  /**
   * Two middleware declarations in the same factory use the same `name`.
   *
   * The installer rejects before installing any middleware. The caller gives each middleware a
   * unique `name`. Enforces the duplicate singleton middleware creation rule in §7.1.
   */
  middlewareDuplicated: 'MIDDLEWARE_DUPLICATED',

  /**
   * An operation requires a capability that is not installed.
   *
   * Examples include creating an endpoint without `connect`, calling `ping()` without `ping`, or
   * passing `signal` without `abort`. The caller installs the corresponding middleware.
   */
  middlewareMissing: 'MIDDLEWARE_MISSING',

  /**
   * A Runtime API operation requires a mode or capability absent from the actual peer agreement.
   * Enforces D5/D42; choose a supported method/mode rather than retrying the same operation.
   */
  capabilityUnsupported: 'CAPABILITY_UNSUPPORTED',

  /**
   * A factory, middleware, or transport descriptor or configuration field is invalid. Replay r12
   * also rejects encrypt-only configuration, unavailable entropy, and exhausted counters.
   *
   * This code identifies argument and configuration failures. The caller corrects the configuration
   * using `detail` before retrying.
   */
  invalidConfig: 'INVALID_CONFIG',

  /**
   * A probe emit, describe or redact callback fails. Probe-core reports it with the original cause
   * and isolates it from business execution; callers should repair or disable the diagnostic sink.
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
   * data projection. This is the base code for `RpcSerializationError` and `RpcChunkError`.
   * Physical batch shape/encoding failures preserve the contract cause; malformed semantic members
   * are reported individually without discarding valid siblings.
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
   * A non-dispatch provider does not return `ctx.success()` or `ctx.failed()`.
   *
   * The caller ensures every non-dispatch branch explicitly returns a result, or selects dispatch
   * if that is intended.
   */
  providerNotSettled: 'PROVIDER_NOT_SETTLED',

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
   * An operation requires an individual receiver, but the target is an anonymous BroadcastChannel
   * group.
   *
   * The caller configures `uniqueTargetId` and `identifier` before pinning, or avoids per-instance
   * operations on the group.
   */
  targetNotIdentifiable: 'TARGET_NOT_IDENTIFIABLE',

  /**
   * An endpoint operation runs after disposal (`RpcLifecycleError`).
   *
   * The caller creates a new endpoint instead of reusing the closed instance.
   */
  endpointDisposed: 'ENDPOINT_DISPOSED',

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
   * decryption (`RpcAuthenticationError`). Replay r12 rejects missing/invalid binding, duplicate
   * counters and untrusted physical sessions.
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
   * A capability is published twice, or a frozen capability registry receives another write. I28
   * D8/D11 also rejects folded Feature method collisions and ambiguous runtime instances.
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
   * stream and never replay delivered values (streaming R7).
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
   * itself throws (R11). The caller repairs the input or supplies a synchronous `report` at a
   * boundary that owns a diagnostic sink.
   */
  propertyReadFailed: 'PROPERTY_READ_FAILED',

  /**
   * A keyed call already executed but its result was not retained for replay. The caller must
   * resolve the outcome before issuing another non-idempotent attempt.
   */
  idempotencyResultUnavailable: 'IDEMPOTENCY_RESULT_UNAVAILABLE',

  /**
   * A string conversion throws without a synchronous reporter, or its reporter throws (cleanup
   * R12). The caller must repair the input or provide a synchronous diagnostic sink.
   */
  stringConversionFailed: 'STRING_CONVERSION_FAILED'
} as const

/** U40 refines the existing authentication failure without creating another top-level code. */
export const RpcAuthenticationRejectionReason = {
  /** Receiver discarded or never issued this challenge; discard the cached challenge only. */
  sessionUnknown: 'SESSION_UNKNOWN',
  /** Signed challenge fields have invalid grammar or direction; repair the frame contract. */
  challengeInvalid: 'CHALLENGE_INVALID'
} as const

export type RpcAuthenticationRejectionReason =
  (typeof RpcAuthenticationRejectionReason)[keyof typeof RpcAuthenticationRejectionReason]

export type IRpcCoreErrorCode = (typeof RpcCoreErrorCode)[keyof typeof RpcCoreErrorCode]
