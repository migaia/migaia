// 契约级错误
export {
  StorageContractError,
  StorageContractErrorCode,
  STORAGE_CONTRACT_SOURCE,
  isStorageContractError,
  type IStorageContractErrorCode,
  type IStorageContractErrorDetails
} from './errors.js'

// 公共类型
export type {
  IOperationContext,
  IWriteOptions,
  ISyncWriteOptions,
  IConflictPolicy,
  IStorageKey,
  IKeyRange
} from './context.js'
export { ConflictPolicy } from './context.js'

export type { IBackendKind, IStorageCapabilities } from './capabilities.js'
export { snapshotStorageCapabilities, isStorageCapabilities } from './capabilities.js'

export type { ICodec, ICodecOutput } from './codec.js'
export { COLLECTIONS_JSON_CODEC_NAME, collectionsJsonCodec } from './collections-codec.js'

export type {
  IKeyValueStoreAdmission,
  IKeyValueStore,
  ISyncKeyValueStore,
  IRecordStore,
  ISyncCapableStore
} from './store.js'
export {
  isKeyValueStore,
  asRecordStore,
  isRecordStore,
  snapshotKeyValueStore,
  snapshotKeyValueStoreDetailed,
  snapshotRecordStore
} from './store.js'

export type {
  IRecordIndexDefinition,
  IRecordIndexHandle,
  IRecordIndexReadiness,
  IRecordIndexProjectionValue,
  IRecordIndexProjection,
  IRecordIndexQuery,
  ISecondaryIndexTransactionScope,
  ISecondaryIndexRecordStore
} from './secondary-index.js'
export { asSecondaryIndexRecordStore, isSecondaryIndexRecordStore } from './secondary-index.js'

export type { IStorageChange, IChangeFeedStore } from './change-feed.js'
export { asChangeFeedStore, isChangeFeedStore } from './change-feed.js'

export type { ITransactionScope, ITransactionWriteOptions } from './transaction.js'
export { assertTransactionCallback, readTransactionConflictPolicy } from './transaction.js'

export {
  KEY_DOMAIN_LIMITS,
  assertStorageKey,
  snapshotStorageKey,
  assertStringStorageKey,
  compareStorageKeys
} from './key.js'

export { snapshotCodec, assertCodec } from './codec-guard.js'

export {
  snapshotOperationContext,
  assertOperationContext,
  snapshotSyncWriteOptions,
  assertSyncWriteOptions,
  type IOperationContextSnapshot
} from './operation-context.js'

export { isArrayBuffer, isUint8Array, intrinsicConstructorName } from './bytes.js'
export {
  StorageContractConflictPolicy,
  type IStorageContractConflictPolicy
} from './policy-constants.js'
