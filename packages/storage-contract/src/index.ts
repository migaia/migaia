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

export {
  fromValueCodec,
  type ICodec,
  type ICodecOutput,
  type ICodecStageObserver
} from './codec.js'
export { StorageStageKind } from './stage-kind.js'

export type {
  IStorageBaseAdmission,
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
  snapshotStorageBaseDetailed,
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
  ITransactionKeyValueApi,
  ITransactionRecordsApi,
  ITransactionStageObserver
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

export { createStorageIteratorLifetime } from './resource.js'
export type { IStorageResource, IStorageIterator, IStorageIteratorLifetime } from './resource.js'
export {
  BACKEND_KIND_PATTERN,
  isBackendKind,
  type IChainMethods,
  type IChainMethodsOf,
  type IWithChainMethods,
  type IBackendStageObserver,
  type IStorageOperationStageObserver,
  type IBackendStageBindings
} from './backend.js'
export type {
  ILockKey,
  IConcurrencyPolicy,
  ITransactionOptions,
  IWriteConcurrencyOptions,
  ITransactionBuilder,
  ILockedTransactionBuilder,
  IOptimisticTransactionBuilder,
  IConcurrencyHolder,
  IConcurrencyDecision,
  IConcurrencyStageObserver
} from './concurrency.js'
export {
  defineStorageCapability,
  implement,
  provideCapabilities,
  hasStorageCapability,
  useStorageCapability,
  kv,
  records,
  type IStorageCapability,
  type IAnyStorageCapability,
  type ICapabilityApi,
  type IStorageBase,
  type IStorageStore,
  type IKeyValueApi,
  type IRecordsApi,
  type ITransactionalCapability,
  type ITransactionCapabilityApi,
  type ICapabilityImpl,
  type ICapabilityStore,
  type IStorageCapabilitySet,
  type IStorageImplementationsOf,
  type IStorageCapabilityApiOf,
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

export { ConcurrencyHolderState } from './concurrency.js'
export type {
  ISqlStageObserver,
  ISqlValue,
  ISqlRow,
  ISqlRunResult,
  ISqlFragment,
  ISqlInput,
  ISqlQuery,
  ISqlTag,
  ISqlExecutor,
  ICompiledStorageSql,
  IStorageSqlQueryTerminals
} from './sql.js'
export { sqlFragment, createSqlTag, deriveStorageSqlQuery } from './sql.js'
export type { IQueryStageObserver } from './query.js'

export { encodeOrderedStorageKey, decodeOrderedStorageKey } from './key-order.js'
export { snapshotStorageBatchKeys, createStorageBatchKeyCapture } from './key-order.js'
export type { IStorageBatchKey, IStorageBatchKeyCapture } from './key-order.js'

export {
  TransactionActivityMode,
  TransactionBeforeStage,
  TransactionObservedStage,
  createTransactionOwner,
  deriveTransactionIterator,
  readTransactionOperationContext,
  assertTransactionOwner,
  runTransactionOperation,
  registerTransactionFinalizer,
  nextTransactionIterator
} from './transaction.js'
export type { ITransactionInfo } from './transaction.js'

export { defineConcurrencyPolicy, ConcurrencyPolicy } from './concurrency.js'
export type { IConcurrencyConflict, ILockHolding } from './concurrency.js'

export { lockKey } from './concurrency.js'

export { prefixStorageOrgKey, unprefixStorageOrgKey } from './org.js'

export {
  runWithConcurrency,
  readConcurrencyLockIdentities,
  snapshotConcurrencyLockHoldings,
  snapshotConcurrencyLockKeys,
  snapshotConcurrencyLockRange
} from './concurrency.js'
export type {
  IConcurrencyAttempt,
  IConcurrencyAttemptContext,
  IConcurrencyPort
} from './concurrency.js'
export { resolveConcurrencyPolicy } from './transaction.js'

export { createTransactionBuilder, TransactionBuilderMethod } from './transaction-builder.js'
export type { IOptimisticTransactionBuilderMode } from './transaction-builder.js'

export {
  QueryOperator,
  QueryOperation,
  compileStorageWhere,
  compileStorageQueryCondition,
  createRecordQuery,
  createVectorQuery,
  createRdfQuery,
  RecordQueryMethod,
  VectorQueryMethod,
  RdfQueryMethod
} from './query-chain.js'
export type {
  IFieldOps,
  IWhere,
  IQueryCondition,
  IQueryPlanStep,
  IQueryPlan,
  IQueryPushdown,
  IQueryRead,
  IQueryPages,
  IQueryCursor,
  INumericKeys,
  IQueryStatistics,
  IQueryShape,
  IQueryResultOf,
  IQueryResult,
  IQueryChain,
  IRecordQuerySource,
  IQueryNativeStep,
  IRecordQueryInput,
  IQueryReduction,
  IQueryReductionResult,
  IQueryReducer,
  IRecordQuery,
  IRecordQueryCore,
  IRecordOrderedQuery,
  IRecordOrderedQueryCore,
  IRecordQueryBase,
  IRecordQueryBaseCore,
  IRecordQueryNeedsLimit,
  IVectorHit,
  IVectorQueryBuilderCore,
  IVectorQueryBase,
  IVectorQueryBuilder,
  IVectorQuery,
  IVectorQueryInput,
  IVectorQuerySource,
  IRdfQueryCore,
  IRdfQuery,
  IRdfQueryTraversal,
  IRdfQueryInput,
  IRdfQuerySource
} from './query-chain.js'

export { useTransactionCapability } from './transaction.js'
export type { ITransactionCapabilityView, IWithTransactionQueryMethods } from './capability.js'

export { snapshotStorageKeyPrefix } from './key-order.js'
export type { IStorageKeyPrefix } from './key-order.js'
export { ttl, snapshotStorageTtlTarget, assertStorageTtlDuration } from './capabilities/ttl.js'
export type { ITtlTarget, ITtlApi, ITransactionTtlApi } from './capabilities/ttl.js'
export { counter, snapshotStorageCounterIncrement } from './capabilities/counter.js'
export type {
  ICounterApi,
  ITransactionCounterApi,
  IStorageCounterIncrement
} from './capabilities/counter.js'
export {
  RdfTermType,
  RdfDatatype,
  term,
  snapshotStorageRdfTerm,
  snapshotStorageRdfPattern,
  snapshotStorageRdfQuad,
  encodeStorageRdfTerm,
  encodeStorageRdfQuad,
  getStorageOrgGraphPrefix,
  prefixStorageOrgGraph,
  unprefixStorageOrgGraph
} from './capabilities/rdf.js'
export type {
  IRdfNamedNode,
  IRdfBlankNode,
  IRdfLiteral,
  IRdfDefaultGraph,
  IRdfBindingTerm,
  IRdfTerm,
  IRawQuad,
  IQuad
} from './capabilities/rdf.js'

export { sql } from './capabilities/sql.js'

export {
  blob,
  snapshotStorageBlobPut,
  snapshotStorageBlobGet,
  snapshotStorageBlobList,
  createStorageBlobObject
} from './capabilities/blob.js'
export type { IBlobInfo, IBlobObject, IBlobApi } from './capabilities/blob.js'
export { durableChangeFeed } from './capabilities/durable-change-feed.js'
export type {
  IDurableStorageChange,
  IDurableChangeFeedApi
} from './capabilities/durable-change-feed.js'

export { orderStorageKeysByBytes, encodeStorageOrgStringPrefix } from './key-order.js'

export { sparql, sparqlFragment, createSparqlTag } from './capabilities/sparql.js'
export type {
  ISparqlFragment,
  ISparqlInput,
  ISparqlRow,
  ISparqlQuery,
  ISparqlTagTools,
  ISparqlApi
} from './capabilities/sparql.js'

export {
  vector,
  DeleteCountMode,
  snapshotStorageVectorCollection,
  snapshotStorageVector,
  snapshotStorageVectorUpsert,
  snapshotStorageVectorFilter,
  snapshotStorageVectorSearch
} from './capabilities/vector.js'
export type {
  IVectorApi,
  IVectorCollection,
  IVectorFilter,
  IStorageVectorConfiguration,
  IStorageVectorValidation,
  IStorageVectorPoint
} from './capabilities/vector.js'
export { rdf } from './capabilities/rdf.js'
export type { IRdfApi, ITransactionRdfApi } from './capabilities/rdf.js'
