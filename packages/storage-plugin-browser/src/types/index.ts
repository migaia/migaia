export { ConflictPolicy } from './context.ts'
export type {
  IOperationContext,
  IStorageKey,
  IKeyRange,
  IWriteOptions,
  ISyncWriteOptions,
  IConflictPolicy
} from './context.ts'
export type { IBackendKind, IStorageCapabilities } from './capabilities.ts'
export {
  StorageError,
  type IStorageErrorDetails,
  type IStorageChannel,
  type IExtensionStage
} from './errors.ts'
export {
  asRecordStore,
  isRecordStore,
  type IKeyValueStore,
  type ISyncKeyValueStore,
  type IRecordStore,
  type ISyncCapableStore,
  type IWebStorageLike
} from './storage.ts'
export type { ITransactionScope, ITransactionWriteOptions } from '@migaia/storage-contract'
export type {
  ICookieStore,
  ISyncCookieStore,
  ICookieWriteContext,
  ICookieRemoveContext,
  ICookieScope,
  ISameSite
} from './cookie.ts'
