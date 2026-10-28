export { StorageContractErrorText } from './error-text.ts'
// Contract errors
export {
  StorageContractError,
  StorageContractErrorCode,
  STORAGE_CONTRACT_SOURCE,
  isStorageContractError,
  type IStorageContractErrorCode,
  type IStorageContractErrorDetails
} from './errors.ts'

// Public types
export type {
  IOperationContext,
  IWriteOptions,
  ISyncWriteOptions,
  IConflictPolicy,
  IStorageKey,
  IKeyRange
} from './context.ts'
export { ConflictPolicy } from './context.ts'

export type { IBackendKind, IStorageCapabilities } from './capabilities.ts'
export { isStorageCapabilities } from './capabilities.ts'

export { type ICodec, type ICodecOutput, type ICodecStageObserver } from './codec.ts'
export { StorageStageKind } from './stage-kind.ts'

export type {
  IStorageBaseAdmission,
  IKeyValueStoreAdmission,
  IKeyValueStore,
  ISyncKeyValueStore,
  IRecordStore,
  ISyncCapableStore
} from './store.ts'
export { isKeyValueStore, asRecordStore, isRecordStore } from './store.ts'

export type {
  IRecordIndexDefinition,
  IRecordIndexHandle,
  IRecordIndexReadiness,
  IRecordIndexProjectionValue,
  IRecordIndexProjection,
  IRecordIndexQuery,
  ISecondaryIndexTransactionScope,
  ISecondaryIndexRecordStore
} from './secondary-index.ts'
export { asSecondaryIndexRecordStore, isSecondaryIndexRecordStore } from './secondary-index.ts'

export type {
  IStorageChange,
  IChangeFeedStore,
  ITextWatchApi,
  ITextChangeFeedApi
} from './change-feed.ts'
export type { IWithChangeFeedCapabilities } from './backend.ts'
export { asChangeFeedStore, isChangeFeedStore } from './change-feed.ts'

export type {
  ITransactionScope,
  ITransactionWriteOptions,
  ITransactionKeyValueApi,
  ITransactionRecordsApi,
  ITransactionStageObserver
} from './transaction.ts'
export { assertTransactionCallback, readTransactionConflictPolicy } from './transaction.ts'

export { KEY_DOMAIN_LIMITS, assertStorageKey, assertStringStorageKey } from './key.ts'

export { assertCodec } from './codec-guard.ts'

export {
  assertOperationContext,
  assertSyncWriteOptions,
  type IOperationContextSnapshot
} from './operation-context.ts'

export type { IStorageResource, IStorageIterator, IStorageIteratorLifetime } from './resource.ts'
export {
  BACKEND_KIND_PATTERN,
  isBackendKind,
  type IChainMethods,
  type IChainMethodsOf,
  type IWithChainMethods,
  type IBackendStageObserver,
  type IStorageOperationStageObserver,
  type IBackendStageBindings
} from './backend.ts'
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
} from './concurrency.ts'
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
} from './capability.ts'

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
} from './versioned.ts'

export { ConcurrencyHolderState } from './concurrency.ts'
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
} from './sql.ts'

export type { IQueryStageObserver } from './query.ts'

export type { IStorageBatchKey, IStorageBatchKeyCapture } from './key-order.ts'

export {
  TransactionActivityMode,
  TransactionBeforeStage,
  TransactionObservedStage
} from './transaction.ts'
export type { ITransactionInfo } from './transaction.ts'

export { defineConcurrencyPolicy } from './concurrency.ts'
export type { IConcurrencyConflict, ILockHolding } from './concurrency.ts'

export { assertLockKey } from './concurrency.ts'

export type {
  IConcurrencyAttempt,
  IConcurrencyAttemptContext,
  IConcurrencyPort
} from './concurrency.ts'

export { TransactionBuilderMethod } from './transaction-builder.ts'
export type { IOptimisticTransactionBuilderMode } from './transaction-builder.ts'

export {
  QueryOperator,
  QueryOperation,
  VectorQueryOriginKind,
  RecordQueryMethod,
  VectorQueryMethod,
  RdfQueryMethod
} from './query-chain.ts'
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
} from './query-chain.ts'

export type { ITransactionCapabilityView, IWithTransactionQueryMethods } from './capability.ts'

export type { IStorageKeyPrefix } from './key-order.ts'
export { ttl, assertStorageTtlTarget, assertStorageTtlDuration } from './capabilities/ttl.ts'
export type { ITtlTarget, ITtlApi, ITransactionTtlApi } from './capabilities/ttl.ts'
export { counter } from './capabilities/counter.ts'
export type {
  ICounterApi,
  ITransactionCounterApi,
  IStorageCounterIncrement
} from './capabilities/counter.ts'
export {
  RdfTermType,
  RdfDatatype,
  assertStorageRdfTerm,
  assertStorageRdfPattern,
  assertStorageRdfQuad
} from './capabilities/rdf.ts'
export type {
  IRdfNamedNode,
  IRdfBlankNode,
  IRdfLiteral,
  IRdfDefaultGraph,
  IRdfBindingTerm,
  IRdfTerm,
  IRawQuad,
  IQuad
} from './capabilities/rdf.ts'

export { sql } from './capabilities/sql.ts'

export { blob } from './capabilities/blob.ts'
export type { IBlobInfo, IBlobObject, IBlobApi } from './capabilities/blob.ts'
export { durableChangeFeed } from './capabilities/durable-change-feed.ts'
export type {
  IDurableStorageChange,
  IDurableChangeFeedApi
} from './capabilities/durable-change-feed.ts'

export { sparql } from './capabilities/sparql.ts'
export type {
  ISparqlFragment,
  ISparqlInput,
  ISparqlRow,
  ISparqlQuery,
  ISparqlTagTools,
  ISparqlApi
} from './capabilities/sparql.ts'

export {
  vector,
  DeleteCountMode,
  assertStorageVectorCollection,
  assertStorageVector,
  assertStorageVectorIds
} from './capabilities/vector.ts'
export type {
  IVectorApi,
  IVectorCollection,
  IVectorFilter,
  IStorageVectorConfiguration,
  IStorageVectorValidation,
  IStorageVectorPoint
} from './capabilities/vector.ts'
export { rdf } from './capabilities/rdf.ts'
export type { IRdfApi, ITransactionRdfApi } from './capabilities/rdf.ts'

export {
  ConcurrencyLocking,
  invalidConcurrencyArgument,
  assertConcurrencyPolicy,
  readConcurrencyPolicy,
  LockChannel,
  type INormalizedLockKey,
  invalidLockArgument,
  type IConcurrencyRequest
} from './concurrency.ts'

export { RdfQuadPosition, invalidRdf, assertRdfIri, assertRdfLiteral } from './capabilities/rdf.ts'

export { type IStorageCapabilitiesInspection } from './capabilities.ts'

export { readStorageImplementation, type IStorageImplementationRecord } from './capability.ts'

export {
  StorageCapabilityMethod,
  STORAGE_CAPABILITY_METHODS,
  STORAGE_KEY_VALUE_METHODS,
  STORAGE_KEY_VALUE_PROPERTIES
} from './capability-constants.ts'

export {
  readCapabilityTokenFacts,
  isCapabilityToken,
  invalidCapability,
  type ICapabilityTokenFacts,
  type ICapabilityTransactionFacts
} from './capability-token.ts'

export { SqlQueryMethod } from './sql.ts'

export { type IQueryOperandValue } from './query-chain.ts'

export { isStorageBase, inspectStoreShape } from './store.ts'

export { type IStorageIteratorLifetimeOptions } from './resource.ts'

export { type IOperationValidationContext } from './operation-context.ts'

export { assertStorageOrgId } from './org.ts'

export { invalidVector, assertVectorObject } from './capabilities/vector.ts'

export {
  invalidBlobInput,
  assertStorageBlobPut,
  assertStorageBlobGet,
  assertStorageBlobList
} from './capabilities/blob.ts'

export type { IVectorCollectionOptions } from './capabilities/vector.ts'
