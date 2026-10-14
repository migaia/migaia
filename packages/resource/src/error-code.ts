/**
 * Owns the error-code declarations for `@migaia/resource`. Under `docs/contracts/error-codes.md`,
 * `(source, code)` uniquely identifies an error. The `source` is always `'@migaia/resource'`. Throw
 * sites reference these constants instead of inline literals. This table assigns codes to earlier
 * bare-error messages (`migration.sdd.md` §3.7.2). `REQUEST_ABORTED` and `REQUEST_CANCELLED` retain
 * `DOMException` with `name === 'AbortError'`. Callers, including `store-react` suspension paths,
 * recognize that native error type. Codes attach as properties and never replace the native type.
 * Code values are public API. Renaming a code is a breaking change.
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
   * Identifies the `DOMException` used to abort a request and notify the `fetcher` through its
   * signal. Preserves `DOMException` with the `AbortError` name and attaches the semantic code as a
   * property. Callers usually recognize `error.name === 'AbortError'` and handle cancellation
   * quietly.
   */
  requestAborted: 'REQUEST_ABORTED',

  /**
   * Identifies the `DOMException` in the `cancelled` state when explicit `cancel()` cancels a
   * pending request. Preserves the native `AbortError` type. Unlike `REQUEST_ABORTED`, which
   * identifies the request-abort signal reason, this code identifies explicit cancellation state.
   */
  requestCancelled: 'REQUEST_CANCELLED',

  /**
   * Reports timer or listener cleanup failure after request cancellation converges state.
   * `REQUEST_CANCELLED` identifies the `AbortError` stored in the cancelled state. This code
   * separates cleanup failures from state errors under `migration.sdd.md` §3.7.2. Record the
   * cleanup failure and continue treating the `Resource` as cancelled.
   */
  cancellationCleanupFailed: 'CANCELLATION_CLEANUP_FAILED',

  /**
   * Reports a missing active or cached Promise when reading `promise` or materializing `pending` or
   * `idle`. This usually indicates inconsistent intermediate state. Check for internal state
   * changes that bypass the normal `refetch()` or `invalidate()` paths.
   */
  noActivePromise: 'NO_ACTIVE_PROMISE',

  /**
   * Rejects a `hydrate()` snapshot whose `version` is not `1`, whose `updatedAt` is nonfinite, or
   * whose `expiresAt` is neither `null` nor finite. Also reports a snapshot accessor that throws.
   * `null` represents an unbounded expiration. Snapshots commonly come from SSR serialization or
   * persistence. Invalid formats fail at load rather than leaving the resource with a corrupt
   * expiration. Check the snapshot creation and serialization path.
   */
  invalidSnapshot: 'INVALID_SNAPSHOT',

  /**
   * Rejects construction or operation options such as invalid `ttl`, retry counts, or `retryDelay`.
   * Validation rejects invalid configuration before it enters the state machine. Correct the
   * supplied options.
   */
  invalidOption: 'INVALID_OPTION',

  /**
   * Reports a throwing `.then` getter on a value the `fetcher` throws for Suspense. The probe
   * cannot determine whether the value is a thenable. `AggregateError.errors` retains both the
   * original thrown value and getter failure by identity. Enforces `error-codes.md` §2 and §3.2.
   * Inspect the hostile getter instead of silently retrying it as an ordinary fetch failure.
   */
  suspenseProbeFailed: 'SUSPENSE_PROBE_FAILED'
} as const

export type IResourceErrorCode = (typeof ResourceErrorCode)[keyof typeof ResourceErrorCode]
