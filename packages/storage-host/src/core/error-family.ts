import { StorageError } from '../errors.ts'
import { isStorageContractError, type StorageContractError } from '@migaia/storage-contract'

/** Neutral rules recognize original owners; backend-specific class checks remain with that backend. */
export type IStorageErrorFamily<E extends Error = never> = StorageError | StorageContractError | E

/** Preserve only actual host, contract or backend-admitted error objects without rebuilding them. */
export function isStorageErrorFamily<E extends Error = never>(
  value: unknown,
  isBackendError?: (value: unknown) => value is E
): value is IStorageErrorFamily<E> {
  return (
    value instanceof StorageError ||
    isStorageContractError(value) ||
    isBackendError?.(value) === true
  )
}

/** Construct an unknown error through its owning backend while preserving the existing family. */
export function normalizeError<E extends Error>(
  error: unknown,
  createFailure: (cause: unknown) => E,
  isBackendError?: (value: unknown) => value is E
): IStorageErrorFamily<E> {
  return isStorageErrorFamily(error, isBackendError) ? error : createFailure(error)
}
