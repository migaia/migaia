export { StorageContractErrorText } from './error-text.js'
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
export { isStorageCapabilities } from './capabilities.js'

export { type ICodec, type ICodecOutput, type ICodecStageObserver } from './codec.js'
export { StorageStageKind } from './stage-kind.js'

export type {
  IStorageBaseAdmission,
  IKeyValueStoreAdmission,
  IKeyValueStore,
  ISyncKeyValueStore,
  IRecordStore,
  ISyncCapableStore
} from './store.js'
export { isKeyValueStore, asRecordStore, isRecordStore } from './store.js'

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

export type {
  IStorageChange,
  IChangeFeedStore,
  ITextWatchApi,
  ITextChangeFeedApi
} from './change-feed.js'
export type { IWithChangeFeedCapabilities } from './backend.js'
export { asChangeFeedStore, isChangeFeedStore } from './change-feed.js'

export type {
  ITransactionScope,
  ITransactionWriteOptions,
  ITransactionKeyValueApi,
  ITransactionRecordsApi,
  ITransactionStageObserver
} from './transaction.js'
export { assertTransactionCallback, readTransactionConflictPolicy } from './transaction.js'

export { KEY_DOMAIN_LIMITS, assertStorageKey, assertStringStorageKey } from './key.js'

export { assertCodec } from './codec-guard.js'

export {
  assertOperationContext,
  assertSyncWriteOptions,
  type IOperationContextSnapshot
} from './operation-context.js'

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
  type IVersionedEnvelope,
  type IMigrationStepContext,
  type IMigrationStep,
  type ISyncMigrationCheck,
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

export type { IQueryStageObserver } from './query.js'

export type { IStorageBatchKey, IStorageBatchKeyCapture } from './key-order.js'

export {
  TransactionActivityMode,
  TransactionBeforeStage,
  TransactionObservedStage
} from './transaction.js'
export type { ITransactionInfo } from './transaction.js'

export { defineConcurrencyPolicy } from './concurrency.js'
export type { IConcurrencyConflict, ILockHolding } from './concurrency.js'

export { assertLockKey } from './concurrency.js'

export type {
  IConcurrencyAttempt,
  IConcurrencyAttemptContext,
  IConcurrencyPort
} from './concurrency.js'

export { TransactionBuilderMethod } from './transaction-builder.js'
export type { IOptimisticTransactionBuilderMode } from './transaction-builder.js'

export {
  QueryOperator,
  QueryOperation,
  VectorQueryOriginKind,
  RecordQueryMethod,
  VectorQueryMethod,
  RdfQueryMethod
} from './query-chain.js'
export type {
  IFieldOps,
  IWhere,
  IQueryCondition,
  IQueryConditions,
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
  IQueryWatch,
  IQueryWatcher,
  IQueryResult,
  IQueryChain,
  IRecordQuerySource,
  IRecordQuerySourcePlan,
  IQueryNativeStep,
  IRecordQueryInput,
  IQueryWriteContext,
  IQueryDelete,
  IRecordQueryMutation,
  IRdfQueryMutation,
  IQueryMutationPort,
  IQueryMutator,
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
  IVectorQueryOrigin,
  IVectorRerankInput,
  IVectorRerankContext,
  IVectorReranker,
  IVectorRerankOptions,
  IVectorRerankedHit,
  IVectorRerankedQuery,
  IVectorQueryRefinement,
  IVectorNativeQuery,
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

export type { ITransactionCapabilityView, IWithTransactionQueryMethods } from './capability.js'

export type { IStorageKeyPrefix } from './key-order.js'
export { ttl, assertStorageTtlTarget, assertStorageTtlDuration } from './capabilities/ttl.js'
export type { ITtlTarget, ITtlApi, ITransactionTtlApi } from './capabilities/ttl.js'
export { counter } from './capabilities/counter.js'
export type {
  ICounterApi,
  ITransactionCounterApi,
  IStorageCounterIncrement
} from './capabilities/counter.js'
export {
  RdfTermType,
  RdfDatatype,
  assertStorageRdfTerm,
  assertStorageRdfPattern,
  assertStorageRdfQuad
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

export { blob } from './capabilities/blob.js'
export type { IBlobInfo, IBlobObject, IBlobApi } from './capabilities/blob.js'
export { durableChangeFeed } from './capabilities/durable-change-feed.js'
export type {
  IDurableStorageChange,
  IDurableChangeFeedApi
} from './capabilities/durable-change-feed.js'

export { sparql } from './capabilities/sparql.js'
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
  assertStorageVectorCollection,
  assertStorageVector,
  assertStorageVectorIds
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

export {
  ConcurrencyLocking,
  invalidConcurrencyArgument,
  assertConcurrencyPolicy,
  readConcurrencyPolicy,
  LockChannel,
  type INormalizedLockKey,
  invalidLockArgument,
  type IConcurrencyRequest
} from './concurrency.js'

export { RdfQuadPosition, invalidRdf, assertRdfIri, assertRdfLiteral } from './capabilities/rdf.js'

export { type IStorageCapabilitiesInspection } from './capabilities.js'

export { readStorageImplementation, type IStorageImplementationRecord } from './capability.js'

export {
  StorageCapabilityMethod,
  STORAGE_CAPABILITY_METHODS,
  STORAGE_KEY_VALUE_METHODS,
  STORAGE_KEY_VALUE_PROPERTIES
} from './capability-constants.js'

export {
  readCapabilityTokenFacts,
  isCapabilityToken,
  invalidCapability,
  type ICapabilityTokenFacts,
  type ICapabilityTransactionFacts
} from './capability-token.js'

export { SqlQueryMethod } from './sql.js'

export { type IQueryOperandValue } from './query-chain.js'

export { isStorageBase, inspectStoreShape } from './store.js'

export { type IStorageIteratorLifetimeOptions } from './resource.js'

export { type IOperationValidationContext } from './operation-context.js'

export { assertStorageOrgId } from './org.js'

export { invalidVector, assertVectorObject } from './capabilities/vector.js'

export {
  invalidBlobInput,
  assertStorageBlobPut,
  assertStorageBlobGet,
  assertStorageBlobList
} from './capabilities/blob.js'

export type { IVectorCollectionOptions } from './capabilities/vector.js'
