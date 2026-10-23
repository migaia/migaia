import { StorageError as HostStorageError } from '@migaia/storage-host'
import { StorageError } from '../types/errors.js'
import { isStorageContractError, type StorageContractError } from '@migaia/storage-contract'

/** The admitted error family spans the migrated host owner and its remaining Web consumers. */
export type IStorageErrorFamily = StorageError | HostStorageError | StorageContractError

/**
 * Identifies host, web and contract storage errors for shared normalization, rethrowing, and
 * unwrapping paths. Contract errors pass through unchanged, preserving identity, `source`, `code`,
 * and `cause`. Only unknown errors outside the storage family normalize to web errors.
 */
export const isStorageErrorFamily = (value: unknown): value is IStorageErrorFamily =>
  value instanceof StorageError ||
  value instanceof HostStorageError ||
  isStorageContractError(value)
