/** SQLite boundary codes keep native failures reachable through cause. */
export const SqliteErrorCode = {
  /** Native opening, SQL, schema or close failed; inspect the preserved cause. */
  sqliteFailed: 'SQLITE_FAILED',
  /** Transaction callback, ownership, commit or rollback failed. */
  transactionFailed: 'TRANSACTION_FAILED',
  /** Another public channel owns the same key; explicitly request replacement. */
  duplicateKey: 'DUPLICATE_KEY',
  /** Persisted data is damaged; preserve it and inspect the decoder cause. */
  decodeFailed: 'DECODE_FAILED'
} as const
/** Codes share the runtime table rather than independent string declarations. */
export type ISqliteErrorCode = (typeof SqliteErrorCode)[keyof typeof SqliteErrorCode]
