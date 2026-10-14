/**
 * Owns the error-code declarations for `@migaia/store-devtools`. Under
 * `docs/contracts/error-codes.md`, `(source, code)` uniquely identifies an error. The `source` is
 * always `'@migaia/store-devtools'`. Throw sites reference these constants instead of inline
 * literals. Code values are public API. Renaming a code is a breaking change
 * (`error-code-rollout.sdd.md` §1.2).
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
   * A history/trace limit is non-finite or below one. Callers must provide a finite positive
   * integer to retain bounded diagnostics.
   */
  invalidOption: 'INVALID_OPTION',

  /**
   * One or more DevTools subscriptions failed during cleanup. The caller must inspect `errors[]`;
   * the session is terminal and cannot be revived.
   */
  cleanupFailed: 'CLEANUP_FAILED'
} as const

export type IStoreDevtoolsErrorCode =
  (typeof StoreDevtoolsErrorCode)[keyof typeof StoreDevtoolsErrorCode]
