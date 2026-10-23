import { StorageContractError, StorageContractErrorCode } from '@migaia/storage-contract'
import { normalizeError } from '@migaia/storage-host/authoring/backend'
import { attachErrorIdentity } from '@migaia/utils/error'
import { ERROR_SOURCE, RedisErrorCode, type IRedisErrorCode } from './error-code.js'
import { RedisText } from './constants.js'
/** Native classes remain intact when identity can be attached; immutable failures stay on cause. */
export function redisError(code: IRedisErrorCode, cause?: unknown): Error {
  const message =
    code === RedisErrorCode.failed
      ? RedisText.failed
      : code === RedisErrorCode.transactionFailed
        ? RedisText.transactionFailed
        : RedisText.decodeFailed
  const fallback = (): Error => {
    const error =
      cause instanceof TypeError
        ? new TypeError(message, { cause })
        : cause instanceof RangeError
          ? new RangeError(message, { cause })
          : cause instanceof SyntaxError
            ? new SyntaxError(message, { cause })
            : cause instanceof AggregateError
              ? new AggregateError(cause.errors, message, { cause })
              : typeof DOMException !== 'undefined' && cause instanceof DOMException
                ? new DOMException(message, cause.name)
                : new Error(message, { cause })
    if (typeof DOMException !== 'undefined' && error instanceof DOMException)
      Object.defineProperty(error, 'cause', { value: cause })
    return attachErrorIdentity(error, { source: ERROR_SOURCE, code })
  }
  return cause instanceof Error && cause.stack
    ? attachErrorIdentity(
        cause,
        { source: ERROR_SOURCE, code },
        { onConflict: fallback, onFailure: fallback }
      )
    : fallback()
}
/** Existing contract/host failures are never relabelled as native Redis failures. */
export function normalizeRedisError(error: unknown): Error {
  return normalizeError(
    error,
    (cause) => redisError(RedisErrorCode.failed, cause),
    (value): value is Error =>
      value instanceof Error && 'source' in value && value.source === ERROR_SOURCE
  )
}
/** Invalid public driver input is rejected before borrowing or writing a native connection. */
export function invalidArgument(cause?: unknown): StorageContractError {
  return new StorageContractError(
    StorageContractErrorCode.invalidArgument,
    { backend: RedisText.backend, cause },
    RedisText.argument
  )
}
/** A missing genuine binary port remains an explicit capability boundary. */
export function unsupported(): never {
  throw new StorageContractError(StorageContractErrorCode.unsupported, {
    backend: RedisText.backend
  })
}

/** User code is distinguished at its original callback boundary, before the native lease catches it. */
export function normalizeRedisTransactionFailure(error: unknown): Error {
  return normalizeError(
    error,
    (cause) => redisError(RedisErrorCode.transactionFailed, cause),
    (value): value is Error =>
      value instanceof Error && 'source' in value && value.source === ERROR_SOURCE
  )
}
