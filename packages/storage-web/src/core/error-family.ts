import { StorageError } from '../types/errors.js'
import { isStorageContractError, type StorageContractError } from '@migaia/storage-contract'

/**
 * Identifies web and contract storage errors for shared normalization, rethrowing, and unwrapping
 * paths. Contract errors pass through unchanged, preserving identity, `source`, `code`, and
 * `cause`. Only unknown errors outside the storage family normalize to web errors.
 */
export const isStorageErrorFamily = (
  value: unknown
): value is StorageError | StorageContractError =>
  value instanceof StorageError || isStorageContractError(value)
