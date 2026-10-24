import { StorageContractError, StorageContractErrorCode } from '@migaia/storage-contract'
import { attachErrorIdentity } from '@migaia/utils/error'
import { CacheText } from './constants.js'
import { CacheErrorCode, ERROR_SOURCE, type ICacheErrorCode } from './error-code.js'

/**
 * Cache callback failures retain their native class and expose their original failure as first
 * cause.
 */
export function cacheError(code: ICacheErrorCode, cause?: unknown, tier?: number): Error {
  /** Every public error message belongs to the registered cache scenario. */
  const message =
    code === CacheErrorCode.loadFailed
      ? CacheText.loadFailed
      : code === CacheErrorCode.embedFailed
        ? CacheText.embedFailed
        : CacheText.tierInvalid(tier)
  /** Native callback classes survive while their exact original object stays on first cause. */
  const error =
    cause instanceof TypeError
      ? new TypeError(message, { cause })
      : cause instanceof RangeError
        ? new RangeError(message, { cause })
        : cause instanceof SyntaxError
          ? new SyntaxError(message, { cause })
          : cause instanceof AggregateError
            ? new AggregateError(cause.errors, message, { cause })
            : cause instanceof DOMException
              ? new DOMException(message, cause.name)
              : new Error(message, cause === undefined ? undefined : { cause })
  if (error instanceof DOMException) Object.defineProperty(error, 'cause', { value: cause })
  if (tier !== undefined) Object.defineProperty(error, 'tier', { value: tier, enumerable: true })
  return attachErrorIdentity(error, { source: ERROR_SOURCE, code })
}

/** Public invalid input uses the existing domain guard before starting any layer operation. */
export function invalidArgument(cause?: unknown): StorageContractError {
  return new StorageContractError(
    StorageContractErrorCode.invalidArgument,
    { backend: CacheText.backend, cause },
    CacheText.argument
  )
}

/** Missing tier capabilities retain the canonical contract error and identify the offending layer. */
export function missingCapability(tier: number, capability: string): never {
  throw new StorageContractError(
    StorageContractErrorCode.unsupported,
    { backend: CacheText.backend },
    CacheText.missingCapability(tier, capability)
  )
}
