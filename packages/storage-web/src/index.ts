// 后端工厂
export {
  localStorage,
  sessionStorage,
  memoryStorage,
  cookies,
  indexedDb,
  type ILocalStorageOptions,
  type ISessionStorageOptions,
  type IWebStorageOptions,
  type ICookiesOptions,
  type ICookieDocument,
  type IIndexedDbOptions
} from './backends/index.js';

// 契约
export type {
  IKeyValueStore,
  ISyncKeyValueStore,
  IRecordStore,
  ITransactionScope,
  ITransactionWriteOptions,
  ICookieStore,
  ISyncCookieStore,
  ICookieWriteContext,
  ICookieRemoveContext,
  ISameSite,
  IOperationContext,
  IWriteOptions,
  ISyncWriteOptions,
  IConflictPolicy,
  IStorageKey,
  IKeyRange,
  IBackendKind,
  IStorageCapabilities,
  IStorageErrorCode,
  IStorageErrorDetails,
  IExtensionStage,
  IStorageChannel,
  ICookieScope,
  ISyncCapableStore,
  IWebStorageLike
} from './types/index.js';
export { StorageError, StorageErrorCode, asRecordStore, isRecordStore } from './types/index.js';
export { ConflictPolicy } from './types/index.js';
export { lengthPrefixedNamespaceCodec } from './utils/key.js';
export type { INamespaceCodec } from './utils/key.js';

// 契约级错误家族（透传自 @migaia/storage-contract）
export {
  StorageContractError,
  StorageContractErrorCode,
  STORAGE_CONTRACT_SOURCE,
  isStorageContractError,
  type IStorageContractErrorCode,
  type IStorageContractErrorDetails
} from '@migaia/storage-contract';

// 序列化接入层
export { jsonCodec, structuredCodec, binaryCodec, selectCodec } from './serialize/index.js';
export type { ICodec, ICodecOutput, ISelectedCodec } from './serialize/index.js';

// schema 接入层
export { passthrough, fromStandardSchema, runMigrations } from './schema/index.js';
export type {
  ISchemaAdapter,
  IStandardSchemaV1,
  IMigration,
  IMigrationContext
} from './schema/index.js';

// entity
export { defineEntity } from './entity/index.js';
export type {
  IEntityDefinition,
  IEntityOptions,
  IEntityTransactionScope,
  IListOptions,
  IMigrateOptions,
  IMigrateResult,
  IInvalidRecordAction,
  IInvalidRecordIssue,
  IInvalidRecordHandler,
  IRecordComparator,
  IRepository
} from './entity/index.js';
