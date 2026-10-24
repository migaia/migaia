import { PgNames } from './constants.js'
import { StorageContractError, StorageContractErrorCode } from '@migaia/storage-contract'
import { attachErrorIdentity } from '@migaia/utils/error'
import { normalizeError, isStorageErrorFamily } from '@migaia/storage-host/authoring/backend'
import { ERROR_SOURCE, PostgresErrorCode, type IPostgresErrorCode } from './error-code.js'
import { PostgresErrorText } from './error-text.js'
/** Add the registered package identity while retaining the untouched native failure on cause. */
export function postgresError(
  code: IPostgresErrorCode,
  cause?: unknown
): Error & { readonly source: string; readonly code: IPostgresErrorCode } {
  const message =
    code === PostgresErrorCode.decodeFailed
      ? PostgresErrorText.decodeFailed
      : code === PostgresErrorCode.transactionFailed
        ? PostgresErrorText.transactionFailed
        : code === PostgresErrorCode.duplicateKey
          ? PostgresErrorText.duplicateKey
          : PostgresErrorText.sqlFailed
  return attachErrorIdentity(new Error(message, { cause }), {
    source: ERROR_SOURCE,
    code
  }) as Error & { readonly source: string; readonly code: IPostgresErrorCode }
}
/** Recognize only this package's actual owned failure; contract and host ownership stays canonical. */
function isPostgresError(value: unknown): value is Error {
  return value instanceof Error && 'source' in value && value.source === ERROR_SOURCE
}
/** Query/connection failures keep already-owned error identities unchanged. */
export function normalizePostgresError(cause: unknown): Error {
  return normalizeError(
    cause,
    (failure) => postgresError(PostgresErrorCode.sqlFailed, failure),
    isPostgresError
  )
}
/** The original transaction owner receives the same single normalization function. */
export function normalizeTransactionFailure(
  cause: unknown
): Error & { readonly source: string; readonly code: string } {
  // Journal-owned business errors keep the original host identity through this native callback.
  if (isStorageErrorFamily(cause) && !(cause instanceof StorageContractError)) return cause
  if (
    cause instanceof StorageContractError &&
    (cause.code === StorageContractErrorCode.aborted ||
      cause.code === StorageContractErrorCode.lockRejected ||
      cause.code === StorageContractErrorCode.lockTimeout ||
      cause.code === StorageContractErrorCode.lockLost ||
      cause.code === StorageContractErrorCode.writeConflict ||
      cause.code === StorageContractErrorCode.concurrencyPolicyFailed)
  )
    return cause
  if (
    isPostgresError(cause) &&
    'code' in cause &&
    cause.code === PostgresErrorCode.transactionFailed
  )
    return cause as Error & { readonly source: string; readonly code: string }
  return postgresError(PostgresErrorCode.transactionFailed, cause)
}
/** Public invalid arguments use the canonical argument error and retain the cause. */
export function invalidArgument(cause?: unknown): StorageContractError {
  return new StorageContractError(
    StorageContractErrorCode.invalidArgument,
    { backend: PgNames.backend, cause },
    PostgresErrorText.invalidArgument
  )
}
