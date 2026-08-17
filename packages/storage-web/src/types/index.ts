export { ConflictPolicy } from './context.js';
export type {
  IOperationContext,
  IStorageKey,
  IKeyRange,
  IWriteOptions,
  ISyncWriteOptions,
  IConflictPolicy
} from './context.js';
export type { IBackendKind, IStorageCapabilities } from './capabilities.js';
export {
  StorageError,
  StorageErrorCode,
  type IStorageErrorCode,
  type IStorageErrorDetails,
  type IStorageChannel,
  type IExtensionStage
} from './errors.js';
export {
  asRecordStore,
  isRecordStore,
  type IKeyValueStore,
  type ISyncKeyValueStore,
  type IRecordStore,
  type ISyncCapableStore,
  type IWebStorageLike
} from './storage.js';
export type { ITransactionScope, ITransactionWriteOptions } from '../core/transaction.js';
export type {
  ICookieStore,
  ISyncCookieStore,
  ICookieWriteContext,
  ICookieRemoveContext,
  ICookieScope,
  ISameSite
} from './cookie.js';
