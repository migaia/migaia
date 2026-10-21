/**
 * Declares the public error codes for `@migaia/store-shared` in one place.
 *
 * Package-owned failures use the pair `(source, code)`, with source `@migaia/store-shared`.
 * Complete foreign updater identities retain their original owner instead of being relabeled. Throw
 * sites use these constants instead of inline literals.
 *
 * Code values are public API. Renaming a code is a breaking change.
 */
export const StoreSharedErrorCode = {
  /**
   * The public array updater throws before lock acquisition. Unclassified native errors receive
   * this identity; complete foreign identities remain with their owner and frozen values remain
   * reachable through cause. Correct the callback; the shared cell remains usable.
   */
  updateFailed: 'UPDATE_FAILED',
  /**
   * A high-level `SharedInt32Array` read, write, synchronization or watch operation runs after
   * dispose(), or an extension explicitly checks assertActive(). Unchecked low-level cell
   * primitives do not perform that lifecycle check themselves.
   *
   * Create a new array instead of reusing the disposed instance.
   */
  arrayDisposed: 'ARRAY_DISPOSED',

  /**
   * A `SharedInt32Signal` value read/write, peek(), sync() or watch() runs after dispose().
   * Metadata and isStale() do not use this active check.
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
   * A checked `SharedInt32Array` get(), set(), update() or sync(index) receives a noninteger index
   * or an index outside `[0, length)`. Low-level cell primitives require their caller to validate.
   *
   * Correct the index. This is a permanent input error.
   */
  indexOutOfRange: 'INDEX_OUT_OF_RANGE',

  /**
   * A seqlock does not settle because a cell stays unstable or its lock stays held for the
   * sustained contention window (about 1 s, after spin rounds with backoff), or `update()` keeps
   * losing the write race for its whole spin limit.
   *
   * This can reflect continuing competition, a delayed writer or a writer that abandoned a held
   * lock; the code alone does not distinguish them. Reduce contention or investigate the writer. If
   * a writer permanently left the lock odd, replace the buffer rather than forcing it unlocked.
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

/** Public package-owned failure identities, for branching together with STORE_SHARED_SOURCE. */
export type IStoreSharedErrorCode = (typeof StoreSharedErrorCode)[keyof typeof StoreSharedErrorCode]
