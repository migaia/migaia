/** Stable text retained by the core endpoint graph and its shared contracts. */
export const RpcCoreErrorText = {
  /** Stable construction-hook event name consumed by endpoint diagnostics. */
  componentShadowed: 'component-shadowed',
  /** Stable descriptor diagnostics used by native contract component middleware. */
  codecDescriptorInvalid: 'Codec descriptor is invalid',
  framerDescriptorInvalid: 'Framer descriptor is invalid',
  /** Stable descriptor failure emitted before the kernel subscribes to a transport. */
  transportDescriptorInvalid: 'transport descriptor is invalid',
  /** Stable metadata failure emitted before the kernel subscribes to a transport. */
  transportIdentityDescriptorInvalid: 'transport identity descriptor is invalid',
  /** Stable fallback text when physical receiver registration throws a hostile value. */
  endpointRegistrationFailed: 'Endpoint registration failed',
  /** Stable lifecycle rejection once the canonical kernel closes admission. */
  endpointDisposed: 'Endpoint disposed',
  /** Stable lifecycle message when endpoint-owned resource release reports cleanup failures. */
  endpointDisposalCleanupFailed: 'Endpoint disposal completed with cleanup errors',
  /** Stable conflict text when two attachments claim the same decoded frame kind. */
  endpointRouteOwned: 'endpoint route is already owned',
  /** Stable diagnostic when protocol 1.1 admits a frame but no stream feature owns it. */
  streamRouteUnclaimed: 'stream route unavailable',
  /** Stable conflict text when two attachments claim the same runtime owner. */
  endpointOwnerOwned: 'endpoint runtime owner is already registered',
  /** Stable composition admission text consumed by core before transport side effects. */
  endpointModuleInvalid: 'endpoint module token is invalid',
  /** Stable composition conflict text consumed by core duplicate-token admission. */
  endpointModuleDuplicated: 'endpoint module is duplicated',
  /** Only one send-queue wrapper and Feature may claim a physical connection. */
  ipcGateDuplicated: 'IPC send gate is already registered',
  /** The wrapped transport and selected native Feature must own the same gate instance. */
  ipcGateMismatch: 'IPC send gate and Feature do not match',
  /** Stable internal topology text when a dependency owner was not installed. */
  endpointModuleDependencyMissing: 'endpoint module dependency is missing',
  /** Stable overload diagnostic when discovery cannot retain another automatic waiter. */
  discoveryWaiterLimit: 'discovery waiter limit exceeded',
  /** Stable capability failure when the ping variation was not selected via middleware. */
  pingMiddlewareMissing: 'ping middleware is not installed',
  /** Stable validation failure for an out-of-domain identifier, keyed by its caller-facing label. */
  identifierInvalid: (label: string): string =>
    `${label} must be a non-empty identifier within the limit`,
  /** Stable capacity failure when outbound identifier replay ownership is exhausted. */
  outboundReplayFull: 'Replay window is full',
  /** Stable validation failure for an uncallable event listener. */
  eventListenerInvalid: 'event listener must be a function',
  /** Stable method/target validation text shared by outbound and provider registration. */
  methodInvalid: 'method must be a non-empty string',
  /** Stable capability failure when caller cancellation was not selected. */
  abortMiddlewareMissing: 'abort middleware is not installed',
  /** Stable validation failure when a hostile cancellation signal cannot be observed. */
  abortSignalInvalid: 'abort signal is invalid',
  /** Stable timeout-domain validation shared by legacy and slim outbound runtimes. */
  timeoutInvalid: 'timeoutMs must be false or a non-negative finite number',
  /** Injected schedulers own endpoint timers and must expose a finite non-negative monotonic clock. */
  schedulerInvalid:
    'scheduler must provide now and schedule, and now() must return finite non-negative milliseconds',
  /** Injected wall clocks only stamp diagnostics and must return safe-integer epoch milliseconds. */
  wallClockInvalid:
    'wallClock must provide timestamp, and timestamp() must return non-negative safe-integer epoch milliseconds',
  /** Stable fallback when a remote failure omits its public message. */
  remoteRequestFailed: 'Remote request failed',
  /** Stable text for an unreported hostile property read at the safeRead boundary. */
  propertyReadFailed: 'rpc property read failed',
  /** Stable failure text for an unreported hostile conversion at the safeString boundary. */
  stringConversionFailed: 'rpc string conversion failed',
  /** Stable fallback shown when an untrusted error value cannot be converted to text. */
  unknownError: 'Unknown error',
  /** Stable outer schema failure text that keeps parser and issue-read errors in one cause graph. */
  schemaValidationFailed: (method: string, side: string): string =>
    `Schema validation failed for ${method} ${side}`,
  /** Stable issue fallback when a parser throws without readable detail. */
  schemaValidationFallback: 'Schema validation failed',
  /** Stable invalid plugin-result text used before endpoint hooks exist. */
  pluginInstallResultInvalid: 'plugin install result is invalid',
  /** Stable validation failure for malformed provider registration input. */
  providerDescriptorInvalid: 'provider descriptor is invalid',
  /** Stable duplicate-provider diagnostic keyed by the conflicting method. */
  providerDuplicated: (method: string): string => `Provider already registered: ${method}`,
  /** Stable public migration diagnostic rejecting the removed context/install middleware shape. */
  middlewareMustBePlugin: 'middleware must be a native WebRPC plugin',
  /** Identifies a protocol codec failure before a frame reaches transport. */
  protocolEncodeFailed: 'Protocol encode failed',
  /** Identifies a transport failure after a frame has been encoded. */
  transportSendFailed: 'Transport send failed',
  /** Describes a transfer option that cannot be snapshotted as a list. */
  invalidTransferList: 'Transfer list must be an array',
  /** Describes a transfer list that cannot accompany chunked output. */
  transferUnsupportedForChunking: 'Transfer lists are unsupported for chunked messages',
  /** Describes a transfer list that cannot accompany authenticated output. */
  transferUnsupportedWithAuthentication: 'Transfer lists are unsupported with authentication',
  /** Describes a protocol codec result whose runtime type disagrees with its declaration. */
  protocolEncodedType: (encodedType: string): string =>
    `Protocol encoded output must be ${encodedType}`,
  /** Describes an authentication result whose runtime type disagrees with transport. */
  protectedEncodedType: (encodedType: string): string =>
    `Protected frame output must be ${encodedType}`,
  /** Identifies an authentication transform that failed before transport send. */
  authenticationFailed: 'Authentication transform failed',
  /** Public validation text for a trace identifier outside the printable bounded wire domain. */
  traceInvalid: 'trace must be 1-256 printable ASCII characters',
  /** Public validation text for an idempotency key outside the bounded wire domain. */
  idempotencyKeyInvalid: 'idempotencyKey is invalid',
  /** Public validation text for a relative peer drain outside the wire duration domain. */
  drainInvalid: 'drainMs must be a non-negative integer within the limit',
  /** Configuration text for an invalid endpoint idempotency store or scope function. */
  idempotencyConfigInvalid: 'idempotency configuration is invalid',
  /** Explains that a completed keyed call cannot be replayed because its result was not retained. */
  idempotencyResultUnavailable: 'Idempotency result is unavailable',
  /** Public backpressure text when the bounded keyed-call store cannot admit another tuple. */
  idempotencyStoreFull: 'Idempotency store is full',
  /** Preserves the duplicate control handler's existing native TypeError message. */
  variationHandlerDuplicate: (variation: string): string =>
    `variation handler already registered: ${variation}`,
  /** Preserves the existing duplicate manual query listener message and code. */
  manualQueryListenerDuplicate: 'only one manual query listener may be registered',
  /**
   * Stable core error text consumed by core/errors.ts; preserves its existing caller-facing
   * wording.
   */
  webRPCRequestCancelled: 'Web RPC request cancelled',
  /**
   * Stable core error text consumed by core/errors.ts; preserves its existing caller-facing
   * wording.
   */
  webRPCRequestDeadlineExceeded: 'Web RPC request deadline exceeded',
  /**
   * Stable core error text consumed by core/internal/async-control.ts; preserves its existing
   * caller-facing wording.
   */
  timeoutMustBeFalseOrANonNegativeFiniteNumber:
    'timeout must be false or a non-negative finite number',
  /**
   * Stable core error text consumed by core/internal/discovery-attachment.ts; preserves its
   * existing caller-facing wording.
   */
  queryListenerMustBeAFunction: 'query listener must be a function',
  /**
   * Stable core error text consumed by core/internal/discovery-attachment.ts; preserves its
   * existing caller-facing wording.
   */
  broadcastTargetNotIdentifiable: (targetId: string): string =>
    `BroadcastChannel target is not individually identifiable: ${targetId}`,
  /**
   * Stable core error text consumed by core/internal/discovery-attachment.ts; preserves its
   * existing caller-facing wording.
   */
  unknownReceiver: (receiverId: string): string => `Unknown receiver: ${receiverId}`,
  /**
   * Stable core error text consumed by core/internal/discovery-attachment.ts; preserves its
   * existing caller-facing wording.
   */
  pinnedReceiverUnavailable: (receiverId: string): string =>
    `Pinned receiver is unavailable: ${receiverId}`,
  /**
   * Stable core error text consumed by core/internal/discovery-attachment.ts; preserves its
   * existing caller-facing wording.
   */
  receiverSelectorReturnedAnInvalidReceiver: 'receiverSelector returned an invalid receiver',
  /**
   * Stable core error text consumed by core/internal/discovery-attachment.ts; preserves its
   * existing caller-facing wording.
   */
  selectedReceiverUnavailable: (selected: string): string =>
    `receiverSelector returned an unavailable receiver: ${selected}`,
  /**
   * Stable core error text consumed by core/internal/discovery-attachment.ts; preserves its
   * existing caller-facing wording.
   */
  unknownTarget: (targetId: string): string => `Unknown target: ${targetId}`,
  /**
   * Stable core error text consumed by core/internal/discovery-attachment.ts; preserves its
   * existing caller-facing wording.
   */
  discoveryTimeoutMustBeFiniteAndNonNegative: 'discovery timeout must be finite and non-negative',
  /**
   * Stable core error text consumed by core/internal/discovery-attachment.ts; preserves its
   * existing caller-facing wording.
   */
  discoveryAborted: 'Discovery aborted',
  /**
   * Stable core error text consumed by core/internal/discovery-attachment.ts; preserves its
   * existing caller-facing wording.
   */
  discoveryCandidateIsInvalid: 'discovery candidate is invalid',
  /**
   * Stable core error text consumed by core/internal/discovery-attachment.ts; preserves its
   * existing caller-facing wording.
   */
  discoveryCandidateWasNotProducedByAVerifiedManualQuery:
    'discovery candidate was not produced by a verified manual query',
  /**
   * Stable core error text consumed by core/internal/discovery-attachment.ts; preserves its
   * existing caller-facing wording.
   */
  discoveryCandidateReceiverIdIsInvalid: 'discovery candidate receiverId is invalid',
  /**
   * Stable core error text consumed by core/internal/discovery-attachment.ts; preserves its
   * existing caller-facing wording.
   */
  discoveryCandidateWasRevoked: 'discovery candidate was revoked',
  /**
   * Stable core error text consumed by core/internal/discovery-attachment.ts; preserves its
   * existing caller-facing wording.
   */
  receiverLimitExceeded: 'receiver limit exceeded',
  /**
   * Stable core error text consumed by core/internal/discovery-attachment.ts; preserves its
   * existing caller-facing wording.
   */
  verifiedDiscoveryBindingIsNoLongerAvailable: 'verified discovery binding is no longer available',
  /**
   * Stable core error text consumed by core/internal/discovery-attachment.ts; preserves its
   * existing caller-facing wording.
   */
  remoteDiscoveryTargetLimitExceeded: 'remote discovery target limit exceeded',
  /**
   * Stable core error text consumed by core/internal/discovery-attachment.ts; preserves its
   * existing caller-facing wording.
   */
  manualRevocationCapacityExceeded: 'manual revocation capacity exceeded',
  /**
   * Stable core error text consumed by core/internal/discovery-attachment.ts; preserves its
   * existing caller-facing wording.
   */
  discoveryCandidateUniqueTargetIdMustBeAString:
    'discovery candidate uniqueTargetId must be a string',
  /**
   * Stable core error text consumed by core/internal/discovery-attachment.ts; preserves its
   * existing caller-facing wording.
   */
  queryRejectionReasonMustBeAString: 'query rejection reason must be a string',
  /**
   * Stable core error text consumed by core/internal/discovery-attachment.ts; preserves its
   * existing caller-facing wording.
   */
  manualDiscoveryIsUnavailable: 'manual discovery is unavailable',
  /**
   * Stable core error text consumed by core/internal/discovery-registry.ts; preserves its existing
   * caller-facing wording.
   */
  discoveryRegistryClosed: 'discovery registry closed',
  /**
   * Stable core error text consumed by core/internal/endpoint-bootstrap.ts; preserves its existing
   * caller-facing wording.
   */
  connectMiddlewareIsRequired: 'connect middleware is required',
  /**
   * Stable core error text consumed by core/internal/endpoint-bootstrap.ts; preserves its existing
   * caller-facing wording.
   */
  idAndTargetIdsMustFitTheConfiguredIdentifierLimit:
    'id and targetIds must fit the configured identifier limit',
  /**
   * Stable core error text consumed by core/internal/endpoint-bootstrap.ts; preserves its existing
   * caller-facing wording.
   */
  connectUniqueTargetIdFactoryFailed: 'connect.uniqueTargetId factory failed',
  /**
   * Stable core error text consumed by core/internal/endpoint-bootstrap.ts; preserves its existing
   * caller-facing wording.
   */
  outboundFrameAndTransportEncodedTypesAreIncompatible:
    'outbound frame and transport encoded types are incompatible',
  /**
   * Stable core error text consumed by core/internal/endpoint-bootstrap.ts; preserves its existing
   * caller-facing wording.
   */
  factoryDescriptorIsInvalid: 'factory descriptor is invalid',
  /**
   * Stable core error text consumed by core/internal/endpoint-bootstrap.ts; preserves its existing
   * caller-facing wording.
   */
  factoryDescriptorIsUnreadable: 'factory descriptor is unreadable',
  /**
   * Stable core error text consumed by core/internal/endpoint-bootstrap.ts; preserves its existing
   * caller-facing wording.
   */
  idMustBeANonEmptyString: 'id must be a non-empty string',
  /**
   * Stable core error text consumed by core/internal/endpoint-bootstrap.ts; preserves its existing
   * caller-facing wording.
   */
  middlewaresMustBeAnArray: 'middlewares must be an array',
  /**
   * Stable core error text consumed by core/internal/endpoint-bootstrap.ts; preserves its existing
   * caller-facing wording.
   */
  targetIdsMustBeAnArray: 'targetIds must be an array',
  /**
   * Stable core error text consumed by core/internal/endpoint-bootstrap.ts; preserves its existing
   * caller-facing wording.
   */
  targetIdsMustContainNonEmptyStrings: 'targetIds must contain non-empty strings',
  /**
   * Stable core error text consumed by core/internal/endpoint-bootstrap.ts; preserves its existing
   * caller-facing wording.
   */
  factoryCollectionIsUnreadable: 'factory collection is unreadable',
  /**
   * Stable core error text consumed by core/internal/endpoint-bootstrap.ts; preserves its existing
   * caller-facing wording.
   */
  duplicateMiddleware: (name: string): string => `Duplicate middleware: ${name}`,
  /**
   * Stable core error text consumed by core/internal/endpoint-bootstrap.ts; preserves its existing
   * caller-facing wording.
   */
  middlewaresAreUnreadable: 'middlewares are unreadable',
  /**
   * Stable core error text consumed by core/internal/endpoint-bootstrap.ts; preserves its existing
   * caller-facing wording.
   */
  connectMiddlewareMustProvideTransport: 'connect middleware must provide transport',
  /**
   * Stable core error text consumed by core/internal/id.ts; preserves its existing caller-facing
   * wording.
   */
  uuidGeneratorMustReturnANonEmptyString: 'UUID generator must return a non-empty string',
  /**
   * Stable core error text consumed by core/internal/id.ts; preserves its existing caller-facing
   * wording.
   */
  uuidConflict: (id: string): string => `UUID conflict: ${id}`,
  /**
   * Stable core error text consumed by core/internal/id.ts; preserves its existing caller-facing
   * wording.
   */
  uuidUnavailable: 'UUID unavailable',
  /**
   * Stable core error text consumed by core/internal/identity.ts; preserves its existing
   * caller-facing wording.
   */
  bindingLimitsMustBePositiveSafeIntegers: 'binding limits must be positive safe integers',
  /** Invalid local admission observers are rejected before provider activation. */
  providerAdmissionObserverMustBeAFunction: 'Provider admission observer must be a function',
  /** Observer failures are local diagnostics; the original remains on the cause chain. */
  providerAdmissionObserverFailed: 'Provider admission observer failed',
  /**
   * Stable core error text consumed by core/internal/provider-admission.ts; preserves its existing
   * caller-facing wording when concurrency limits are not positive safe integers.
   */
  providerAdmissionLimitsMustBePositiveSafeIntegers:
    'provider admission limits must be positive safe integers',
  /**
   * Stable core error text consumed by core/internal/provider-executor.ts; preserves its existing
   * caller-facing wording.
   */
  providerTransferMustBeABoundedArray: 'provider transfer must be a bounded array',
  /**
   * Stable core error text consumed by core/internal/provider-executor.ts; preserves its existing
   * caller-facing wording.
   */
  providerFailureMessageAndCodeMustBeStrings: 'provider failure message and code must be strings',
  /**
   * Stable core error text consumed by core/internal/provider-executor.ts; preserves its existing
   * caller-facing wording.
   */
  requestReplayLedgerIsFull: 'Request replay ledger is full',
  /**
   * Stable core error text consumed by core/internal/provider-executor.ts; preserves its existing
   * caller-facing wording.
   */
  providerAdmissionLimitReached: 'Provider admission limit reached',
  /**
   * Stable core error text consumed by core/internal/provider-executor.ts; preserves its existing
   * caller-facing wording.
   */
  verifiedPeerBindingExpired: 'Verified peer binding expired',
  /**
   * Stable core error text consumed by core/internal/provider-executor.ts; preserves its existing
   * caller-facing wording.
   */
  providerContextExpired: 'Provider context expired',
  /**
   * Stable core error text consumed by core/internal/provider-executor.ts; preserves its existing
   * caller-facing wording.
   */
  dispatchTargetIdMustBeANonEmptyString: 'dispatch target id must be a non-empty string',
  /**
   * Stable core error text consumed by core/internal/provider-executor.ts; preserves its existing
   * caller-facing wording.
   */
  providerNotFound: 'Provider not found',
  /**
   * Stable core error text consumed by core/internal/provider-executor.ts; preserves its existing
   * caller-facing wording.
   */
  providerDidNotSettle: 'Provider did not settle',
  /**
   * Stable core error text consumed by core/internal/provider-executor.ts; preserves its existing
   * caller-facing wording.
   */
  providerFailed: 'Provider failed',
  /**
   * Stable core error text consumed by core/internal/replay.ts; preserves its existing
   * caller-facing wording.
   */
  replayLimitsMustBePositiveSafeIntegers: 'replay limits must be positive safe integers',
  /**
   * Stable core error text consumed by core/internal/request-replay-ledger.ts; preserves its
   * existing caller-facing wording.
   */
  requestReplayLimitsMustBePositiveSafeIntegers:
    'request replay limits must be positive safe integers',
  /**
   * Stable core error text consumed by core/internal/web-rpc-plugin-host.ts; preserves its existing
   * caller-facing wording.
   */
  pluginInstallFailureDetail: (prefix: string, detail: string): string => `${prefix}: ${detail}`
} as const

/** Builds the stable role admission diagnostic at the core text owner. */
export function roleAdmissionMessage(
  role: string,
  slot: string,
  key: PropertyKey | undefined
): string {
  const safeKey =
    key === undefined
      ? 'unavailable'
      : typeof key === 'symbol'
        ? `symbol:${key.description ?? '<anonymous>'}`
        : `string:${key}`
  return `${RpcCoreErrorText.endpointModuleInvalid}; role=${role}; slot=${slot}; key=${safeKey}`
}
