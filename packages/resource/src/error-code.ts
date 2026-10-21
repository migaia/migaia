/**
 * Owns the error-code declarations for `@migaia/resource`. Under `docs/contracts/error-codes.md`,
 * `(source, code)` uniquely identifies an error. The `source` is always `'@migaia/resource'`. Throw
 * sites reference these constants instead of inline literals. This table assigns codes to earlier
 * bare-error messages. `REQUEST_ABORTED` and `REQUEST_CANCELLED` retain `DOMException` with `name
 * === 'AbortError'`. Callers, including `store-react` suspension paths, recognize that native error
 * type. Codes attach as properties and never replace the native type. Code values are public API.
 * Renaming a code is a breaking change.
 */
export const ResourceErrorCode = {
  /**
   * Rejects operations guarded by `#assertUsable()` after the `Resource` is disposed. This prevents
   * reading stale state after tracking stops. Repeated `dispose()` remains a no-op, and lifecycle
   * inspection getters remain available. Use a new `Resource` for further data reads or
   * operations.
   */
  resourceDisposed: 'RESOURCE_DISPOSED',

  /**
   * Identifies the native AbortError for a stopped request. Resource-initiated cancellation uses
   * this same error as signal.reason; lifecycle-owned replacement reasons remain on its cause.
   * Callers usually recognize `error.name === 'AbortError'` and handle cancellation quietly.
   */
  requestAborted: 'REQUEST_ABORTED',

  /**
   * Identifies the `DOMException` in the `cancelled` state when explicit `cancel()` cancels a
   * pending request. Preserves the native `AbortError` type. Unlike `REQUEST_ABORTED`, which
   * identifies request rejection, this code identifies explicit cancellation state.
   */
  requestCancelled: 'REQUEST_CANCELLED',

  /**
   * Reports timer or listener cleanup failure after request cancellation converges state.
   * `REQUEST_CANCELLED` identifies the `AbortError` stored in the cancelled state. This code
   * separates cleanup failures from state errors. Record the cleanup failure and continue treating
   * the `Resource` as cancelled.
   */
  cancellationCleanupFailed: 'CANCELLATION_CLEANUP_FAILED',

  /**
   * Reports a missing active or cached Promise when reading `promise` or materializing `pending` or
   * `idle`. This usually indicates inconsistent intermediate state. Check for internal state
   * changes that bypass the normal `refetch()` or `invalidate()` paths.
   */
  noActivePromise: 'NO_ACTIVE_PROMISE',

  /**
   * Rejects a version other than 2, negative/nonfinite age or remaining lifetime, or durations that
   * cannot be rebased into finite local scheduler timestamps. Accessor failures retain their cause.
   * `remainingTtlMs: null` means unbounded lifetime. Migrate old absolute-time snapshots
   * explicitly; their sender clock origin cannot be inferred on the receiver.
   */
  invalidSnapshot: 'INVALID_SNAPSHOT',

  /**
   * Rejects construction or operation options such as invalid `ttl`, retry counts, or `retryDelay`.
   * Validation rejects invalid configuration before it enters the state machine. Correct the
   * supplied options. Retry policy failures retain the triggering fetch error in their chain.
   */
  invalidOption: 'INVALID_OPTION',

  /**
   * Reports a throwing `.then` getter on a value the `fetcher` throws for Suspense. The probe
   * cannot determine whether the value is a thenable. `AggregateError.errors` retains both the
   * original thrown value and getter failure by identity. Enforces `error-codes.md`. Inspect the
   * hostile getter instead of silently retrying it as an ordinary fetch failure.
   */
  suspenseProbeFailed: 'SUSPENSE_PROBE_FAILED',

  /**
   * A fetcher failure exhausted retry without an existing semantic identity. Mutable native errors
   * retain type, identity, and stack; immutable errors/non-Error values stay reachable on cause.
   * Already classified failures retain their originating package. Inspect the request failure
   * instead of treating it as cancellation or an invalid option.
   */
  fetchFailed: 'FETCH_FAILED',

  /**
   * `createResource()` received a non-function setup, or setup returned something other than a
   * fetcher function. Registered setup cleanups have already run. Pass a setup callback that
   * returns `(ctx) => data | Promise<data>`.
   */
  setupInvalid: 'RESOURCE_SETUP_INVALID',

  /**
   * `onDispose()` was called on a setup context after setup returned (for example from an escaped
   * context inside an async callback). The cleanup is rejected instead of leaking. Register every
   * cleanup synchronously inside setup.
   */
  setupClosed: 'RESOURCE_SETUP_CLOSED'
} as const

export type IResourceErrorCode = (typeof ResourceErrorCode)[keyof typeof ResourceErrorCode]
