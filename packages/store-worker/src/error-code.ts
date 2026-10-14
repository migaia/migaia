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
  /** Worker parser/adapter options were not an object at the JavaScript boundary. */
  invalidOption: 'INVALID_OPTION',
  /**
   * A worker adapter is called after disposal.
   *
   * Create a new adapter instead of reusing the disposed instance.
   */
  adapterDisposed: 'ADAPTER_DISPOSED',

  /**
   * Worker serialization is cooperatively cancelled through `AbortSignal`.
   *
   * Treat this as cancellation. With `ownership: 'transfer'`, the input is already detached and
   * cannot be retried.
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
   * Worker wire chunks cannot be merged because the list is empty or a value chunk is mixed into a
   * byte stream.
   *
   * Check the worker parser output chunks. This is a parser implementation error.
   */
  chunkMergeFailed: 'CHUNK_MERGE_FAILED',

  /**
   * Endpoint and/or owned Worker cleanup failed during parser disposal. The caller must inspect
   * `cause`/`errors[]` and treat the parser as terminal.
   */
  cleanupFailed: 'CLEANUP_FAILED'
} as const

export type IStoreWorkerErrorCode = (typeof StoreWorkerErrorCode)[keyof typeof StoreWorkerErrorCode]
