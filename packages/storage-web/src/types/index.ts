export { ConflictPolicy } from './context';
export type {
  IOperationContext,
  IStorageKey,
  IKeyRange,
  IWriteOptions,
  ISyncWriteOptions,
  IConflictPolicy
} from './context';
export type { IBackendKind, IStorageCapabilities } from './capabilities';
export {
  StorageError,
  StorageErrorCode,
  type IStorageErrorCode,
  type IStorageErrorDetails,
  type IStorageChannel,
  type IExtensionStage
} from './errors';
export {
  asRecordStore,
  isRecordStore,
  type IKeyValueStore,
  type ISyncKeyValueStore,
  type IRecordStore,
  type ISyncCapableStore,
  type IWebStorageLike
} from './storage';
export type { ITransactionScope, ITransactionWriteOptions } from '../core/transaction';
export type {
  ICookieStore,
  ISyncCookieStore,
  ICookieWriteContext,
  ICookieRemoveContext,
  ICookieScope,
  ISameSite
} from './cookie';
