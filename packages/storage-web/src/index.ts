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
} from './backends';

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
} from './types';
export { StorageError, StorageErrorCode, asRecordStore, isRecordStore } from './types';
export { ConflictPolicy } from './types';
export { lengthPrefixedNamespaceCodec } from './utils/key';
export type { INamespaceCodec } from './utils/key';

// 序列化接入层
export { jsonCodec, structuredCodec, binaryCodec, selectCodec } from './serialize';
export type { ICodec, ICodecOutput, ISelectedCodec } from './serialize';

// schema 接入层
export { passthrough, fromStandardSchema, runMigrations } from './schema';
export type { ISchemaAdapter, IStandardSchemaV1, IMigration, IMigrationContext } from './schema';

// entity
export { defineEntity } from './entity';
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
} from './entity';
