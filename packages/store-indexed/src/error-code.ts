/**
 * Owns the error-code declarations for `@migaia/store-indexed`. Under
 * `docs/contracts/error-codes.md`, `(source, code)` uniquely identifies an error. The `source` is
 * always `'@migaia/store-indexed'`. Throw sites reference these constants instead of inline
 * literals. Code values are public API. Renaming a code is a breaking change.
 */
export const StoreIndexedErrorCode = {
  /**
   * Rejects invalid constructor/options/input/iterator, debugName, object key or updater shape.
   * Correct the named argument; no partial construction or replacement is committed.
   */
  invalidOption: 'INVALID_OPTION',
  /**
   * Rejects reads or writes after collection disposal. Create a new collection instead of reusing
   * the disposed instance.
   */
  collectionDisposed: 'COLLECTION_DISPOSED',

  /**
   * A synchronous mutation guard or ObservableObject updater fails without an existing package
   * identity. Mutable native errors retain their object/type/stack; fallback cause/errors retain
   * the original. The outer mutation is not committed; callback-owned side effects are not rolled
   * back.
   */
  callbackFailed: 'CALLBACK_FAILED',

  /**
   * Rejects an out-of-range `ObservableArray.set()` index. Check that the index is within `[0,
   * length)`. Correct the index instead of retrying the same invalid input.
   */
  indexOutOfRange: 'INDEX_OUT_OF_RANGE',

  /**
   * Rejects a noninteger `ObservableArray` index. Correct the index. Array indices must be
   * integers.
   */
  invalidIndex: 'INVALID_INDEX',

  /**
   * Rejects a tracked collection read from another runtime. Use the same runtime for the collection
   * and its observing effect or observer. Untracked `peek` reads are exempt.
   */
  crossRuntime: 'CROSS_RUNTIME'
} as const

export type IStoreIndexedErrorCode =
  (typeof StoreIndexedErrorCode)[keyof typeof StoreIndexedErrorCode]
