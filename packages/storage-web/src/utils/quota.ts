import { isStorageContractError, type StorageContractError } from '@migaia/storage-contract'
import { StorageError, StorageErrorCode } from '../types/errors.js'
import type { IBackendKind } from '../types/capabilities.js'

/**
 * 各浏览器的配额异常构造方式不同。按 name 与旧版 code 双重识别，覆盖 Firefox `NS_ERROR_DOM_QUOTA_REACHED` 及 WebKit/旧 DOM code
 * 变体。
 */
const isQuotaException = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  ('name' in error || 'code' in error) &&
  ((error as { name?: unknown }).name === 'QuotaExceededError' ||
    (error as { name?: unknown }).name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    (error as { code?: unknown }).code === 22 ||
    (error as { code?: unknown }).code === 1014 ||
    (error as { code?: unknown }).code === '22' ||
    (error as { code?: unknown }).code === '1014' ||
    (error as { code?: unknown }).code === 'NS_ERROR_DOM_QUOTA_REACHED')

export const normalizeStorageException = (
  error: unknown,
  backend: IBackendKind,
  key?: string,
  operation?: string
): StorageError | StorageContractError => {
  if (error instanceof StorageError) {
    if (operation === undefined || error.operation !== undefined) return error
    return new StorageError(
      error.code,
      {
        backend: error.backend ?? backend,
        key: error.key ?? key,
        existingChannel: error.existingChannel,
        attemptedChannel: error.attemptedChannel,
        extensionStage: error.extensionStage,
        operation,
        cause: error.cause ?? error
      },
      error.message,
      error.stage
    )
  }
  if (isStorageContractError(error)) return error
  if (isQuotaException(error))
    return new StorageError(StorageErrorCode.quotaExceeded, {
      backend,
      key,
      operation,
      cause: error
    })
  return new StorageError(StorageErrorCode.unavailable, { backend, key, operation, cause: error })
}
