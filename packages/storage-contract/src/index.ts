// Contract errors
export {
  StorageContractError,
  StorageContractErrorCode,
  STORAGE_CONTRACT_SOURCE,
  isStorageContractError,
  type IStorageContractErrorCode,
  type IStorageContractErrorDetails
} from './errors.js'

// Public types
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

export type {
  ITransactionScope,
  ITransactionWriteOptions,
  ITransactionKeyValueApi
} from './transaction.js'
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

export { intrinsicConstructorName } from './bytes.js'

export type { IStorageResource, IStorageIterator } from './resource.js'
export {
  BACKEND_KIND_PATTERN,
  isBackendKind,
  type IChainMethods,
  type IChainMethodsOf,
  type IWithChainMethods
} from './backend.js'
export type {
  ILockKey,
  IConcurrencyPolicy,
  ITransactionOptions,
  IWriteConcurrencyOptions,
  ITransactionBuilder,
  ILockedTransactionBuilder
} from './concurrency.js'
export {
  defineStorageCapability,
  implement,
  provideCapabilities,
  kv,
  type IStorageCapability,
  type IAnyStorageCapability,
  type ICapabilityApi,
  type IStorageBase,
  type IStorageStore,
  type IKeyValueApi,
  type ITransactionalCapability,
  type ITransactionCapabilityApi,
  type ICapabilityImpl,
  type ICapabilityStore,
  type IStorageCapabilitySet,
  type IStorageImplementationsOf,
  type ICapabilityPublication,
  type ICapabilityInstallPort
} from './capability.js'

export {
  assertVersionedEnvelope,
  createMigrationPlan,
  migrateEnvelopeSync,
  migrateEnvelope,
  type IVersionedEnvelope,
  type IMigrationStepContext,
  type IMigrationStep,
  type IMigrationReset,
  type ISyncMigrationSteps,
  type IMigrationPlan,
  type IMigrationStepObserver,
  type IMigrationRunOptions
} from './versioned.js'
