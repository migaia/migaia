/** Durable store failures retain one package-owned identity across every carrier. */
export const ERROR_SOURCE = 'logging.durable'

/** Stable durable failures keep the original semantic codes after the package move. */
export const LogDurableErrorCode = {
  /** JSON admission rejects unsupported payloads; callers must correct the record. */
  logPayloadInvalid: 'LOG_PAYLOAD_INVALID',
  /** Another connection owns the SQLite lock; wait for its owner or choose another path. */
  logStoreLocked: 'LOG_STORE_LOCKED',
  /** A store already has an installed borrower; uninstall that borrower before reusing it. */
  logStoreInUse: 'LOG_STORE_IN_USE',
  /** The current runtime lacks a supported SQLite builtin; select a supported carrier. */
  logStoreUnavailable: 'LOG_STORE_UNAVAILABLE',
  /** Native storage or cleanup failed; inspect cause before reopening an uncertain commit. */
  logStoreIoFailed: 'LOG_STORE_IO_FAILED',
  /** Recovery found inconsistent committed data; do not overwrite the recovery evidence. */
  logStoreCorrupt: 'LOG_STORE_CORRUPT',
  /** A sequence exceeds safe integer representation; continue in a fresh store. */
  logSequenceExhausted: 'LOG_SEQUENCE_EXHAUSTED',
  /** Truncation passed a subscriber's retained cursor; explicitly choose a retained restart point. */
  logSubscriptionTruncated: 'LOG_SUBSCRIPTION_TRUNCATED',
  /** A requested transition targets a missing or terminal WAL record; terminal state cannot reopen. */
  walRecordInvalid: 'WAL_RECORD_INVALID',
  /** The undo transaction still owns active images; forget it or choose another identity. */
  undoRecordExists: 'UNDO_RECORD_EXISTS',
  /** An argument or accessor violates durable admission; correct it and inspect its original cause. */
  invalidOption: 'INVALID_OPTION',
  /** This resource or installation revoked admission; create a new owner instead of reviving it. */
  runtimeShuttingDown: 'RUNTIME_SHUTTING_DOWN'
} as const

/** Errors use these values together with the durable source and original cause chain. */
export type ILogDurableErrorCode = (typeof LogDurableErrorCode)[keyof typeof LogDurableErrorCode]
