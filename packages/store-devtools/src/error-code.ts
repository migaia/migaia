/**
 * Owns the error-code declarations for `@migaia/store-devtools`. Under
 * `docs/contracts/error-codes.md`, `(source, code)` uniquely identifies an error. The `source` is
 * always `'@migaia/store-devtools'`. Throw sites reference these constants instead of inline
 * literals. Code values are public API. Renaming a code is a breaking change.
 */
export const StoreDevtoolsErrorCode = {
  /**
   * Rejects mutations on a disposed `createStoreDevTools` session. Create a new session instead of
   * reusing it. Readonly queues remain readable after disposal.
   */
  sessionDisposed: 'SESSION_DISPOSED',

  /**
   * Rejects a `jumpTo(id)` whose entry is absent from history or trimmed by `maxHistory`. Check
   * whether `id` remains in `history`. Correct the parameter instead of retrying the same missing
   * entry.
   */
  unknownHistoryEntry: 'UNKNOWN_HISTORY_ENTRY',

  /**
   * Options are not an object, an option getter fails, a configured callback is not a function, a
   * queue limit is not a positive safe integer, or tree depth is not a non-negative safe integer.
   * Correct the configuration before retrying.
   */
  invalidOption: 'INVALID_OPTION',

  /**
   * Multiple subscription cleanups failed, or construction failed together with rollback cleanup.
   * The caller must inspect `errors[]`, whose first entry retains the construction failure; the
   * session is terminal and cannot be revived.
   */
  cleanupFailed: 'CLEANUP_FAILED',

  /**
   * A diagnostic clock, snapshot clone, or action property read failed without an existing semantic
   * identity. Manual calls throw; automatic diagnostics report the failure without interrupting
   * business writes. Correct the callback or input; the original error remains the same instance or
   * reachable by cause.
   */
  callbackFailed: 'CALLBACK_FAILED'
} as const

export type IStoreDevtoolsErrorCode =
  (typeof StoreDevtoolsErrorCode)[keyof typeof StoreDevtoolsErrorCode]
