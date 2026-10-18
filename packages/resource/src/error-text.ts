/** Stable resource diagnostics for scheduler admission and cleanup failures. */
export const ResourceErrorText = {
  /** Native cancellation name used by DOMException consumers across package boundaries. */
  abortName: 'AbortError',
  /** Final unclassified fetcher rejection is owned by Resource after retry policy is exhausted. */
  fetchFailed: 'resource fetch failed',
  /** Request execution stopped after the current generation lost its authority. */
  requestAborted: 'resource request aborted',
  /** Explicit cancel stores this native AbortError in the stable cancelled state. */
  requestCancelled: 'resource request cancelled',
  /** Passive Promise/read access has neither a running request nor a settled cached result. */
  noActivePromise: 'resource has no active or cached promise',
  /** Terminal resources reject all new cache and request operations. */
  resourceDisposed: 'cannot use a disposed resource',
  /** Suspense probing failed; its aggregate preserves the thrown value and getter error. */
  suspenseProbeFailed: 'resource fetcher threw a value whose then getter failed',
  /** Explains that a public constructor option could not be read before Resource admission. */
  optionsSnapshotFailed: 'resource options snapshot failed',
  /** Explains that reading the construction-time initial snapshot option failed before admission. */
  initialSnapshotAccessorFailed: 'resource initial snapshot getter failed',
  /** Explains that reading the construction-time autostart option failed before admission. */
  autoStartAccessorFailed: 'resource autoStart getter failed',
  /** Explains that a cache snapshot failed its structural admission check. */
  invalidSnapshot: 'invalid resource cache snapshot',
  /** Explains that reading the diagnostic name option failed before admission. */
  debugNameAccessorFailed: 'resource debugName getter failed',
  /** Explains that scheduler task admission or cancellation violated the injected contract. */
  schedulerTaskOperationFailed: 'resource scheduler task operation failed',
  /** Explains that reading an injected scheduler accessor failed before resource construction. */
  schedulerAccessorFailed: 'resource scheduler getter failed',
  /** Explains that an injected scheduler lacks the required clock and scheduling methods. */
  schedulerInvalid: 'resource scheduler must provide now() and schedule() functions',
  /**
   * Explains that an abort signal rejected listener registration before request observation could
   * begin.
   */
  signalRegistrationFailed: 'resource abort signal registration failed',
  /** Explains that request cancellation converged state but cleanup still failed. */
  cancellationCleanupFailed: 'resource request cancellation cleanup failed',
  /** Explains that a finite TTL would produce an unrepresentable expiration timestamp. */
  ttlExpirationOverflow: 'resource ttl expiration must remain finite',
  /** Explains that a numeric TTL violates the non-negative finite-domain contract. */
  ttlInvalid: 'resource ttl must be non-negative',
  /** Retry policy callbacks failed; the original request error remains reachable. */
  retryPolicyFailed: 'resource retry policy failed',
  /** Explains that retry count violates its non-negative integer contract. */
  retryInvalid: 'resource retry count must be a non-negative integer',
  /** Explains that a retry delay violates the scheduler delay contract. */
  retryDelayInvalid: 'resource retry delay must be a non-negative finite number',
  /** Explains that a boolean constructor option received a non-boolean value. */
  booleanOptionInvalid: 'resource boolean option must be boolean',
  /** Explains that the debug name constructor option received a non-string value. */
  debugNameInvalid: 'resource debugName must be a string'
} as const

export type IResourceErrorText = (typeof ResourceErrorText)[keyof typeof ResourceErrorText]
