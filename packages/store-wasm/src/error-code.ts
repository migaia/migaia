/**
 * Owns the error-code declarations for `@migaia/store-wasm`. Under `docs/contracts/error-codes.md`,
 * `(source, code)` uniquely identifies an error. The `source` is always `'@migaia/store-wasm'`.
 * Throw sites reference these constants instead of inline literals. Code values are public API.
 * Renaming a code is a breaking change (`error-code-rollout.sdd.md` §1.2).
 */
export const StoreWasmErrorCode = {
  /**
   * Rejects synchronous field creation or allocation before `ensureWasm()` finishes, or after
   * initialization fails. First await `ensureWasm()`, or use the `StoreProvider` `ready` barrier to
   * finish initialization.
   */
  notInitialized: 'NOT_INITIALIZED',

  /**
   * Rejects reads, writes, or other use of a disposed WASM field. Create a new field instead of
   * reusing it. `detail` identifies the operation.
   */
  fieldDisposed: 'FIELD_DISPOSED',

  /**
   * Reports field initialization cancelled through an `AbortSignal`. Handle it as cooperative
   * cancellation.
   */
  initAborted: 'INIT_ABORTED',

  /** Rejects a `wasm.record` field named `dispose` or `disposed`. Choose a different field name. */
  reservedFieldName: 'RESERVED_FIELD_NAME',

  /**
   * Reports WASM allocation failure or invalid alignment or memory length. Examples include
   * `byteLen` exceeding the Wasm32 limit, failed 8-byte alignment, or corrupt stored length. Check
   * allocation parameters and memory integrity. This is an allocation or memory failure rather than
   * a logic error.
   */
  allocationFailed: 'ALLOCATION_FAILED',

  /**
   * Rejects invalid field construction or write arguments, including excessive length, invalid
   * `granularity`, or out-of-range indices or ranges. Correct the parameter instead of retrying the
   * same invalid input.
   */
  invalidOption: 'INVALID_OPTION',

  /**
   * Reports multiple owned-resource cleanup failures during field release or construction rollback.
   * Inspect `AggregateError.errors`. It preserves all original cleanup failures in execution
   * order.
   */
  cleanupFailed: 'CLEANUP_FAILED',

  /**
   * Rejects allocation after an earlier call into the shared `@migaia/wasm` instance raised
   * `WebAssembly.RuntimeError` (a trap). A trap can leave the Rust arena borrow held, so every
   * later export would trap again; the instance is unusable for the rest of the page or process.
   * `cause` is the original trap. Reload the page or restart the process; retrying cannot succeed.
   */
  instancePoisoned: 'INSTANCE_POISONED'
} as const

export type IStoreWasmErrorCode = (typeof StoreWasmErrorCode)[keyof typeof StoreWasmErrorCode]
