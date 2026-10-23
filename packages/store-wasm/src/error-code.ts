/** Stable error domain owned by this code table; package moves preserve this identity. */
export const ERROR_SOURCE = 'store.wasm'

/**
 * Package-owned failures paired with source `store.wasm`. Native WASM loading/trap errors and
 * complete foreign identities retain their original behavior. Code values are public API.
 */
export const StoreWasmErrorCode = {
  /**
   * Rejects synchronous field creation or allocation before `ensureWasm()` finishes, or after
   * initialization fails. First await `ensureWasm()`, or use the `StoreProvider` `ready` barrier to
   * finish initialization.
   */
  notInitialized: 'NOT_INITIALIZED',

  /**
   * Rejects scalar/record value access and array data operations after field disposal. Create a new
   * field instead of reusing it; metadata such as disposed and fixed array length remains
   * readable.
   */
  fieldDisposed: 'FIELD_DISPOSED',

  /**
   * Reports field initialization cancelled through an AbortSignal. Preserve an unclassified native
   * reason by identity/class/stack; complete foreign identities remain with their owner, and other
   * reasons stay reachable through cause. Handle it as cooperative cancellation.
   */
  initAborted: 'INIT_ABORTED',

  /** Rejects a `wasm.record` field named `dispose` or `disposed`. Choose a different field name. */
  reservedFieldName: 'RESERVED_FIELD_NAME',

  /**
   * Reports no usable allocation id/pointer, failed array alignment, or corrupt stored string
   * length. Check allocation availability and memory integrity. Invalid requested sizes are
   * INVALID_OPTION rather than this allocation/memory failure.
   */
  allocationFailed: 'ALLOCATION_FAILED',

  /**
   * Rejects invalid field construction or write arguments, including excessive length, invalid
   * `granularity`, out-of-range indices or ranges, or inaccessible ArrayLike length/items. Keep the
   * original read failure reachable. Correct the parameter instead of retrying the same invalid
   * input.
   */
  invalidOption: 'INVALID_OPTION',

  /**
   * Reports multiple owned-resource cleanup failures during field release or construction rollback.
   * Inspect `AggregateError.errors`. It preserves all original cleanup failures in execution
   * order.
   */
  cleanupFailed: 'CLEANUP_FAILED',

  /**
   * Rejects allocation after an arena export used by this package on the shared instance raised
   * `WebAssembly.RuntimeError` (a trap). A trap can leave the Rust arena borrow held, so every
   * later export would trap again; the instance is unusable for the rest of the page or process.
   * `cause` is the original trap. Reload the page or restart the process; retrying cannot succeed.
   */
  instancePoisoned: 'INSTANCE_POISONED'
} as const

/** Public union of Store-owned failure values, distinct from unmodified native WASM errors. */
export type IStoreWasmErrorCode = (typeof StoreWasmErrorCode)[keyof typeof StoreWasmErrorCode]
