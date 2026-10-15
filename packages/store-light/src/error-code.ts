/**
 * Declares the public error codes for `@migaia/store-light` in one place.
 *
 * The registry in `docs/contracts/error-codes.md` identifies errors by `(source, code)`. The
 * `source` is always `'@migaia/store-light'`. Throw sites use these constants instead of inline
 * literals.
 *
 * Code values are public API. Renaming a code is a breaking change
 * (`docs/contracts/error-code-rollout.sdd.md` §1.2).
 */
export const StoreLightErrorCode = {
  /**
   * Store fields, snapshots, or subscriptions are accessed after disposal.
   *
   * Use `createStore()` or `createAsyncStore()` to create a new instance.
   */
  storeDisposed: 'STORE_DISPOSED',

  /**
   * A resource is read, captured, or retained while closing or disposed, or its factory returns a
   * disposed value.
   *
   * Stop using the resource. The `disposed` state is terminal.
   */
  resourceDisposed: 'RESOURCE_DISPOSED',

  /**
   * A resource capture token is invalid or has already been consumed by `commit` or `discard`.
   *
   * Check the token lifecycle. A token is valid only before consumption and can be committed once.
   */
  captureInvalid: 'CAPTURE_INVALID',

  /**
   * A retain or capture request names an unknown or no longer visible resource version.
   *
   * Read the version from the current snapshot instead of caching version IDs across reloads.
   */
  unknownVersion: 'UNKNOWN_VERSION',

  /**
   * A resource factory with `dispose` returns a primitive value, so reference identity cannot track
   * ownership.
   *
   * Return an object or function for a resource with explicit disposal to provide `$dispose` or
   * reference identity.
   */
  identityRequired: 'IDENTITY_REQUIRED',

  /**
   * `storeReady()` receives an object with no initialization Promise registered by this package
   * instance. Both synchronous `createStore()` and `createAsyncStore()` register readiness.
   *
   * Pass the actual constructed Store instead of an unrelated or foreign object.
   */
  noAsyncInit: 'NO_ASYNC_INIT',

  /**
   * Asynchronous state is accessed while store initialization is pending or has failed.
   *
   * Await `storeReady()` before accessing asynchronous fields. Treat rejection as initialization
   * failure instead of retrying reads.
   */
  storeNotReady: 'STORE_NOT_READY',

  /**
   * Store initialization and its subsequent cleanup both fail. Both failures are thrown in an
   * `AggregateError`.
   *
   * The initialization and cleanup errors remain reachable through `cause` or `errors` (E-T13).
   * Treat this as initialization failure and inspect the cleanup failure.
   */
  initAndCleanupFailed: 'INIT_AND_CLEANUP_FAILED',

  /**
   * An asynchronous `IFieldBuilder` is passed to the synchronous `createStore()` contract.
   *
   * Use `createAsyncStore()` for asynchronous field builders.
   */
  syncFieldRequired: 'SYNC_FIELD_REQUIRED',

  /**
   * A diagnostic reports that writes after the first `await` in an asynchronous action are outside
   * its batch.
   *
   * This code is reported through `Runtime.reportError`, not thrown. Wrap subsequent writes in
   * `$batch()`.
   */
  actionBatchBoundary: 'ACTION_BATCH_BOUNDARY',

  /**
   * The host lacks `WeakRef` or `FinalizationRegistry` required by `ResourceCaptureRegistry`.
   *
   * Enable these capabilities in the host sandbox. This is a deployment issue.
   */
  envUnsupported: 'ENV_UNSUPPORTED',

  /**
   * Input or field validation fails for `keepAliveMs`, a non-writable `$set` target, or an unknown
   * `$hydrate` field.
   *
   * Correct the field or value named in the error message.
   */
  invalidOption: 'INVALID_OPTION'
} as const

export type IStoreLightErrorCode = (typeof StoreLightErrorCode)[keyof typeof StoreLightErrorCode]
