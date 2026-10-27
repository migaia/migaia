import { isStorageErrorFamily } from '@migaia/storage-host/sdk'
import {
  isStorageContractError,
  StorageContractError,
  StorageContractErrorCode
} from '@migaia/storage-contract'
import { ERROR_SOURCE, SqliteErrorCode, type ISqliteErrorCode } from './error-code.js'
import { SqliteErrorText } from './error-text.js'
/** Attach the public package identity without replacing the native error type or stack. */
export function sqliteError(
  code: ISqliteErrorCode,
  cause?: unknown
): Error & { readonly source: string; readonly code: ISqliteErrorCode } {
  /** One stable message corresponds to each semantic boundary. */
  const text =
    code === SqliteErrorCode.sqliteFailed
      ? SqliteErrorText.sqliteFailed
      : code === SqliteErrorCode.transactionFailed
        ? SqliteErrorText.transactionFailed
        : code === SqliteErrorCode.duplicateKey
          ? SqliteErrorText.duplicateKey
          : SqliteErrorText.decodeFailed
  /** Original native/codec failure remains exactly reachable. */
  const error = new Error(text, { cause })
  Object.defineProperties(error, {
    source: { value: ERROR_SOURCE, enumerable: true },
    code: { value: code, enumerable: true }
  })
  return error as Error & { readonly source: string; readonly code: ISqliteErrorCode }
}
/** Owner normalization is idempotent and preserves original cancellation and concurrency codes. */
export function normalizeTransactionFailure(
  error: unknown
): Error & { readonly source: string; readonly code: string } {
  if (isStorageErrorFamily(error) && !isStorageContractError(error)) return error
  if (
    error instanceof StorageContractError &&
    (error.code === StorageContractErrorCode.aborted ||
      error.code === StorageContractErrorCode.lockRejected ||
      error.code === StorageContractErrorCode.lockTimeout ||
      error.code === StorageContractErrorCode.lockLost ||
      error.code === StorageContractErrorCode.writeConflict ||
      error.code === StorageContractErrorCode.concurrencyPolicyFailed)
  )
    return error
  if (
    error instanceof Error &&
    'source' in error &&
    error.source === ERROR_SOURCE &&
    'code' in error &&
    error.code === SqliteErrorCode.transactionFailed
  )
    return error as Error & { readonly source: string; readonly code: string }
  return sqliteError(SqliteErrorCode.transactionFailed, error)
}
/** Driver boundaries do not wrap their own failures a second time. */
export function normalizeSqliteFailure(error: unknown): Error {
  if (error instanceof Error && 'source' in error && error.source === ERROR_SOURCE) return error
  return sqliteError(SqliteErrorCode.sqliteFailed, error)
}
/**
 * Cleanup retains the original pre-normalization primary first, followed by the actual cleanup
 * error.
 */
export function transactionCleanupFailure(
  primary: unknown,
  cleanup: unknown
): AggregateError & { readonly source: string; readonly code: ISqliteErrorCode } {
  /** Ordinary normalization adds exactly one wrapper; it is not the original callback failure. */
  const original =
    primary instanceof Error &&
    'source' in primary &&
    primary.source === ERROR_SOURCE &&
    'code' in primary &&
    primary.code === SqliteErrorCode.transactionFailed &&
    primary.cause !== undefined
      ? primary.cause
      : primary
  /** Aggregation never substitutes either native error or its stack. */
  const error = new AggregateError([original, cleanup], SqliteErrorText.transactionFailed)
  Object.defineProperties(error, {
    source: { value: ERROR_SOURCE, enumerable: true },
    code: { value: SqliteErrorCode.transactionFailed, enumerable: true }
  })
  return error as AggregateError & { readonly source: string; readonly code: ISqliteErrorCode }
}
