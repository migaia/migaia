/**
 * Package-owned stable text for validation failures introduced by the outbound framing boundary.
 * Keeping these messages here prevents the pipeline from becoming a second owner of public error
 * text.
 */
export const WebRpcErrorText = {
  /** Stable descriptor failure emitted before the kernel subscribes to a transport. */
  transportDescriptorInvalid: 'transport descriptor is invalid',
  /** Stable metadata failure emitted before the kernel subscribes to a transport. */
  transportIdentityDescriptorInvalid: 'transport identity descriptor is invalid',
  /** Stable fallback text when physical receiver registration throws a hostile value. */
  endpointRegistrationFailed: 'Endpoint registration failed',
  /** Stable aggregate message when construction and rollback both fail. */
  endpointConstructionCleanupFailed: 'Endpoint construction failed; cleanup also failed',
  /** Stable lifecycle rejection once the canonical kernel closes admission. */
  endpointDisposed: 'Endpoint disposed',
  /** Stable lifecycle message when endpoint-owned resource release reports cleanup failures. */
  endpointDisposalCleanupFailed: 'Endpoint disposal completed with cleanup errors',
  /** Stable aggregate text when listener registration fails and rollback also reports failures. */
  listenerRegistrationCleanupFailed: 'listener registration failed; cleanup also failed',
  /** Stable aggregate text for listener and reporter failures surfaced at an adapter boundary. */
  listenerCleanupFailed: 'listener cleanup failed',
  /** Stable aggregate text for browser and Node MessagePort terminal cleanup failures. */
  messagePortCleanupFailed: '[rpc] message port cleanup failed',
  /** Stable aggregate text when RTC subscription setup and its rollback both fail. */
  rtcSubscriptionCleanupFailed: 'subscription setup failed',
  /** Stable aggregate text when WebTransport terminal cleanup reports multiple failures. */
  webTransportCleanupFailed: 'WebTransport close failed',
  /** Stable conflict text when two attachments claim the same decoded frame kind. */
  endpointRouteOwned: 'endpoint route is already owned',
  /** Stable conflict text when two attachments claim the same runtime owner. */
  endpointOwnerOwned: 'endpoint runtime owner is already registered',
  /** Stable composition admission text consumed by core before transport side effects. */
  endpointModuleInvalid: 'endpoint module token is invalid',
  /** Stable composition conflict text consumed by core duplicate-token admission. */
  endpointModuleDuplicated: 'endpoint module is duplicated',
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
  /** Stable fallback when a remote failure omits its public message. */
  remoteRequestFailed: 'Remote request failed',
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
  /** Describes a byte-length hook result that cannot safely represent its input. */
  invalidByteLengthMeasurement: 'Custom byteLength returned an unsafe measurement',
  /** Describes an encoded message that exceeds the configured message budget. */
  encodedMessageTooLarge: 'Encoded message exceeds configured maximum',
  /** Describes a transfer list that cannot accompany chunked output. */
  transferUnsupportedForChunking: 'Transfer lists are unsupported for chunked messages',
  /** Describes a transfer list that cannot accompany authenticated output. */
  transferUnsupportedWithAuthentication: 'Transfer lists are unsupported with authentication',
  /** Describes a splitter result that violates the bounded framing contract. */
  invalidChunkFrames: 'Chunk splitter returned invalid frames',
  /** Stable range text for the minimum UTF-8 chunk budget accepted by WebRPC. */
  utf8ChunkBudgetInvalid: 'maxBytes must be at least 4 bytes',
  /** Describes a protocol codec result whose runtime type disagrees with its declaration. */
  protocolEncodedType: (encodedType: string): string =>
    `Protocol encoded output must be ${encodedType}`,
  /** Describes an authentication result whose runtime type disagrees with transport. */
  protectedEncodedType: (encodedType: string): string =>
    `Protected frame output must be ${encodedType}`,
  /** Identifies an authentication transform that failed before transport send. */
  authenticationFailed: 'Authentication transform failed'
} as const
