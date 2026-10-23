import type { ILogAppendPort, ILogStore } from '@migaia/logger/plugins/durable'
import {
  StorageContractError,
  StorageContractErrorCode,
  type ILockKey,
  type ITransactionScope
} from '@migaia/storage-contract'
import { isStorageErrorFamily } from '../core/error-family.js'

/**
 * Only the original log object carries this internal fixed-target closure; no authority table
 * exists.
 */
export const storageLogNativeAccess = Symbol()
/** A native consumer can join one authentic attempt, never obtain a raw backend or installer. */
export type IStorageLogNativeAccess = {
  readonly orgId: string
  readonly backendInstanceId: string
  readonly headLock: ILockKey
  createPort(scope: Omit<ITransactionScope, 'use'>): ILogAppendPort
}
/** Native atomic configuration must select the exact original canonical log object. */
export function resolveStorageLogNativeAccess(store: ILogStore): IStorageLogNativeAccess {
  try {
    const resolve = (store as ILogStore & { [storageLogNativeAccess]?: unknown })[
      storageLogNativeAccess
    ]
    if (typeof resolve !== 'function')
      throw new StorageContractError(StorageContractErrorCode.unsupported)
    return Reflect.apply(resolve, store, [store]) as IStorageLogNativeAccess
  } catch (cause) {
    if (isStorageErrorFamily(cause)) throw cause
    throw new StorageContractError(StorageContractErrorCode.invalidArgument, { cause })
  }
}
