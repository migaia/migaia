/**
 * Declares the public error codes for `@migaia/store-shared` in one place.
 *
 * The registry in `docs/contracts/error-codes.md` identifies errors by `(source, code)`. The
 * `source` is always `'@migaia/store-shared'`. Throw sites use these constants instead of inline
 * literals.
 *
 * Code values are public API. Renaming a code is a breaking change
 * (`docs/contracts/error-code-rollout.sdd.md` §1.2).
 */
export const StoreSharedErrorCode = {
  /**
   * `SharedInt32Array` is read or written after `dispose()`.
   *
   * Create a new array instead of reusing the disposed instance.
   */
  arrayDisposed: 'ARRAY_DISPOSED',

  /**
   * `SharedInt32Signal` is read or written after `dispose()`.
   *
   * Create a new signal instead of reusing the disposed instance.
   */
  signalDisposed: 'SIGNAL_DISPOSED',

  /**
   * The supplied `SharedArrayBuffer` cannot hold the required cell layout.
   *
   * Allocate a larger buffer. This is a construction input error; do not retry the same buffer.
   */
  bufferTooSmall: 'BUFFER_TOO_SMALL',

  /**
   * A `SharedInt32Array` index is outside `[0, length)`.
   *
   * Correct the index. This is a permanent input error.
   */
  indexOutOfRange: 'INDEX_OUT_OF_RANGE',

  /**
   * A seqlock does not settle within the spin limit because a cell is unstable, a lock cannot be
   * acquired, or updates keep failing.
   *
   * A writer may have crashed while holding the lock, leaving a deadlock that cannot recover.
   * Rebuild the buffer.
   */
  contentionLimit: 'CONTENTION_LIMIT',

  /**
   * `Atomics.waitAsync` is unavailable in the current environment.
   *
   * Poll with `sync()` or use a runtime that supports `waitAsync`. The library does not silently
   * fall back.
   */
  envUnsupported: 'ENV_UNSUPPORTED',

  /**
   * Construction or write input is invalid, such as a length that is not a non-negative integer or
   * a value outside the int32 range.
   *
   * Correct the input. This is a permanent input error.
   */
  invalidOption: 'INVALID_OPTION'
} as const

export type IStoreSharedErrorCode = (typeof StoreSharedErrorCode)[keyof typeof StoreSharedErrorCode]
