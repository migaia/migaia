import { StorageContractError, StorageContractErrorCode } from '@migaia/storage-contract'
import { normalizeError } from '@migaia/storage-host/sdk'
import { attachErrorIdentity } from '@migaia/utils/error'
import { ERROR_SOURCE as STORAGE_REDIS_ERROR_SOURCE, RedisErrorCode } from './error-code.ts'
import type { IRedisErrorCode } from './error-code.ts'
import { RedisText } from './constants.ts'
/** The normalization boundary always returns an actual registered identity. */
export type IRedisFailure = Error & { readonly source: string; readonly code: string }
/** Registered Redis family inspection does not accept an uncoded error with only a matching label. */
export function isRedisError(value: unknown): value is IRedisFailure {
  return (
    value instanceof Error &&
    Reflect.get(value, 'source') === STORAGE_REDIS_ERROR_SOURCE &&
    Object.values(RedisErrorCode).includes(Reflect.get(value, 'code'))
  )
}
/** Same-type coded replacement for a cause that cannot take the Redis identity in place. */
function replaceRedisCause(code: IRedisErrorCode, message: string, cause: unknown): IRedisFailure {
  /** Replacement keeping the cause's native class where possible. */
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
  return attachErrorIdentity(error, { source: STORAGE_REDIS_ERROR_SOURCE, code }) as IRedisFailure
}
/** Native classes remain intact when identity can be attached; immutable failures stay on cause. */
export function redisError(code: IRedisErrorCode, cause?: unknown): IRedisFailure {
  const message =
    code === RedisErrorCode.failed
      ? RedisText.failed
      : code === RedisErrorCode.transactionFailed
        ? RedisText.transactionFailed
        : RedisText.decodeFailed
  return cause instanceof Error && cause.stack
    ? (attachErrorIdentity(
        cause,
        { source: STORAGE_REDIS_ERROR_SOURCE, code },
        {
          onConflict: () => replaceRedisCause(code, message, cause),
          onFailure: () => replaceRedisCause(code, message, cause)
        }
      ) as IRedisFailure)
    : replaceRedisCause(code, message, cause)
}
/** Existing contract/host failures are never relabelled as native Redis failures. */
export function normalizeRedisError(error: unknown): IRedisFailure {
  return normalizeError(error, (cause) => redisError(RedisErrorCode.failed, cause), isRedisError)
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
export function unsupported(cause?: unknown): never {
  throw new StorageContractError(StorageContractErrorCode.unsupported, {
    backend: RedisText.backend,
    cause
  })
}

/** User code is distinguished at its original callback boundary, before the native lease catches it. */
export function normalizeRedisTransactionFailure(error: unknown): IRedisFailure {
  return normalizeError(
    error,
    (cause) => redisError(RedisErrorCode.transactionFailed, cause),
    isRedisError
  )
}
