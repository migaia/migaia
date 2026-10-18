/**
 * Declares the public error codes for `@migaia/store-worker` in one place.
 *
 * The registry in `docs/contracts/error-codes.md` identifies errors by `(source, code)`. The
 * `source` is always `'@migaia/store-worker'`. Throw sites use these constants instead of inline
 * literals.
 *
 * Code values are public API. Renaming a code is a breaking change
 * (`docs/contracts/error-code-rollout.sdd.md` §1.2).
 */
export const StoreWorkerErrorCode = {
  /**
   * Worker options, parser encode/decode members or the post callback are invalid or inaccessible.
   * Correct the factory input; native getter failures retain identity or an original cause.
   */
  invalidOption: 'INVALID_OPTION',
  /**
   * A worker adapter is called after disposal.
   *
   * Create a new adapter instead of reusing the disposed instance.
   */
  adapterDisposed: 'ADAPTER_DISPOSED',

  /**
   * Worker serialization is cooperatively cancelled through an `AbortSignal` or explicit stream
   * stop.
   *
   * Treat this as cancellation. Transfer can detach input after a send, but pre-cancelled requests
   * have not sent it; inspect the actual backing buffer before deciding whether retry is safe.
   */
  requestAborted: 'REQUEST_ABORTED',

  /**
   * A request chunk sent to the worker has an invalid shape.
   *
   * Check that the payload satisfies `ISerializeChunk`. This is a protocol error.
   */
  invalidRequestChunk: 'INVALID_REQUEST_CHUNK',

  /**
   * A chunk returned by the worker has an invalid shape.
   *
   * Check the worker parser output. This is a worker implementation error.
   */
  invalidResponseChunk: 'INVALID_RESPONSE_CHUNK',

  /**
   * Both endpoint and owned Worker cleanup failed during parser disposal. A single failure keeps
   * its existing identity rather than receiving this aggregate code. The caller must inspect
   * `cause`/`errors[]` and treat the parser as terminal.
   */
  cleanupFailed: 'CLEANUP_FAILED'
} as const

export type IStoreWorkerErrorCode = (typeof StoreWorkerErrorCode)[keyof typeof StoreWorkerErrorCode]
