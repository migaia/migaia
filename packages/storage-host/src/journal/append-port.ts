import type { ILogAppendPort, ILogStore } from '@migaia/logger/plugins/durable'
import {
  StorageContractError,
  StorageContractErrorCode,
  type ILockKey,
  type ITransactionScope
} from '@migaia/storage-contract'
import type { IStorageJournalBackendAccess } from './binding.js'

/**
 * Only the original log object carries this internal fixed-target closure; no authority table
 * exists.
 */
export const storageLogNativeAccess = Symbol()
/** A native consumer can join one authentic attempt, never obtain a raw backend or installer. */
export type IStorageLogNativeAccess = {
  matches(access: IStorageJournalBackendAccess): boolean
  readonly orgId: string
  readonly backendInstanceId: string
  readonly headLock: ILockKey
  createPort(scope: Omit<ITransactionScope, 'use'>): ILogAppendPort
}
/** Native atomic configuration must select the exact original canonical log object. */
export function resolveStorageLogNativeAccess(store: ILogStore): IStorageLogNativeAccess {
  const owner = store as ILogStore & {
    [storageLogNativeAccess]?: (candidate: ILogStore) => IStorageLogNativeAccess
  }
  if (typeof owner[storageLogNativeAccess] !== 'function')
    throw new StorageContractError(StorageContractErrorCode.unsupported)
  return owner[storageLogNativeAccess](store)
}
