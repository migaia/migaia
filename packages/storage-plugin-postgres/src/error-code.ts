/** All PostgreSQL backend boundaries share this registered domain. */
export const ERROR_SOURCE = 'storage.backend.postgres'
/** Each code identifies one native or transaction boundary; original failures remain reachable. */
export const PostgresErrorCode = {
  /** An uncategorized native query or connection failed; inspect its original cause. */
  sqlFailed: 'SQL_FAILED',
  /** A persisted canonical key, value or metadata row could not be decoded. */
  decodeFailed: 'DECODE_FAILED',
  /** A callback, accepted operation or transaction lifecycle failed and rolled back. */
  transactionFailed: 'TRANSACTION_FAILED',
  /** A known standard-channel write found the same key in an incompatible channel. */
  duplicateKey: 'DUPLICATE_KEY'
} as const
/** Public semantic codes belong to this domain rather than a driver SQLSTATE. */
export type IPostgresErrorCode = (typeof PostgresErrorCode)[keyof typeof PostgresErrorCode]
