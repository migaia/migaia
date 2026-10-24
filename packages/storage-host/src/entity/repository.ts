import { isPlainObject } from '@migaia/utils/object'
import { systemScheduler } from '@migaia/utils/scheduler'
import { asyncDisposeKey } from '@migaia/plugin-host'
import {
  getBackendEnvelopeStages,
  getBackendValueCommit,
  getBackendEntityQueryMethods,
  getBackendEntityAccess,
  snapshotBackendEntityRecordWatcher,
  type IBackendEntityAccess,
  type IEntitySecondaryMethods,
  type IEntityKeyValueMethods,
  type IEntityRecordMethods
} from '../core/change-controller.js'
import { repositoryMigrationKey } from '../core/record-layout.js'
import {
  StorageContractError,
  assertVersionedEnvelope,
  type IVersionedEnvelope,
  type IMigrationPlan,
  StorageContractErrorCode,
  snapshotKeyValueStoreDetailed,
  assertStorageKey,
  compareStorageKeys,
  createRecordQuery,
  RecordQueryMethod,
  QueryOperation,
  compileStorageQueryCondition,
  type IQueryCondition,
  deriveTransactionIterator,
  nextTransactionIterator,
  type IRecordQuerySource,
  StorageStageKind,
  type ICodecStageObserver,
  type IQueryStageObserver,
  snapshotRecordStore,
  snapshotStorageKey,
  assertTransactionOwner,
  runTransactionOperation,
  readTransactionOperationContext,
  registerTransactionFinalizer,
  lockKey,
  encodeOrderedStorageKey,
  type ITransactionScope,
  type IStorageIterator,
  type ITransactionInfo,
  type IRecordQueryBase,
  type IQueryResult,
  isSecondaryIndexRecordStore,
  isStorageContractError,
  type IRecordIndexHandle,
  type IRecordIndexProjection,
  type IRecordIndexProjectionValue,
  type IKeyRange,
  type ISecondaryIndexRecordStore
} from '@migaia/storage-contract'
import { migrateEnvelope } from '../authoring/migration.js'
import { isStorageErrorFamily } from '../core/error-family.js'
import {
  StorageError,
  StorageErrorCode,
  createStorageTypeError,
  createStorageAggregateError
} from '../errors.js'
import { indexBackfillFailureText, StorageErrorText } from '../error-text.js'
import { readStorageHookFailureCode } from '../hooks.js'
import { selectCodec } from '../serialize/index.js'
import { jsonCodec } from '../serialize/json.js'
import { structuredCodec } from '../serialize/structured.js'
import {
  composeFlatKey,
  composeRepositoryKey,
  composeStructuredKey,
  decodeRepositoryKey,
  flatKeyPrefix,
  repositoryEntityRange,
  repositoryUniqueWriteKey
} from './key.js'
import { decodeFlatStorageKey, encodeFlatStorageKey, snapshotKeyRange } from '../core/key-domain.js'
import { isStorageKeyInRange } from '../core/query.js'
import { invokeExtension } from '../core/errors.js'
import { normalizeError as normalizeStorageError } from '../core/error-family.js'
import {
  createStorageOperationRuntime,
  type IStorageOperationRuntime,
  reportCleanupError
} from '../core/operation-reporter.js'
import { withAbort } from '../core/operation.js'
import { EntityText } from './text.js'
import {
  createEntityQuery,
  type IEntityQueryPlan,
  type IEntityQuerySourceSelection
} from './query.js'
import { snapshotOperationContext } from '@migaia/storage-contract'
import type { IOperationContext, IStorageKey } from '@migaia/storage-contract'
import type { IRecordStore, IKeyValueStore } from '@migaia/storage-contract'
import type { ISchemaAdapter } from '../entity.js'
import type { ICodec } from '../entity.js'
import type { ISelectedCodec } from '../entity.js'
import type {
  IEntityTransactionScope,
  IIndexedListOptions,
  IInvalidRecordHandler,
  IListOptions,
  IInvalidRecordAction,
  IInvalidRecordIssue,
  IMigrateOptions,
  IEntityConnectOptions,
  IEntityQuery,
  IRepository,
  IEntityConnectStore
} from './types.js'
import type { ISnapshotEntityIndexes } from './index-projection.js'
import {
  projectEntityIndexes,
  chooseEntityQueryIndex,
  supportsEntityIndexCondition,
  ENTITY_QUERY_INDEX_OPERATORS
} from './index-projection.js'
import { collectUniqueIndexOwners } from '../core/unique-index.js'
import { createOrderedRecordIndex } from '../core/ordered-record-index.js'
import { safeJsonPayloadByteLength } from '../core/json.js'
import {
  asRecordIndexBackfillStore,
  RecordIndexBackfillPhase,
  isBackfillContentionFailure,
  type IRecordIndexBackfillPreparation,
  type IRecordIndexBackfillSession,
  type IRecordIndexBackfillCandidate
} from './backfill.js'
import {
  EntityState,
  StorageMigrationPhase,
  StorageMigrationStatus,
  StorageInvalidRecordAction,
  StorageOperation,
  StorageRecordStage,
  type IStorageRecordStage
} from './constants.js'

/** Entity extension observations borrow only the currently accepted canonical operation view. */
type IEntityOperationRuntime = IStorageOperationRuntime & { readonly scope?: ITransactionScope }
/** Create operation-local diagnostics without retaining a transaction after its actual work. */
const entityRuntime = (scope: ITransactionScope): IEntityOperationRuntime => ({
  ...createStorageOperationRuntime(),
  scope
})
/** Observer callbacks never intervene, await native work, or replace an operation failure. */
const observeEntity = (
  port: { readonly report: (error: unknown) => unknown },
  invoke: () => unknown
): void => {
  try {
    const result = invoke()
    void Promise.resolve(result).catch((error) => {
      port.report(error)
    })
  } catch (error) {
    port.report(error)
  }
}

/** Own the existing generator cleanup promises without replacing its iterator identity. */
class EntityIteratorLifetime<T> {
  /** The generator remains the original business iterator and receives its own return calls. */
  #generator: AsyncGenerator<T, void, unknown>
  /** Cleanup failures report through the operation that created this actual iterator. */
  #runtime: IEntityOperationRuntime
  /** Ordinary disposal preserves the first generator return Promise. */
  #closing: Promise<void> | undefined
  /** Symbolic disposal observes cleanup failure once and preserves its result identity. */
  #symbolic: Promise<void> | undefined

  /** Borrow the generator and its existing cleanup reporter. */
  constructor(generator: AsyncGenerator<T, void, unknown>, runtime: IEntityOperationRuntime) {
    this.#generator = generator
    this.#runtime = runtime
  }
  /** Finish the original generator once, including its native finally block. */
  dispose = (): Promise<void> =>
    (this.#closing ??= this.#generator.return(undefined).then(() => undefined))
  /** Observe a failed generator return through the operation's existing report channel. */
  symbolicDispose = (): Promise<void> =>
    (this.#symbolic ??= this.dispose().catch((cause) =>
      reportCleanupError(this.#runtime.reporter, cause)
    ))
  /** Attach the resource protocol directly to the original business iterator. */
  attach(): IStorageIterator<T> {
    return Object.assign(this.#generator, {
      dispose: this.dispose,
      [asyncDisposeKey]: this.symbolicDispose
    })
  }
}

/** Give one actual generator its explicit resource protocol without another iterator owner. */
function entityIterator<T>(
  generator: AsyncGenerator<T, void, unknown>,
  runtime: IEntityOperationRuntime
): IStorageIterator<T> {
  return new EntityIteratorLifetime(generator, runtime).attach()
}

/** Runtime snapshots admit related ordering fields once while public callers retain their union. */
type IListSnapshot<T> = Omit<IListOptions<T>, 'orderBy' | 'limit'> & {
  readonly orderBy?: (left: T, right: T) => number
  readonly limit?: number
}
type IEnvelope = IVersionedEnvelope
type IStageFailure = Error & {
  readonly stage: IStorageRecordStage
  readonly cause: unknown
}

type IWriteTarget = { readonly documentKey?: IStorageKey; readonly flatKey?: string }
/** Select the same minimum index key without invoking projection or changing its error boundary. */
function minimumProjectedIndexKey(
  projection: IRecordIndexProjectionValue | undefined,
  range: IKeyRange | undefined
): IStorageKey | undefined {
  if (projection === undefined) return
  /** Retain the original minimum independently of native cursor or transaction ordering. */
  let first: IStorageKey | undefined
  for (const key of projection.kind === 'single' ? [projection.key] : projection.keys)
    if (
      isStorageKeyInRange(key, range) &&
      (first === undefined || compareStorageKeys(key, first) < 0)
    )
      first = key
  return first
}
/** A captured read view reuses the canonical stream decoder under a snapshot or transaction. */
type IRepositoryReadView = {
  readonly keys?: () => Promise<string[]>
  readonly get?: (key: string) => Promise<string | null>
  readonly getRecord?: (key: IStorageKey) => Promise<unknown | undefined>
  readonly iterateRecords?: IRecordStore['iterateRecords']
  readonly iterateRecordIndex?: ISecondaryIndexRecordStore['iterateRecordIndex']
  readonly readyHandle?: IRecordIndexHandle
  readonly runtime?: IEntityOperationRuntime
}

/** Final logical row state; an absent projection represents a deletion in the draft. */
type IEntityUniqueMutation = {
  readonly id: IStorageKey
  readonly projection: IRecordIndexProjection | undefined
}

/* c8 ignore start -- defensive stage wrapping is exercised through the public error assertions. */
const stageFailure = (stage: IStageFailure['stage'], cause: unknown): IStageFailure => {
  /* c8 ignore next -- all current extension boundaries normalize to StorageError; retain a defensive path for future callers. */
  if (cause instanceof StorageError) {
    /** Preserve the moved error owner while adding the existing invalid-record stage. */
    const details = {
      backend: cause.backend,
      key: cause.key,
      existingChannel: cause.existingChannel,
      attemptedChannel: cause.attemptedChannel,
      operation: cause.operation,
      extensionStage: cause.extensionStage,
      cause
    }
    return new StorageError(cause.code, details, cause.message, stage) as IStageFailure
  }
  if (isStorageContractError(cause)) return cause as unknown as IStageFailure
  return new StorageError(
    StorageErrorCode.extensionFailed,
    { cause },
    undefined,
    stage
  ) as IStageFailure
}
/* c8 ignore stop */

const validateLimit = (limit: number | undefined, backend: IKeyValueStore['backend']): void => {
  if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 0))
    throw new StorageError(StorageErrorCode.invalidConfig, {
      backend,
      cause: new RangeError(EntityText.listLimitMustBeANonNegativeSafeInteger)
    })
}

const validateOrderBy = (orderBy: unknown, backend: IKeyValueStore['backend']): void => {
  if (orderBy !== undefined && typeof orderBy !== 'function')
    throw new StorageError(StorageErrorCode.invalidConfig, {
      backend,
      cause: new TypeError(EntityText.listOrderByMustBeAFunction)
    })
}

const validateListOptions = (options: unknown, backend: IKeyValueStore['backend']): void => {
  if (
    options !== undefined &&
    (typeof options !== 'object' || options === null || Array.isArray(options))
  )
    throw new StorageError(StorageErrorCode.invalidConfig, {
      backend,
      cause: new TypeError(EntityText.listOptionsMustBeAnObject)
    })
}

/** Accept every canonical open backend without a second capability/identifier validator. */
const snapshotEntityStore = (store: IEntityConnectStore): IBackendEntityAccess => {
  /** Only the exact original host alias can reuse the already-validated ownership-free facts. */
  const access = getBackendEntityAccess(store)
  if (access !== undefined) return access
  const snapshot = snapshotKeyValueStoreDetailed(store)
  if (!snapshot.valid)
    throw new StorageError(StorageErrorCode.invalidConfig, { cause: snapshot.cause })
  /** Every other input retains the original complete raw resource and record admission. */
  return {
    store: snapshot.store,
    recordStore: () => snapshotRecordStore(store)?.store,
    secondaryStore: () => (isSecondaryIndexRecordStore(store) ? store : undefined),
    assertScope: (scope) => assertTransactionOwner(snapshot.store, scope),
    assertCurrent: () => undefined,
    watchRecords: snapshotBackendEntityRecordWatcher(snapshot.store)
  }
}
/** Entity extensions preserve the original neutral family and use this package's error owner. */
const normalizeError = (
  cause: unknown,
  backend: IKeyValueStore['backend'],
  code: ConstructorParameters<typeof StorageError>[0],
  operation: string
): Error =>
  normalizeStorageError(cause, (cause) => new StorageError(code, { backend, cause, operation }))

export type IRepositoryConfig<TDomain, TStored> = {
  readonly name: string
  readonly key: Extract<keyof TDomain, string>
  readonly version: number
  readonly schema: ISchemaAdapter<TDomain, TStored>
  /** Selects a default from the backend kind when omitted. See `createRepository`. */
  readonly codec: ICodec<unknown, unknown> | undefined
  readonly migrationPlan: IMigrationPlan
  readonly validateOnRead: boolean
  readonly onDiagnostic: (message: string) => void
  readonly defaultOrderBy: ((left: TDomain, right: TDomain) => number) | undefined
  readonly indexes: ISnapshotEntityIndexes<TDomain>
}

const idOf = <TDomain>(
  entityName: string,
  keyProp: string,
  value: TDomain,
  backend: IKeyValueStore['backend']
): IStorageKey => {
  const id = (value as Record<string, unknown>)[keyProp]
  if (id === undefined || id === null)
    throw new StorageError(StorageErrorCode.invalidConfig, {
      backend,
      cause: new TypeError(EntityText.entityMissingStorageKey(entityName, keyProp))
    })
  assertStorageKey(id, backend, `entity "${entityName}" key "${keyProp}"`)
  return id
}

/** Immutable indexed-query input captured before any query route consumes it. */
type IIndexedListSnapshot<TDomain> = {
  readonly index: string
  readonly range: IListSnapshot<TDomain>['range']
  readonly options: IListSnapshot<TDomain> | undefined
}

/** Index collection and streaming share native cursors, filtering and the sole bounded heap. */
/** Native and fallback index rows share one materializer and canonical metadata ordering. */
type IMatch<TDomain> = {
  readonly id: IStorageKey
  readonly key: IStorageKey
  readonly value: TDomain
}
/** One fluent descriptor shares synchronous opening facts without retaining native resources. */
type IEntityQueryExecution<T> = {
  scope?: ITransactionScope
  opened?: { readCount: number }
  openingPlan?: IEntityQueryPlan
  openingSelection?: IEntityQuerySourceSelection<T>
}
/** One native source keeps selection separate from shared terminal observer facts. */
type IEntityQuerySourceContext<T> = {
  execution: IEntityQueryExecution<T>
  selection: IEntityQuerySourceSelection<T>
}
/** Existing migration counters and checkpoint facts are owned by one active run. */
type IEntityMigrationContext<TDomain> = {
  /** Context is local progress for the current resumable migration run. */
  context: IOperationContext | undefined
  /** Runtime is local progress for the current resumable migration run. */
  runtime: IEntityOperationRuntime
  batchSize: number
  onInvalid: IMigrateOptions<TDomain>['onInvalid']
  /** MigrationMetadata is local progress for the current resumable migration run. */
  migrationMetadata: IRecordStore['metadata'] | undefined
  /** CheckpointKey is local progress for the current resumable migration run. */
  checkpointKey: string
  /** Checkpoint is local progress for the current resumable migration run. */
  checkpoint: IEntityMigrationCheckpoint | undefined
  /** CheckpointMatches is local progress for the current resumable migration run. */
  checkpointMatches: boolean
  /** Scanned is local progress for the current resumable migration run. */
  scanned: number
  /** Migrated is local progress for the current resumable migration run. */
  migrated: number
  /** Eligible is local progress for the current resumable migration run. */
  eligible: number
  /** AlreadyCurrent is local progress for the current resumable migration run. */
  alreadyCurrent: number
  /** Skipped is local progress for the current resumable migration run. */
  skipped: number
  /** Conflicted is local progress for the current resumable migration run. */
  conflicted: number
  /** LastPhysicalKey is local progress for the current resumable migration run. */
  lastPhysicalKey: IStorageKey | undefined
  /** Phase is local progress for the current resumable migration run. */
  phase: (typeof StorageMigrationPhase)[keyof typeof StorageMigrationPhase]
  /** Batch is local progress for the current resumable migration run. */
  batch: Array<{
    readonly physicalKey: IStorageKey
    readonly raw: unknown
    readonly id: IStorageKey
    readonly legacy: boolean
    readonly migrationRequired: boolean
    readonly value: TDomain | undefined
  }>
}
type IEntityMigrationCheckpoint = {
  readonly status: (typeof StorageMigrationStatus)[keyof typeof StorageMigrationStatus]
  readonly phase?: (typeof StorageMigrationPhase)[keyof typeof StorageMigrationPhase]
  readonly version: number
  readonly schemaFingerprint: string
  readonly lastPhysicalKey?: IStorageKey
  readonly scanned: number
  readonly eligible: number
  readonly migrated: number
  readonly skipped: number
  readonly alreadyCurrent: number
  readonly conflicted: number
}
type IEntityScanCandidate = {
  readonly id: IStorageKey
  readonly physical: IStorageKey | string
  readonly raw: unknown
}
/** One lazy scan owns ordering storage while borrowing its native read view. */
type IEntityScanContext<T> = {
  options: IListSnapshot<T> | undefined
  ctx: IOperationContext | undefined
  readView?: IRepositoryReadView
  onRead?: () => void
  applyOrdering: boolean
  candidates: ReturnType<typeof createOrderedRecordIndex<IEntityScanCandidate>>
}
/** Preparation and cleanup state belong to one authentic transaction cursor. */
type IEntityScopedSourceContext<T> = {
  selection: IEntityQuerySourceSelection<T>
  onRead?: () => void
  orderedSource: boolean
  physicalIds?: Map<string, IStorageKey>
  accepts?: (value: T) => boolean
  rows: ReturnType<typeof createOrderedRecordIndex<readonly [IStorageKey, T]>>
  seen: Map<string, IStorageKey> | Set<string>
  prepared: boolean
  initialized: boolean
  cursor?: IStorageIterator<[IStorageKey, unknown]>
  item: ReturnType<typeof createOrderedRecordIndex<readonly [IStorageKey, T]>>['first']
}
/** One observed stream retains only its original iterator and accumulated diagnostics. */
type IEntityQueryObservation<T, R> = {
  iterator: IStorageIterator<R>
  plan: IEntityQueryPlan
  selection: IEntityQuerySourceSelection<T>
  counter: { readCount: number } | undefined
  returnedCount: number
  elapsedMs: number
}
/** One bound repository borrows its native scope and weak finalizer-owned mutation state. */
type IEntityRepositoryBinding = {
  scope: ITransactionScope
  expectedIdentity?: IStorageKey
  activeChanges: WeakRef<Map<string, IEntityUniqueMutation>> | undefined
}
/** One write terminal owns its source policy and native mutation request. */
type IEntityQueryMutationContext<T> = {
  source: IEntityQuerySourceContext<T>
  policy: IEntityQuerySourceSelection<T>
  orderedSource: boolean
  onRead: (() => void) | undefined
  request: Parameters<NonNullable<IRecordQuerySource['mutate']>>[0]
  run: Parameters<NonNullable<IRecordQuerySource['mutate']>>[1]
}
/** Own one entity repository, its backend access and versioned materialization route. */
class EntityRepositoryOwner<
  TDomain,
  TStored,
  TIndexes extends Readonly<Record<string, IStorageKey>> = Readonly<Record<never, IStorageKey>>,
  TAugmentMethods extends object = {},
  TChangeFeed extends boolean = false
> {
  /** The repository borrows its validated entity declaration for every materialization path. */
  #config: IRepositoryConfig<TDomain, TStored>

  /** Entity gets business methods and original owner assertions, never a native close handle. */
  #backend: IBackendEntityAccess

  /** Borrowed text methods carry business access without native disposal authority. */
  #store: IEntityKeyValueMethods
  /** The entity name separates physical keys and diagnostic events across definitions. */
  #name: string
  /** The declared domain property supplies stable physical record identities. */
  #keyProp: Extract<keyof TDomain, string>
  /** Materialization and migration write envelopes at this target version. */
  #version: number
  /** The original schema object receives validation and conversion calls with its receiver. */
  #schema: ISchemaAdapter<TDomain, TStored>
  /** The shared plan owns version transitions instead of repository-local migration rules. */
  #migrationPlan: IMigrationPlan
  /** Read materialization validates domain data only when the declaration enables it. */
  #validateOnRead: boolean
  /** The original application callback receives non-fatal entity diagnostics. */
  #onDiagnostic: (message: string) => void
  /** An optional application comparator orders bounded entity query results. */
  #defaultOrderBy: ((left: TDomain, right: TDomain) => number) | undefined

  /** The codec observer receives conversion phases for this repository and its transactions. */
  #codecStages: ICodecStageObserver | undefined

  /** The declared query observer reports actual read counts and transaction phases. */
  #queryStages: IQueryStageObserver | undefined

  /** Optional borrowed record methods choose structured transactions instead of text fallback. */
  #recordStore: IEntityRecordMethods | undefined

  /** Codec selection retains the backend kind established before repository publication. */
  #records: boolean

  /** Non-unique selectors retain their existing write call counts; only constraints need scans. */
  #uniqueIndexes: ISnapshotEntityIndexes<TDomain>

  /** Native and fallback commits share the same canonical unique-key ownership rule. */
  #uniqueDefinitions: readonly ISnapshotEntityIndexes<TDomain>[string]['definition'][]

  /**
   * Select one codec for every repository path. Structured backends use the identity-like
   * structured codec by default, while text-only backends use JSON; an explicit codec is always
   * routed through capability validation.
   */
  #selectedCodec: ISelectedCodec

  /** The selected route preserves the original codec identity for observation. */
  #codecName: string

  /** The declared schema and version route identify resumable checkpoint compatibility. */
  #migrationFingerprint: string

  /** A ready handle is a captured backend fact; bound transactions never create or backfill it. */
  #readyHandle: IRecordIndexHandle | undefined

  /** Per-repository final changes belong to one authentic original transaction identity. */
  #uniqueStates: WeakMap<ITransactionInfo, WeakRef<Map<string, IEntityUniqueMutation>>>
  /** One stable public repository view is returned for this owner. */
  #repository: IRepository<TDomain, TIndexes, TChangeFeed, TAugmentMethods>
  /** Select codec, backend and stage ports before publishing this repository. */
  constructor(
    config: IRepositoryConfig<TDomain, TStored>,
    inputStore: IEntityConnectStore,
    connectOptions?: IEntityConnectOptions
  ) {
    this.#config = config
    this.#backend = snapshotEntityStore(inputStore)
    this.#store = this.#backend.store
    this.#name = config.name
    this.#keyProp = config.key
    this.#version = config.version
    this.#schema = config.schema
    this.#migrationPlan = config.migrationPlan
    this.#validateOnRead = config.validateOnRead
    this.#onDiagnostic = config.onDiagnostic
    this.#defaultOrderBy = config.defaultOrderBy

    this.#codecStages = connectOptions?.codecStages
    this.#queryStages = connectOptions?.queryStages
    if (
      (this.#codecStages !== undefined && this.#codecStages.kind !== StorageStageKind.codec) ||
      (this.#queryStages !== undefined && this.#queryStages.kind !== StorageStageKind.query)
    )
      throw new StorageError(StorageErrorCode.invalidConfig, {
        backend: this.#store.backend,
        cause: new TypeError(StorageErrorText.backendKindMismatch)
      })
    this.#recordStore = this.#backend.recordStore()
    this.#records = this.#recordStore !== undefined
    this.#uniqueIndexes = Object.fromEntries(
      Object.entries(this.#config.indexes).filter(([, index]) => index.definition.unique)
    )
    this.#uniqueDefinitions = Object.values(this.#uniqueIndexes).map((index) => index.definition)
    this.#selectedCodec = selectCodec(
      this.#config.codec ?? (this.#records ? structuredCodec : jsonCodec),
      this.#store.capabilities,
      this.#emitDiagnostic
    )
    this.#codecName =
      this.#config.codec?.name ?? (this.#records ? structuredCodec.name : jsonCodec.name)
    this.#migrationFingerprint = [
      this.#name,
      String(this.#version),
      this.#keyProp,
      this.#schema.name,
      this.#config.codec?.name ?? (this.#records ? structuredCodec.name : jsonCodec.name),
      `range:${this.#migrationPlan.baseVersion}:${this.#migrationPlan.version}`
    ].join('|')
    this.#uniqueStates = new WeakMap<
      ITransactionInfo,
      WeakRef<Map<string, IEntityUniqueMutation>>
    >()
    this.#repository = this.#createApi()
  }
  /** Return the stable public methods while keeping the component state private. */
  api() {
    return this.#repository
  }

  /** Perform the repository emitDiagnostic operation using its own state. */
  #emitDiagnostic = (message: string): void => {
    try {
      /** Preserve the application callback's ordinary function receiver. */
      const report = this.#onDiagnostic
      report(message)
    } catch (cause) {
      reportCleanupError(createStorageOperationRuntime().reporter, cause)
    }
  }

  /** Drive backend-private projection migration without exposing its lease/checkpoint protocol. */
  #backfillIndexes = async (ctx?: IOperationContext): Promise<void> => {
    const capability = asRecordIndexBackfillStore<unknown>(this.#store)
    const definitions = Object.values(this.#config.indexes).map((index) => index.definition)
    if (capability === undefined || definitions.length === 0) return
    const handle = await capability.ensureRecordIndexes(this.#name, definitions, ctx)
    const readiness = await capability.getRecordIndexReadiness(handle, ctx)
    if (readiness.status === 'complete') return
    const migrationState = (await this.#recordStore?.metadata?.get(
      repositoryMigrationKey(this.#name),
      ctx
    )) as { readonly status?: unknown; readonly schemaFingerprint?: unknown } | undefined
    const allowComplete =
      migrationState?.status === StorageMigrationStatus.complete &&
      migrationState.schemaFingerprint === this.#migrationFingerprint
    let session = await capability.openBackfillSession(
      handle,
      {
        range: repositoryEntityRange(this.#name),
        // Legacy keys can contain arbitrarily nested valid array IDs; the backend scans bounded
        // pages and this preparation classifies entity ownership without a lossy prefix range.
        legacyRange: undefined,
        includeLegacy: true,
        allowComplete
      },
      ctx
    )
    let sessionReleased = false
    try {
      let finished = false
      while (!finished) {
        await session.renew(ctx)
        const batch = await session.readBatch(ctx, {
          prepare: (candidate) => this.#prepareEntityBackfillCandidate(session, ctx, candidate)
        })
        if (
          batch.preparations === undefined ||
          batch.preparations.length !== batch.candidates.length
        )
          throw new StorageError(StorageErrorCode.invalidConfig, {
            backend: this.#store.backend
          })
        const projections = batch.candidates.map((candidate, index) => {
          const preparation = batch.preparations![index]!
          return {
            key: candidate.key,
            expectedRevision: candidate.revision,
            outcome: preparation.outcome,
            projection: preparation.projection,
            counted: preparation.counted
          }
        })
        const nextCheckpoint = batch.candidates.at(-1)?.key
        await session.renew(ctx)
        await session.commitBatch(
          {
            phase: batch.phase ?? RecordIndexBackfillPhase.canonical,
            generation: session.generation,
            ownerToken: session.ownerToken,
            checkpoint: batch.checkpoint,
            nextCheckpoint,
            endOfScan: batch.endOfScan,
            projections
          },
          ctx
        )
        finished =
          (batch.phase ?? RecordIndexBackfillPhase.canonical) === RecordIndexBackfillPhase.legacy &&
          batch.endOfScan
        if (!finished) {
          session.release()
          sessionReleased = true
          session = await capability.openBackfillSession(
            handle,
            {
              range: repositoryEntityRange(this.#name),
              legacyRange: undefined,
              includeLegacy: true,
              allowComplete
            },
            ctx
          )
          sessionReleased = false
        }
      }
    } catch (cause) {
      if (isStorageContractError(cause) && cause.code === StorageContractErrorCode.aborted)
        throw cause
      if (sessionReleased) throw cause
      try {
        await session.fail(cause, ctx)
      } catch (persistFailure) {
        throw createStorageAggregateError(
          StorageErrorCode.indexBackfillFailed,
          indexBackfillFailureText(this.#name),
          [cause, persistFailure]
        )
      }
      throw cause
    } finally {
      session.release()
    }
  }

  /** Perform the repository writeEnvelopeAt operation using its own state. */
  #writeEnvelopeAt = async (
    target: IWriteTarget,
    envelope: IEnvelope,
    ctx: IOperationContext | undefined,
    runtime: IEntityOperationRuntime
  ): Promise<void> => {
    await this.#writeEncodedEnvelopeAt(
      target,
      await this.#encodeEnvelope(envelope, ctx, runtime),
      ctx
    )
  }

  /** Commit already encoded data so exclusive KV sections never invoke application codecs. */
  #writeEncodedEnvelopeAt = async (
    target: IWriteTarget,
    raw: unknown,
    ctx: IOperationContext | undefined
  ): Promise<void> => {
    if (this.#recordStore && target.documentKey !== undefined) {
      await this.#recordStore.putRecord(raw, target.documentKey, ctx)
      return
    }
    if (target.flatKey !== undefined) {
      await this.#store.set(target.flatKey, raw as string, ctx)
    }
  }

  /** Every real conversion emits exactly one matching observation sequence. */
  #codecCall = async <R>(
    phase: 'encode' | 'decode',
    invoke: () => Promise<R>,
    runtime: IEntityOperationRuntime
  ): Promise<R> => {
    const stages =
      runtime.scope === undefined
        ? this.#codecStages
        : this.#codecStages?.forTransaction(runtime.scope)
    const operation =
      phase === 'encode' ? StorageOperation.entityCodecEncode : StorageOperation.entityCodecDecode
    const before = phase === 'encode' ? 'beforeEncode' : 'beforeDecode'
    const after = phase === 'encode' ? 'afterEncode' : 'afterDecode'
    const failed = phase === 'encode' ? 'onEncodeError' : 'onDecodeError'
    if (stages?.[before] !== undefined)
      observeEntity(stages!, () => stages![before]!(operation, this.#codecName))
    try {
      const value = await invoke()
      if (stages?.[after] !== undefined)
        observeEntity(stages!, () => stages![after]!(operation, this.#codecName))
      return value
    } catch (cause) {
      if (stages?.[failed] !== undefined)
        observeEntity(stages!, () =>
          stages![failed]!(
            operation,
            this.#codecName,
            readStorageHookFailureCode(cause, stages!.report)
          )
        )
      throw cause
    }
  }

  /** Encode every repository write through the original codec and extension error boundary. */
  #encodeEnvelope = (
    envelope: IEnvelope,
    ctx: IOperationContext | undefined,
    runtime: IEntityOperationRuntime
  ): Promise<unknown> =>
    this.#codecCall(
      'encode',
      () =>
        invokeExtension(
          () => this.#selectedCodec.encode(envelope, ctx),
          this.#store.backend,
          StorageOperation.entityCodecEncode,
          'codec',
          ctx?.signal,
          runtime
        ),
      runtime
    )

  /** Perform the repository materialize operation using its own state. */
  #materialize = async (
    envelope: IEnvelope | undefined,
    ctx: IOperationContext | undefined,
    runtime: IEntityOperationRuntime
  ): Promise<TDomain | undefined> => {
    if (!envelope) return undefined
    /** Observation borrows this original host row and the shared plan's actual execution. */
    const stages = getBackendEnvelopeStages(this.#store, {
      operation: StorageOperation.entityEnvelope,
      targetVersion: this.#version
    })
    /** Timing observes only a real migration; the shared executor owns all steps and cancellation. */
    const started = stages === undefined ? 0 : systemScheduler.now()
    let stored: unknown
    try {
      stored = await migrateEnvelope(this.#migrationPlan, envelope, {
        signal: ctx?.signal,
        report: (cause) => reportCleanupError(runtime.reporter, cause),
        observe: stages?.observe
      })
    } catch (cause) {
      if (
        isStorageContractError(cause) &&
        cause.code === StorageContractErrorCode.versionUnsupported
      ) {
        stages?.onVersionRejected(envelope.version, cause.code)
        throw new StorageError(StorageErrorCode.versionUnsupported, { cause })
      }
      if (isStorageContractError(cause) && cause.code === StorageContractErrorCode.migrationFailed)
        throw new StorageError(
          StorageErrorCode.migrationFailed,
          { cause },
          undefined,
          StorageRecordStage.migrate
        )
      throw cause
    }
    if (envelope.version !== this.#version)
      stages?.afterMigrate(
        this.#version,
        this.#migrationPlan.reset === undefined ? 'steps' : 'reset',
        this.#migrationPlan.reset === undefined ? this.#version - envelope.version : 0,
        systemScheduler.now() - started
      )
    let decoded: TDomain
    try {
      decoded = this.#schema.decode
        ? await invokeExtension(
            () => this.#schema.decode!(stored as TStored, ctx),
            this.#store.backend,
            StorageOperation.entitySchemaDecode,
            'schema',
            ctx?.signal,
            runtime
          )
        : (stored as TDomain)
    } catch (cause) {
      throw stageFailure('decode', cause)
    }
    if (!this.#validateOnRead) return decoded
    try {
      return await invokeExtension(
        () => this.#schema.validate(decoded, ctx),
        this.#store.backend,
        StorageOperation.entitySchemaValidate,
        'schema',
        ctx?.signal,
        runtime
      )
    } catch (cause) {
      throw stageFailure('validate', cause)
    }
  }

  /** Perform the repository toEnvelope operation using its own state. */
  #toEnvelope = async (
    value: TDomain,
    ctx: IOperationContext | undefined,
    runtime: IEntityOperationRuntime
  ): Promise<{ readonly domain: TDomain; readonly envelope: IEnvelope }> => {
    const domain = await invokeExtension(
      () => this.#schema.validate(value, ctx),
      this.#store.backend,
      StorageOperation.entitySchemaValidate,
      'schema',
      ctx?.signal,
      runtime
    )
    const normalized = this.#schema.normalize
      ? await invokeExtension(
          () => this.#schema.normalize!(domain, ctx),
          this.#store.backend,
          StorageOperation.entitySchemaNormalize,
          'schema',
          ctx?.signal,
          runtime
        )
      : domain
    const stored = this.#schema.encode
      ? await invokeExtension(
          () => this.#schema.encode!(normalized, ctx),
          this.#store.backend,
          StorageOperation.entitySchemaEncode,
          'schema',
          ctx?.signal,
          runtime
        )
      : (normalized as unknown as TStored)
    try {
      return {
        domain: normalized,
        envelope: assertVersionedEnvelope({ version: this.#version, state: stored })
      }
    } catch (cause) {
      throw new StorageError(StorageErrorCode.serializeFailed, { cause })
    }
  }

  /** Perform the repository decodeEnvelope operation using its own state. */
  #decodeEnvelope = async (
    raw: unknown,
    ctx: IOperationContext | undefined,
    runtime: IEntityOperationRuntime
  ): Promise<IEnvelope> => {
    const decoded: unknown = await this.#codecCall(
      'decode',
      () =>
        invokeExtension(
          () => this.#selectedCodec.decode(raw, ctx),
          this.#store.backend,
          StorageOperation.entityCodecDecode,
          'codec',
          ctx?.signal,
          runtime
        ),
      runtime
    )
    /** Hooks observe the same validated version envelope used for materialization. */
    const stages = getBackendEnvelopeStages(this.#store, {
      operation: StorageOperation.entityEnvelope,
      targetVersion: this.#version
    })
    stages?.beforeEnvelopeCheck()
    try {
      const envelope = assertVersionedEnvelope(decoded)
      stages?.afterEnvelopeCheck(envelope.version)
      return envelope
    } catch (cause) {
      stages?.onVersionRejected(undefined, StorageContractErrorCode.envelopeInvalid)
      throw new StorageError(StorageErrorCode.deserializeFailed, { cause })
    }
  }

  /** Apply the invalid-record policy once so handler failures have one stable error boundary. */
  #invalidAction = (
    issue: IInvalidRecordIssue<TDomain>,
    option: IListSnapshot<TDomain> | undefined
  ): IInvalidRecordAction => this.#invokeInvalidHandler(option?.onInvalid, issue)

  /** Perform the repository validateInvalidHandler operation using its own state. */
  #validateInvalidHandler = (handler: unknown): void => {
    if (
      handler !== undefined &&
      handler !== 'skip' &&
      handler !== 'throw' &&
      typeof handler !== 'function'
    )
      throw new StorageError(StorageErrorCode.invalidConfig, {
        backend: this.#store.backend,
        cause: new TypeError(EntityText.oninvalidMustBeSkipThrowOrAHandler)
      })
  }

  /** Detach list bounds before the lazy source opens and awaits native reads. */
  #normalizeListOptions = (
    options:
      | IListSnapshot<TDomain>
      | IIndexedListOptions<TDomain, Readonly<Record<string, IStorageKey>>>
      | undefined
  ): IListSnapshot<TDomain> | undefined => {
    validateListOptions(options, this.#store.backend)
    if (options === undefined) return undefined
    let range: IListSnapshot<TDomain>['range']
    let limit: IListSnapshot<TDomain>['limit']
    let orderBy: IListSnapshot<TDomain>['orderBy']
    let direction: IListSnapshot<TDomain>['direction']
    let onInvalid: IListSnapshot<TDomain>['onInvalid']
    range = options.range
    limit = options.limit
    orderBy = options.orderBy
    direction = options.direction
    onInvalid = options.onInvalid

    const rangeSnapshot = snapshotKeyRange(range, this.#store.backend)
    validateLimit(limit, this.#store.backend)
    validateOrderBy(orderBy, this.#store.backend)
    if (direction !== undefined && direction !== 'next' && direction !== 'prev')
      throw new StorageError(StorageErrorCode.invalidConfig, {
        backend: this.#store.backend,
        cause: new TypeError(EntityText.listDirectionMustBeNextOrPrev)
      })
    this.#validateInvalidHandler(onInvalid)
    return { range: rangeSnapshot, limit, orderBy, direction, onInvalid }
  }

  /** Detach indexed list bounds before lazy native work can outlive caller mutation. */
  #snapshotIndexedListOptions = (
    options:
      | IListSnapshot<TDomain>
      | IIndexedListOptions<TDomain, Readonly<Record<string, IStorageKey>>>
      | undefined
  ): IIndexedListSnapshot<TDomain> | undefined => {
    validateListOptions(options, this.#store.backend)
    if (options === undefined) return undefined
    let index: unknown
    let range: IListSnapshot<TDomain>['range']
    let limit: IListSnapshot<TDomain>['limit']
    let orderBy: IListSnapshot<TDomain>['orderBy']
    let direction: IListSnapshot<TDomain>['direction']
    let onInvalid: IListSnapshot<TDomain>['onInvalid']
    index = (options as { readonly index?: unknown }).index
    if (index === undefined) return undefined
    range = options.range
    limit = options.limit
    orderBy = options.orderBy
    direction = options.direction
    onInvalid = options.onInvalid

    if (typeof index !== 'string' || index.length === 0)
      throw new StorageError(StorageErrorCode.invalidConfig, {
        backend: this.#store.backend,
        cause: new TypeError(EntityText.indexedListIndexMustBeANonEmptyString)
      })
    const normalized = this.#normalizeListOptions({ range, limit, orderBy, direction, onInvalid })
    return { index, range: normalized?.range, options: normalized }
  }

  /** Build an indexed snapshot for the findManyBy/findBy/streamBy APIs. */
  #createIndexedListSnapshot = (
    index: string,
    range: IListSnapshot<TDomain>['range'],
    options:
      | IListSnapshot<TDomain>
      | IIndexedListOptions<TDomain, Readonly<Record<string, IStorageKey>>>
      | undefined
  ): IIndexedListSnapshot<TDomain> => {
    const normalized = this.#normalizeListOptions(options)
    const rangeSnapshot = snapshotKeyRange(range, this.#store.backend)
    return { index, range: rangeSnapshot, options: normalized }
  }

  /** Snapshot migration options once before checkpoint or record work begins. */
  #normalizeMigrateOptions = (
    options: IMigrateOptions<TDomain>
  ): { readonly batchSize: number; readonly onInvalid: IMigrateOptions<TDomain>['onInvalid'] } => {
    if (options === null || typeof options !== 'object' || Array.isArray(options))
      throw new StorageError(StorageErrorCode.invalidConfig, {
        backend: this.#store.backend,
        cause: new TypeError(EntityText.migrateOptionsMustBeAnObject)
      })
    let batchSize: IMigrateOptions<TDomain>['batchSize']
    let onInvalid: IMigrateOptions<TDomain>['onInvalid']
    batchSize = options.batchSize
    onInvalid = options.onInvalid

    const normalizedBatchSize = batchSize === undefined ? 100 : batchSize
    if (!Number.isSafeInteger(normalizedBatchSize) || normalizedBatchSize < 1)
      throw new StorageError(StorageErrorCode.invalidConfig, {
        backend: this.#store.backend,
        cause: new RangeError(EntityText.migrateBatchSizeMustBeAPositiveSafeInteger)
      })
    this.#validateInvalidHandler(onInvalid)
    return { batchSize: normalizedBatchSize, onInvalid }
  }

  /** Perform the repository invokeInvalidHandler operation using its own state. */
  #invokeInvalidHandler = (
    handler: IInvalidRecordAction | IInvalidRecordHandler<TDomain> | undefined,
    issue: IInvalidRecordIssue<TDomain>
  ): IInvalidRecordAction => {
    if (handler === undefined || handler === 'skip' || handler === 'throw') return handler ?? 'skip'
    if (typeof handler !== 'function')
      throw new StorageError(StorageErrorCode.invalidConfig, {
        backend: this.#store.backend,
        key: issue.key,
        cause: new TypeError(EntityText.oninvalidMustBeSkipThrowOrAHandler)
      })
    try {
      const action = handler(issue)
      if (action !== 'skip' && action !== 'throw')
        throw new StorageError(StorageErrorCode.invalidConfig, {
          backend: this.#store.backend,
          key: issue.key,
          cause: new TypeError(EntityText.oninvalidHandlerMustReturnSkipOrThrow)
        })
      return action
    } catch (cause) {
      if (isStorageErrorFamily(cause) && cause.code === StorageErrorCode.invalidConfig) throw cause
      throw new StorageError(StorageErrorCode.validationFailed, {
        backend: this.#store.backend,
        key: issue.key,
        cause
      })
    }
  }

  /** Perform the repository throwInvalid operation using its own state. */
  #throwInvalid = (issue: IInvalidRecordIssue<TDomain>): never => {
    /* c8 ignore start -- all current decode/migrate/validate stages normalize to StorageError. */
    if (isStorageErrorFamily(issue.cause)) throw issue.cause
    const code =
      issue.stage === StorageRecordStage.migrate
        ? StorageErrorCode.migrationFailed
        : issue.stage === StorageRecordStage.decode
          ? StorageErrorCode.deserializeFailed
          : StorageErrorCode.validationFailed
    throw new StorageError(code, {
      backend: this.#store.backend,
      key: issue.key,
      cause: issue.cause
    })
    /* c8 ignore stop */
  }

  /** Perform the repository materializeForRead operation using its own state. */
  #materializeForRead = async (
    id: IStorageKey,
    envelope: IEnvelope | undefined,
    ctx: IOperationContext | undefined,
    runtime: IEntityOperationRuntime
  ): Promise<TDomain | undefined> => {
    try {
      return await this.#materialize(envelope, ctx, runtime)
    } catch (cause) {
      /* c8 ignore start -- materialize's extension boundaries already return StorageError. */
      if (isStorageErrorFamily(cause)) throw cause
      const stage = (cause as Partial<IStageFailure>).stage ?? StorageRecordStage.validate
      const code =
        stage === StorageRecordStage.migrate
          ? StorageErrorCode.migrationFailed
          : stage === StorageRecordStage.decode
            ? StorageErrorCode.deserializeFailed
            : StorageErrorCode.validationFailed
      throw new StorageError(code, { backend: this.#store.backend, key: id, cause })
    }
  }

  /** Perform the repository readEnvelope operation using its own state. */
  #readEnvelope = async (
    id: IStorageKey,
    ctx: IOperationContext | undefined,
    runtime: IEntityOperationRuntime
  ): Promise<IEnvelope | undefined> => {
    if (this.#recordStore) {
      let raw = await this.#recordStore.getRecord(composeRepositoryKey(this.#name, id), ctx)
      if (raw === undefined)
        raw = await this.#recordStore.getRecord(composeStructuredKey(this.#name, id), ctx)
      if (raw === undefined) return undefined
      return this.#decodeEnvelope(raw, ctx, runtime)
    }
    const raw = await this.#store.get(composeFlatKey(this.#name, id), ctx)
    if (raw === null) return undefined
    return this.#decodeEnvelope(raw, ctx, runtime)
  }

  /**
   * Canonical ID ordering uses the same radix structure; comparator scans retain only heap
   * candidates.
   */
  async *#streamImpl(
    options: IListSnapshot<TDomain> | undefined,
    ctx: IOperationContext | undefined,
    runtime: IEntityOperationRuntime,
    applyOrdering = true,
    readView?: IRepositoryReadView,
    onRead?: () => void,
    project?: (value: TDomain) => void
  ): AsyncGenerator<TDomain, void, unknown> {
    if (options?.limit === 0) return

    /**
     * Unordered source scans yield immediately; only ordinary canonical ordering builds a candidate
     * index.
     */

    /** The source owns this ordered buffer until its generator finally closes. */
    const scan: IEntityScanContext<TDomain> = {
      options,
      ctx,
      readView,
      onRead,
      applyOrdering,
      candidates: createOrderedRecordIndex<IEntityScanCandidate>()
    }

    let count = 0
    try {
      for await (const row of this.#orderedEntityCandidates(scan)) {
        const raw =
          this.#recordStore !== undefined
            ? readView?.getRecord === undefined
              ? row.raw
              : await readView.getRecord(row.physical as IStorageKey)
            : readView?.get === undefined
              ? await this.#store.get(row.physical as string, ctx)
              : await readView.get(row.physical as string)
        if (raw === undefined || (!this.#recordStore && raw === null)) continue
        let value: TDomain | undefined
        try {
          let envelope: IEnvelope
          try {
            envelope = await this.#decodeEnvelope(raw, ctx, runtime)
          } catch (cause) {
            throw stageFailure(StorageRecordStage.decode, cause)
          }
          value = await this.#materialize(envelope, ctx, runtime)
          if (value !== undefined) project?.(value)
        } catch (cause) {
          value = undefined
          const issue: IInvalidRecordIssue<TDomain> = {
            key: row.id,
            raw,
            stage: (cause as Partial<IStageFailure>).stage ?? StorageRecordStage.validate,
            cause
          }
          if (this.#invalidAction(issue, options) === StorageInvalidRecordAction.throw)
            this.#throwInvalid(issue)
          this.#emitDiagnostic(EntityText.invalidRecord(this.#name, row.id))
        }
        if (value !== undefined) {
          yield value
          if (options?.limit !== undefined && ++count >= options.limit) return
        }
      }
    } finally {
      scan.candidates.clear()
    }
  }

  /** Domain callbacks and bounded selection use the sole contract query executor. */
  #listQuery = (
    options: IListSnapshot<TDomain> | undefined,
    ctx: IOperationContext | undefined,
    runtime: IEntityOperationRuntime,
    readView?: IRepositoryReadView,
    onRead?: () => void
  ): IRecordQueryBase<TDomain, IOperationContext> => {
    const comparator = options?.orderBy ?? this.#defaultOrderBy
    if (comparator !== undefined && options?.limit === undefined)
      throw new StorageError(StorageErrorCode.invalidConfig, {
        backend: this.#store.backend,
        cause: new TypeError(EntityText.comparatorLimit)
      })
    const source = createRecordQuery<TDomain>({
      asyncDisposeKey,
      pushdown: { source: EntityState.querySource, operations: [], operators: [] },
      execute: () =>
        entityIterator(
          (async function* (
            repositoryOwner: EntityRepositoryOwner<
              TDomain,
              TStored,
              TIndexes,
              TAugmentMethods,
              TChangeFeed
            >
          ) {
            for await (const value of repositoryOwner.#streamImpl(
              { ...options, orderBy: undefined, limit: undefined },
              ctx,
              runtime,
              comparator === undefined,
              readView,
              onRead
            ))
              yield [
                idOf(
                  repositoryOwner.#name,
                  repositoryOwner.#keyProp,
                  value,
                  repositoryOwner.#store.backend
                ),
                value
              ] as const
          })(this),
          runtime
        )
    })
    if (comparator !== undefined)
      return source
        .orderByComparator((left, right) => {
          try {
            const result = comparator(left, right)
            if (!Number.isFinite(result))
              throw createStorageTypeError(
                StorageErrorCode.extensionFailed,
                StorageErrorText.entityComparatorInvalid
              )
            return options?.direction === 'prev' ? -result : result
          } catch (cause) {
            throw new StorageError(StorageErrorCode.extensionFailed, {
              backend: this.#store.backend,
              cause,
              operation: StorageOperation.entityOrderBy,
              extensionStage: 'comparator'
            })
          }
        })
        .limit(options!.limit!)
    return options?.limit === undefined ? source : source.limit(options.limit)
  }

  /**
   * New fallback write checks reuse the existing extension boundary without changing native
   * backfill identity.
   */
  #projectUniqueWrite = (value: TDomain): IRecordIndexProjection => {
    try {
      return projectEntityIndexes(this.#uniqueIndexes, value, this.#store.backend)
    } catch (cause) {
      throw normalizeError(
        cause,
        this.#store.backend,
        StorageErrorCode.extensionFailed,
        StorageOperation.entityIndexProjection
      )
    }
  }

  /** Validate the final proposed rows through the same projection/ownership owner as native IDB. */
  #validateUniqueRows = async (
    changes: ReadonlyMap<string, IEntityUniqueMutation>,
    ctx: IOperationContext | undefined,
    runtime: IEntityOperationRuntime,
    readView: IRepositoryReadView
  ): Promise<void> => {
    /**
     * Unchanged rows come from one canonical decoder; changed rows already have prepared
     * projections.
     */
    const rows: Array<{ readonly key: IStorageKey; readonly projection: IRecordIndexProjection }> =
      []
    for await (const value of this.#streamImpl(undefined, ctx, runtime, false, readView)) {
      /** Normal repository writes bind the domain key to the physical record identity. */
      const id = idOf(this.#name, this.#keyProp, value, this.#store.backend)
      rows.push({ key: id, projection: this.#projectUniqueWrite(value) })
    }
    for (const change of changes.values())
      if (change.projection !== undefined)
        rows.push({ key: change.id, projection: change.projection })
    collectUniqueIndexOwners(this.#uniqueDefinitions, rows, this.#store.backend)
  }

  /** Use one normal record revision as a phantom barrier, with no sidecar or duplicate queue. */
  #validateUniqueRecordCommit = async (
    tx: ITransactionScope,
    changes: ReadonlyMap<string, IEntityUniqueMutation>,
    ctx: IOperationContext | undefined,
    runtime: IEntityOperationRuntime
  ): Promise<void> => {
    if (
      this.#uniqueDefinitions.length === 0 ||
      ![...changes.values()].some((change) => change.projection !== undefined)
    )
      return
    const marker = repositoryUniqueWriteKey(this.#name)
    await tx.getRecord(marker)
    const replaced = new Set(
      [...changes.values()].flatMap((change) => [
        encodeFlatStorageKey(composeRepositoryKey(this.#name, change.id)),
        encodeFlatStorageKey(composeStructuredKey(this.#name, change.id))
      ])
    )
    await this.#validateUniqueRows(changes, ctx, runtime, {
      getRecord: (key) =>
        replaced.has(encodeFlatStorageKey(key)) ? Promise.resolve(undefined) : tx.getRecord(key),
      iterateRecords: (range) => tx.iterateRecords(range),
      ...(tx.iterateRecordIndex === undefined
        ? {}
        : { iterateRecordIndex: (query) => tx.iterateRecordIndex!(query) })
    })
    await tx.putRecord(true, marker, { conflictPolicy: 'replace' })
  }

  /**
   * Capture only this entity's raw text; exact string equality avoids re-running codecs under a
   * lock.
   */
  #snapshotUniqueValues = async (
    ctx: IOperationContext | undefined
  ): Promise<ReadonlyMap<string, string>> => {
    /** Backend namespace isolation is already owned by its public keys/get methods. */
    const prefix = flatKeyPrefix(this.#name)
    /** Missing keys are absent from the snapshot even if enumeration raced their deletion. */
    const snapshot = new Map<string, string>()
    for (const key of await this.#store.keys(ctx)) {
      if (!key.startsWith(prefix)) continue
      /** Read each stored text once for subsequent schema/projection work. */
      const raw = await this.#store.get(key, ctx)
      if (raw !== null) snapshot.set(key, raw)
    }
    return snapshot
  }

  /**
   * Preserve KV support: validate outside the critical section, then compare-and-commit under its
   * host owner.
   */
  #writeUniqueValue = async (
    id: IStorageKey,
    domain: TDomain,
    envelope: IEnvelope,
    ctx: IOperationContext | undefined
  ): Promise<void> => {
    const commit = getBackendValueCommit(this.#store)
    if (commit === undefined)
      throw new StorageContractError(StorageContractErrorCode.unsupported, {
        backend: this.#store.backend
      })
    return withAbort(ctx, async (signal, context, runtime) => {
      /** One deadline covers preparation and lock admission; nested backend calls share its signal. */
      const operation = { ...context, signal, timeoutMs: undefined }
      /** All application encoding runs before lock admission, including asynchronous codecs. */
      const raw = await this.#encodeEnvelope(envelope, operation, runtime)
      /** Incoming projection is prepared once; the old value at the same primary key is replaced. */
      const changes = new Map<string, IEntityUniqueMutation>([
        [
          encodeFlatStorageKey(id),
          {
            id,
            projection: this.#projectUniqueWrite(domain)
          }
        ]
      ])
      /** Capture the exact raw values whose materialized projections are checked. */
      const snapshot = await this.#snapshotUniqueValues(operation)
      /** The current primary key is not a competing owner. */
      const targetKey = composeFlatKey(this.#name, id)
      await this.#validateUniqueRows(changes, operation, runtime, {
        keys: async () => [...snapshot.keys()].filter((key) => key !== targetKey),
        get: async (key) => snapshot.get(key) ?? null
      })
      await commit(
        {
          prefix: flatKeyPrefix(this.#name),
          expected: [...snapshot],
          key: targetKey,
          value: raw as string
        },
        operation
      )
    })
  }

  /** Fixed ordering metadata concatenates two canonical encodings without taxing a synthetic key. */
  #encodeIndexOrder = (key: IStorageKey, id: IStorageKey): Uint8Array => {
    const index = encodeOrderedStorageKey(key, this.#store.backend)
    const primary = encodeOrderedStorageKey(id, this.#store.backend)
    const encoded = new Uint8Array(index.byteLength + primary.byteLength)
    encoded.set(index)
    encoded.set(primary, index.byteLength)
    return encoded
  }

  /** Perform the repository indexRows operation using its own state. */
  #indexRows = (
    snapshot: IIndexedListSnapshot<TDomain>,
    ctx: IOperationContext | undefined,
    readView?: IRepositoryReadView,
    orderedSource = true,
    onRead?: () => void
  ): IStorageIterator<readonly [IStorageKey, IMatch<TDomain>]> => {
    const index = this.#config.indexes[snapshot.index]
    if (index === undefined)
      throw new StorageError(StorageErrorCode.invalidConfig, {
        backend: this.#store.backend,
        cause: new TypeError(EntityText.indexMissing(this.#name, snapshot.index))
      })
    const runtime = readView?.runtime ?? createStorageOperationRuntime()
    return entityIterator(
      (async function* (
        repositoryOwner: EntityRepositoryOwner<
          TDomain,
          TStored,
          TIndexes,
          TAugmentMethods,
          TChangeFeed
        >
      ) {
        if (snapshot.options?.limit === 0) return
        const seen = new Set<string>()
        const ordered = createOrderedRecordIndex<IMatch<TDomain>>()
        const match = (value: TDomain): IMatch<TDomain> | undefined => {
          const id = idOf(
            repositoryOwner.#name,
            repositoryOwner.#keyProp,
            value,
            repositoryOwner.#store.backend
          )
          const identity = encodeFlatStorageKey(id)
          if (seen.has(identity)) return
          const projection = index.project(value, repositoryOwner.#store.backend)
          const first = minimumProjectedIndexKey(projection, snapshot.range)
          if (first === undefined) return
          seen.add(identity)
          return { id, key: first, value }
        }
        try {
          if (readView === undefined) {
            const capability = asRecordIndexBackfillStore<unknown>(repositoryOwner.#store)
            if (capability !== undefined) {
              try {
                await repositoryOwner.#backfillIndexes(ctx)
                const handle = await capability.ensureRecordIndexes(
                  repositoryOwner.#name,
                  Object.values(repositoryOwner.#config.indexes).map((item) => item.definition),
                  ctx
                )
                if ((await capability.getRecordIndexReadiness(handle, ctx)).status === 'complete')
                  repositoryOwner.#readyHandle = handle
              } catch (cause) {
                if (!isBackfillContentionFailure(cause)) throw cause
              }
            }
          }
          /** Native index admission retains its original lazy position after source preparation. */
          const secondaryStore =
            readView === undefined && repositoryOwner.#recordStore !== undefined
              ? repositoryOwner.#backend.secondaryStore()
              : undefined
          const native =
            readView === undefined
              ? secondaryStore !== undefined
                ? (query: Parameters<ISecondaryIndexRecordStore['iterateRecordIndex']>[0]) =>
                    secondaryStore.iterateRecordIndex(query, ctx)
                : undefined
              : readView.iterateRecordIndex
          /** Bound operations carry only readiness proved by their own current native scope. */
          const selectedHandle =
            readView === undefined ? repositoryOwner.#readyHandle : readView.readyHandle
          if (selectedHandle !== undefined && native !== undefined) {
            for await (const [physical, raw] of native({
              handle: selectedHandle,
              index: snapshot.index,
              range: snapshot.range,
              direction: snapshot.options?.direction
            })) {
              onRead?.()
              let current: IMatch<TDomain> | undefined
              try {
                const value = await repositoryOwner.#materialize(
                  await repositoryOwner.#decodeEnvelope(raw, ctx, runtime),
                  ctx,
                  runtime
                )
                if (value !== undefined) current = match(value)
              } catch (cause) {
                const issue: IInvalidRecordIssue<TDomain> = {
                  key: physical,
                  raw,
                  stage: (cause as Partial<IStageFailure>).stage ?? StorageRecordStage.validate,
                  cause
                }
                if (
                  repositoryOwner.#invalidAction(issue, snapshot.options) ===
                  StorageInvalidRecordAction.throw
                )
                  repositoryOwner.#throwInvalid(issue)
                repositoryOwner.#emitDiagnostic(
                  EntityText.invalidRecord(repositoryOwner.#name, physical)
                )
              }
              if (current !== undefined) {
                if (!orderedSource) yield [current.id, current] as const
                else
                  ordered.set(repositoryOwner.#encodeIndexOrder(current.key, current.id), current)
              }
            }
          } else {
            repositoryOwner.#emitDiagnostic(
              EntityText.indexFallback(repositoryOwner.#name, snapshot.index)
            )
            let projected: IMatch<TDomain> | undefined
            for await (const _value of repositoryOwner.#streamImpl(
              { onInvalid: snapshot.options?.onInvalid },
              ctx,
              runtime,
              false,
              readView,
              onRead,
              (value) => {
                projected = match(value)
              }
            )) {
              const current = projected
              if (current === undefined) continue
              if (!orderedSource) yield [current.id, current] as const
              else ordered.set(repositoryOwner.#encodeIndexOrder(current.key, current.id), current)
            }
          }
          for (
            let item = snapshot.options?.direction === 'prev' ? ordered.last : ordered.first;
            item !== undefined;
            item = snapshot.options?.direction === 'prev' ? item.previous : item.next
          )
            yield [item.value.id, item.value] as const
        } finally {
          ordered.clear()
          seen.clear()
        }
      })(this),
      runtime
    )
  }

  /** Perform the repository createIndexQuery operation using its own state. */
  #createIndexQuery = (
    snapshot: IIndexedListSnapshot<TDomain>,
    ctx: IOperationContext | undefined,
    readView?: IRepositoryReadView,
    onRead?: () => void
  ): IQueryResult<TDomain, IOperationContext> => {
    ctx = snapshotOperationContext(ctx)
    const index = this.#config.indexes[snapshot.index]
    if (index === undefined)
      throw new StorageError(StorageErrorCode.invalidConfig, {
        backend: this.#store.backend,
        cause: new TypeError(EntityText.indexMissing(this.#name, snapshot.index))
      })
    const comparator = snapshot.options?.orderBy ?? this.#defaultOrderBy
    if (comparator !== undefined && snapshot.options?.limit === undefined)
      throw new StorageError(StorageErrorCode.invalidConfig, {
        backend: this.#store.backend,
        cause: new TypeError(EntityText.comparatorLimit)
      })
    const source = createRecordQuery<IMatch<TDomain>>({
      asyncDisposeKey,
      pushdown: { source: EntityState.querySource, operations: [], operators: [] },
      execute: () => this.#indexRows(snapshot, ctx, readView, comparator === undefined, onRead)
    })
    let query: IRecordQueryBase<IMatch<TDomain>, IOperationContext> = source
    if (comparator !== undefined)
      query = source
        .orderByComparator((left, right) => {
          try {
            const compared = comparator(left.value, right.value)
            if (!Number.isFinite(compared))
              throw createStorageTypeError(
                StorageErrorCode.extensionFailed,
                StorageErrorText.entityComparatorInvalid
              )
            const tie =
              compareStorageKeys(left.key, right.key) || compareStorageKeys(left.id, right.id)
            const result = compared || tie
            return snapshot.options?.direction === 'prev' ? -result : result
          } catch (cause) {
            throw new StorageError(StorageErrorCode.extensionFailed, {
              backend: this.#store.backend,
              cause,
              operation: StorageOperation.entityOrderBy,
              extensionStage: 'comparator'
            })
          }
        })
        .limit(snapshot.options!.limit!)
    else if (snapshot.options?.limit !== undefined) query = source.limit(snapshot.options.limit)
    return query.select((match) => match.value)
  }

  /** One scoped source remains registered through mapping, buffering and actual cleanup. */
  #scopedQuerySource = (
    scope: ITransactionScope,
    selection: IEntityQuerySourceSelection<TDomain>,
    onRead?: () => void,
    orderedSource = true,
    physicalIds?: Map<string, IStorageKey>,
    accepts?: (value: TDomain) => boolean
  ): IStorageIterator<readonly [IStorageKey, TDomain]> => {
    this.#backend.assertScope(scope)
    const source = scope.iterateRecords()
    /** Only this source can advance or release its cursor state. */
    const sourceContext: IEntityScopedSourceContext<TDomain> = {
      selection,
      onRead,
      orderedSource,
      physicalIds,
      accepts,
      rows: createOrderedRecordIndex<readonly [IStorageKey, TDomain]>(),
      seen: physicalIds ?? new Set<string>(),
      prepared: false,
      initialized: false,
      item: undefined
    }
    const derived = deriveTransactionIterator<
      [IStorageKey, unknown],
      readonly [IStorageKey, TDomain]
    >(
      source,
      (next, _fail, current) =>
        this.#advanceScopedEntitySource(sourceContext, next, current as ITransactionScope),
      () => this.#closeScopedEntitySource(sourceContext)
    )
    return derived!
  }

  /** Observation wraps the same original core for both fluent and legacy option adapters. */
  #observeQueryRead = <R>(
    invoke: () => Promise<R>,
    plan: IEntityQueryPlan,
    selection: IEntityQuerySourceSelection<TDomain>,
    current: ITransactionScope | undefined,
    openedCounter: () => { readCount: number } | undefined,
    returnedCount: (value: R) => number
  ): Promise<R> => {
    if (this.#queryStages === undefined) return invoke()
    const stages =
      current === undefined ? this.#queryStages : this.#queryStages?.forTransaction(current)
    const started = stages === undefined ? 0 : systemScheduler.now()
    if (stages?.beforeQuery !== undefined)
      observeEntity(stages, () => stages.beforeQuery!(this.#name, selection.index, plan))
    let pending: Promise<R>
    try {
      pending = invoke()
    } catch (cause) {
      pending = Promise.reject(cause)
    }
    const counter = openedCounter()
    return pending.then(
      (values) => {
        if (stages?.afterQuery !== undefined)
          observeEntity(stages, () =>
            stages.afterQuery!(this.#name, selection.index, {
              readCount: counter?.readCount ?? 0,
              returnedCount: returnedCount(values),
              elapsedMs: systemScheduler.now() - started,
              completed: true
            })
          )
        return values
      },
      (cause) => {
        if (stages?.onQueryError !== undefined)
          observeEntity(stages, () =>
            stages.onQueryError!(
              this.#name,
              selection.index,
              readStorageHookFailureCode(cause, stages.report)
            )
          )
        throw cause
      }
    )
  }

  /** Perform the repository observeQueryStream operation using its own state. */
  #observeQueryStream = <R>(
    iterator: IStorageIterator<R>,
    plan: IEntityQueryPlan,
    selection: IEntityQuerySourceSelection<TDomain>,
    counter: { readCount: number } | undefined
  ): IStorageIterator<R> => {
    if (this.#queryStages === undefined) return iterator
    /** Diagnostics accumulate only for this actual iterator lifetime. */
    const observation: IEntityQueryObservation<TDomain, R> = {
      iterator,
      plan,
      selection,
      counter,
      returnedCount: 0,
      elapsedMs: 0
    }
    const derived = deriveTransactionIterator(iterator, (next, _fail, current) =>
      this.#advanceObservedEntityQuery(observation, next, current as ITransactionScope)
    )
    if (derived !== undefined) return derived
    return {
      next: () => this.#advanceObservedEntityQuery(observation, () => iterator.next()),
      return: iterator.return === undefined ? undefined : (value) => iterator.return!(value),
      dispose: () => iterator.dispose(),
      [asyncDisposeKey]: () => iterator[asyncDisposeKey](),
      [Symbol.asyncIterator]() {
        return this
      }
    }
  }

  /** Source adaptation contributes no second AST or query executor. */
  /** Bind one entity query to its original scope and observer facts. */
  #queryFor = <C extends IOperationContext | undefined>(
    scope?: ITransactionScope
  ): IEntityQuery<TDomain, TIndexes, C, TAugmentMethods> => {
    /** Synchronous terminal opening shares these facts with its actual source. */
    const execution: IEntityQueryExecution<TDomain> = { scope }
    return createEntityQuery<TDomain, TIndexes, C, TAugmentMethods>({
      predicate: this.#queryPredicate,
      selector: this.#querySelector,
      mapper: this.#queryMapper,
      comparator: this.#queryComparator,
      methods: getBackendEntityQueryMethods(this.#store) as TAugmentMethods | undefined,
      defaultComparator: this.#defaultOrderBy,
      run: (invoke, plan, selection, count) =>
        this.#runEntityQuery(execution, invoke, plan, selection, count),
      stream: (open, plan, selection) => this.#streamEntityQuery(execution, open, plan, selection),
      missingLimit: this.#queryMissingLimit,
      invalidState: this.#queryInvalidState,
      invalid: this.#queryInvalid,
      range: this.#queryRange,
      index: this.#queryIndex,
      source: (selection) => this.#createEntitySource(execution, selection)
    })
  }
  /** Adapt the application predicate callback at the entity boundary. */
  #queryPredicate: Parameters<
    typeof createEntityQuery<TDomain, TIndexes, IOperationContext, TAugmentMethods>
  >[0]['predicate'] = (fn) => (value) => {
    try {
      const result = fn(value)
      if (typeof result !== 'boolean') {
        void Promise.resolve(result).catch(createStorageOperationRuntime().reporter)
        throw new TypeError(EntityText.queryPredicateBoolean)
      }
      return result
    } catch (cause) {
      throw new StorageError(StorageErrorCode.extensionFailed, {
        backend: this.#store.backend,
        cause,
        operation: StorageOperation.queryWhere,
        extensionStage: 'where'
      })
    }
  }
  /** Adapt the application selector callback at the entity boundary. */
  #querySelector: Parameters<
    typeof createEntityQuery<TDomain, TIndexes, IOperationContext, TAugmentMethods>
  >[0]['selector'] = (fn) => (value) => {
    try {
      const result = fn(value)
      try {
        /** Later callbacks can mutate the returned key while the query retains ordering state. */
        return snapshotStorageKey(result, this.#store.backend)
      } catch (cause) {
        void Promise.resolve(result).catch(createStorageOperationRuntime().reporter)
        throw new TypeError(EntityText.querySelectorKey, { cause })
      }
    } catch (cause) {
      throw new StorageError(StorageErrorCode.extensionFailed, {
        backend: this.#store.backend,
        cause,
        operation: StorageOperation.querySelector,
        extensionStage: 'selector'
      })
    }
  }
  /** Adapt the application mapper callback at the entity boundary. */
  #queryMapper: Parameters<
    typeof createEntityQuery<TDomain, TIndexes, IOperationContext, TAugmentMethods>
  >[0]['mapper'] = (fn) => async (value) => {
    try {
      return await fn(value)
    } catch (cause) {
      throw new StorageError(StorageErrorCode.extensionFailed, {
        backend: this.#store.backend,
        cause,
        operation: StorageOperation.querySelect,
        extensionStage: 'select'
      })
    }
  }
  /** Adapt the application comparator callback at the entity boundary. */
  #queryComparator: Parameters<
    typeof createEntityQuery<TDomain, TIndexes, IOperationContext, TAugmentMethods>
  >[0]['comparator'] = (fn) => (left, right) => {
    try {
      const result = fn(left, right)
      if (!Number.isFinite(result)) {
        void Promise.resolve(result).catch(createStorageOperationRuntime().reporter)
        throw new TypeError(StorageErrorText.entityComparatorInvalid)
      }
      return result
    } catch (cause) {
      throw new StorageError(StorageErrorCode.extensionFailed, {
        backend: this.#store.backend,
        cause,
        operation: StorageOperation.queryComparator,
        extensionStage: 'comparator'
      })
    }
  }
  /** Carry terminal observer facts through the original transaction operation. */
  #runEntityQuery = <R>(
    execution: IEntityQueryExecution<TDomain>,
    invoke: () => Promise<R>,
    plan: IEntityQueryPlan,
    selection: IEntityQuerySourceSelection<TDomain>,
    returnedCount: (value: R) => number
  ): Promise<R> => {
    const collect = (current?: ITransactionScope) => {
      const previous = execution.openingPlan
      const previousSelection = execution.openingSelection
      execution.openingPlan = plan
      execution.openingSelection = selection
      try {
        return this.#observeQueryRead(
          invoke,
          plan,
          selection,
          current,
          () => execution.opened,
          returnedCount
        )
      } finally {
        execution.openingPlan = previous
        execution.openingSelection = previousSelection
      }
    }
    return execution.scope === undefined
      ? collect()
      : runTransactionOperation(execution.scope, (current) => collect(current))
  }
  /** Open one stream while publishing only its synchronous observer facts. */
  #streamEntityQuery = <R>(
    execution: IEntityQueryExecution<TDomain>,
    open: () => IStorageIterator<R>,
    plan: IEntityQueryPlan,
    selection: IEntityQuerySourceSelection<TDomain>
  ): IStorageIterator<R> => {
    const previous = execution.openingPlan
    const previousSelection = execution.openingSelection
    execution.openingPlan = plan
    execution.openingSelection = selection
    let iterator: ReturnType<typeof open>
    try {
      iterator = open()
    } finally {
      execution.openingPlan = previous
      execution.openingSelection = previousSelection
    }
    return this.#observeQueryStream(iterator, plan, selection, execution.opened)
  }
  /** Adapt the application missingLimit callback at the entity boundary. */
  #queryMissingLimit: Parameters<
    typeof createEntityQuery<TDomain, TIndexes, IOperationContext, TAugmentMethods>
  >[0]['missingLimit'] = () => {
    throw new StorageError(StorageErrorCode.invalidConfig, {
      backend: this.#store.backend,
      cause: new TypeError(EntityText.comparatorLimit)
    })
  }
  /** Adapt the application invalidState callback at the entity boundary. */
  #queryInvalidState: Parameters<
    typeof createEntityQuery<TDomain, TIndexes, IOperationContext, TAugmentMethods>
  >[0]['invalidState'] = (cause) => {
    throw new StorageError(StorageErrorCode.invalidConfig, {
      backend: this.#store.backend,
      cause: cause ?? new TypeError(EntityText.queryState)
    })
  }
  /** Adapt the application invalid callback at the entity boundary. */
  #queryInvalid: Parameters<
    typeof createEntityQuery<TDomain, TIndexes, IOperationContext, TAugmentMethods>
  >[0]['invalid'] = (action) => {
    this.#normalizeListOptions({ onInvalid: action as IInvalidRecordAction })
  }
  /** Adapt the application range callback at the entity boundary. */
  #queryRange: Parameters<
    typeof createEntityQuery<TDomain, TIndexes, IOperationContext, TAugmentMethods>
  >[0]['range'] = (range) => snapshotKeyRange(range, this.#store.backend)!
  /** Adapt the application index callback at the entity boundary. */
  #queryIndex: Parameters<
    typeof createEntityQuery<TDomain, TIndexes, IOperationContext, TAugmentMethods>
  >[0]['index'] = (index, match) => {
    const range =
      match === undefined
        ? undefined
        : isPlainObject(match) && ('lower' in match || 'upper' in match)
          ? match
          : { lower: match, upper: match }
    const snapshot = this.#createIndexedListSnapshot(
      index,
      range as import('@migaia/storage-contract').IKeyRange | undefined,
      undefined
    )
    if (this.#config.indexes[index] === undefined)
      throw new StorageError(StorageErrorCode.invalidConfig, {
        backend: this.#store.backend,
        cause: new TypeError(EntityText.indexMissing(this.#name, index))
      })
    return { index, range: snapshot.range }
  }
  /** A source owns one selection and borrows the descriptor execution facts. */
  #createEntitySource = (
    execution: IEntityQueryExecution<TDomain>,
    selectedSource: IEntityQuerySourceSelection<TDomain>
  ): IRecordQuerySource => {
    /** Each source selection belongs to its original descriptor execution. */
    const sourceContext: IEntityQuerySourceContext<TDomain> = {
      execution,
      selection: selectedSource
    }
    return {
      asyncDisposeKey,
      tieBreakByKey: { direction: 'next', parts: true },
      pushdown: { source: EntityState.querySource, operations: [], operators: [] },
      ...(execution.scope !== undefined || this.#backend.watchRecords === undefined
        ? {}
        : {
            watch: ({ ctx }: import('@migaia/storage-contract').IRecordQueryInput) =>
              this.#backend.watchRecords!(ctx)
          }),
      plan: (conditions) => this.#planEntitySource(sourceContext, conditions),
      mutate: (request, run) => this.#mutateEntitySource(sourceContext, request, run),
      execute: (input) => this.#executeEntitySource(sourceContext, input)
    }
  }
  /** Select the canonical index plan using explicit source facts. */
  #planEntitySource = (
    sourceContext: IEntityQuerySourceContext<TDomain>,
    conditions: Parameters<NonNullable<IRecordQuerySource['plan']>>[0]
  ): ReturnType<NonNullable<IRecordQuerySource['plan']>> => {
    /** Explicit source choice precedes automatic static condition selection. */
    const explicit =
      sourceContext.selection.index !== undefined || sourceContext.selection.range !== undefined
    const automatic = explicit
      ? undefined
      : chooseEntityQueryIndex(this.#config.indexes, conditions, this.#store.backend)
    const selection = { ...(automatic?.selection ?? sourceContext.selection) }
    const index = selection.index === undefined ? undefined : this.#config.indexes[selection.index]
    return {
      fullScan: true,
      selection,
      pushdown: {
        source: EntityState.querySource,
        ...(selection.index === undefined ? {} : { index: selection.index }),
        operations: index === undefined ? [] : [QueryOperation.where],
        operators: index === undefined ? [] : ENTITY_QUERY_INDEX_OPERATORS,
        ...(index === undefined
          ? {}
          : {
              canPushCondition: (condition: IQueryCondition) =>
                supportsEntityIndexCondition(this.#config.indexes, condition)
            })
      },
      sourceReason: explicit ? EntityText.queryIndexExplicit : automatic!.sourceReason,
      sourceCandidates: explicit
        ? Object.keys(this.#config.indexes).map((index) => ({
            index,
            reason: EntityText.queryIndexExplicit
          }))
        : automatic!.sourceCandidates
    }
  }
  /** Run query writes in the original transaction using explicit source facts. */
  #mutateEntitySource = (
    sourceContext: IEntityQuerySourceContext<TDomain>,
    request: Parameters<NonNullable<IRecordQuerySource['mutate']>>[0],
    run: Parameters<NonNullable<IRecordQuerySource['mutate']>>[1]
  ): ReturnType<NonNullable<IRecordQuerySource['mutate']>> => {
    if (this.#recordStore === undefined)
      throw new StorageContractError(StorageContractErrorCode.unsupported, {
        backend: this.#store.backend
      })
    /** Capture the same observer/source facts before the original transaction can suspend. */
    const policy = sourceContext.execution.openingSelection ?? sourceContext.selection
    const orderedSource = sourceContext.execution.openingPlan?.hasOrder !== true
    const counter = this.#queryStages === undefined ? undefined : { readCount: 0 }
    sourceContext.execution.opened = counter
    const onRead =
      counter === undefined
        ? undefined
        : () => {
            counter.readCount++
          }
    /** The authentic operation owns selection, repository writes and the existing first error. */
    /** Mutation facts outlive native admission without another captured callback component. */
    const mutation: IEntityQueryMutationContext<TDomain> = {
      source: sourceContext,
      policy,
      orderedSource,
      onRead,
      request,
      run
    }
    return sourceContext.execution.scope === undefined
      ? this.#recordStore.transaction(
          (target) => this.#applyEntityQueryMutation(mutation, target),
          {
            ...request.ctx,
            concurrency: request.concurrency
          }
        )
      : this.#applyEntityQueryMutation(mutation, sourceContext.execution.scope)
  }
  /** Open the selected lazy native source using explicit source facts. */
  #executeEntitySource = (
    sourceContext: IEntityQuerySourceContext<TDomain>,
    {
      ctx,
      conditions,
      selection: planned
    }: Parameters<NonNullable<IRecordQuerySource['execute']>>[0]
  ): ReturnType<NonNullable<IRecordQuerySource['execute']>> => {
    const selection = {
      ...((planned as IEntityQuerySourceSelection<TDomain> | undefined) ?? sourceContext.selection),
      onInvalid: (sourceContext.execution.openingSelection ?? sourceContext.selection).onInvalid
    }
    const predicates = conditions.map((condition) =>
      compileStorageQueryCondition<TDomain>(condition)
    )
    const accepts = (value: TDomain) => predicates.every((predicate) => predicate(value))
    const counter = this.#queryStages === undefined ? undefined : { readCount: 0 }
    sourceContext.execution.opened = counter
    const onRead =
      counter === undefined
        ? undefined
        : () => {
            counter.readCount++
          }
    const orderedSource = sourceContext.execution.openingPlan?.hasOrder !== true
    if (sourceContext.execution.scope !== undefined)
      return this.#scopedQuerySource(
        sourceContext.execution.scope,
        selection,
        onRead,
        orderedSource,
        undefined,
        accepts
      )
    const context = snapshotOperationContext(ctx)
    const runtime = createStorageOperationRuntime()
    return entityIterator(
      (async function* (
        repositoryOwner: EntityRepositoryOwner<
          TDomain,
          TStored,
          TIndexes,
          TAugmentMethods,
          TChangeFeed
        >
      ) {
        if (selection.index !== undefined) {
          const snapshot = repositoryOwner.#createIndexedListSnapshot(
            selection.index,
            selection.range,
            {
              onInvalid: selection.onInvalid
            }
          )
          for await (const [id, row] of repositoryOwner.#indexRows(
            snapshot,
            context,
            undefined,
            orderedSource,
            onRead
          ))
            if (accepts(row.value)) yield [[row.key, id], row.value] as const
        } else {
          for await (const value of repositoryOwner.#streamImpl(
            { range: selection.range, onInvalid: selection.onInvalid },
            context,
            runtime,
            orderedSource,
            undefined,
            onRead
          ))
            if (accepts(value))
              yield [
                [
                  idOf(
                    repositoryOwner.#name,
                    repositoryOwner.#keyProp,
                    value,
                    repositoryOwner.#store.backend
                  )
                ],
                value
              ] as const
        }
      })(this),
      runtime
    )
  }

  /** Perform the repository bindRepository operation using its own state. */
  #bindRepository = (
    scope: ITransactionScope,
    expectedIdentity?: IStorageKey
  ): IEntityTransactionScope<TDomain, TIndexes, TAugmentMethods> => {
    const info = this.#backend.assertScope(scope)
    let stateReference = this.#uniqueStates.get(info)
    if (this.#uniqueDefinitions.length !== 0 && stateReference?.deref() === undefined) {
      const changes = new Map<string, IEntityUniqueMutation>()
      stateReference = new WeakRef(changes)
      this.#uniqueStates.set(info, stateReference)
      registerTransactionFinalizer(scope, async (check) => {
        try {
          await this.#validateUniqueRecordCommit(
            check,
            changes,
            readTransactionOperationContext(check),
            entityRuntime(check)
          )
        } finally {
          changes.clear()
          this.#uniqueStates.delete(info)
        }
      })
    }
    /**
     * The original finalizer owns strong state while active; saved endpoints keep only this weak
     * reference.
     */
    const activeChanges = stateReference
    /** Bound endpoints retain only the same weak mutation state and authentic scope. */
    const binding: IEntityRepositoryBinding = { scope, expectedIdentity, activeChanges }
    return {
      query: () => this.#boundQuery(binding),
      get: (id) => this.#boundGet(binding, id),
      put: (value) => this.#boundPut(binding, value),
      remove: (id) => this.#boundRemove(binding, id),
      list: (options) => this.#boundList(binding, options)
    }
  }
  /** Perform transaction-bound query work through its authentic original scope. */
  #boundQuery = (
    binding: IEntityRepositoryBinding
  ): ReturnType<IEntityTransactionScope<TDomain, TIndexes, TAugmentMethods>['query']> =>
    this.#queryFor<undefined>(binding.scope)
  /** Perform transaction-bound get work through its authentic original scope. */
  #boundGet = (
    binding: IEntityRepositoryBinding,
    id: IStorageKey
  ): ReturnType<IEntityTransactionScope<TDomain, TIndexes, TAugmentMethods>['get']> =>
    runTransactionOperation(binding.scope, async (current) => {
      this.#backend.assertScope(current)
      const context = readTransactionOperationContext(current)
      assertStorageKey(id, this.#store.backend)
      const runtime = entityRuntime(current)
      const raw =
        (await current.getRecord(composeRepositoryKey(this.#name, id))) ??
        (await current.getRecord(composeStructuredKey(this.#name, id)))
      return raw === undefined
        ? undefined
        : this.#materializeForRead(
            id,
            await this.#decodeEnvelope(raw, context, runtime),
            context,
            runtime
          )
    })
  /** Perform transaction-bound put work through its authentic original scope. */
  #boundPut = (
    binding: IEntityRepositoryBinding,
    value: TDomain
  ): ReturnType<IEntityTransactionScope<TDomain, TIndexes, TAugmentMethods>['put']> =>
    runTransactionOperation(binding.scope, async (current) => {
      this.#backend.assertScope(current)
      const context = readTransactionOperationContext(current)
      const runtime = entityRuntime(current)
      const prepared = await this.#toEnvelope(value, context, runtime)
      const id = idOf(this.#name, this.#keyProp, prepared.domain, this.#store.backend)
      /** Query patches cannot move a physical record or overwrite another entity identity. */
      if (
        binding.expectedIdentity !== undefined &&
        compareStorageKeys(id, binding.expectedIdentity) !== 0
      )
        throw new StorageError(StorageErrorCode.invalidConfig, {
          backend: this.#store.backend,
          cause: new TypeError(EntityText.queryIdentityChanged)
        })
      const raw = await this.#encodeEnvelope(prepared.envelope, context, runtime)
      /** A historical repository handle is usable only after this native snapshot confirms it. */
      const handle =
        this.#readyHandle !== undefined && (await current.isRecordIndexReady?.(this.#readyHandle))
          ? this.#readyHandle
          : undefined
      if (handle !== undefined && current.putIndexedRecord !== undefined)
        await current.putIndexedRecord(
          raw,
          composeRepositoryKey(this.#name, id),
          handle,
          projectEntityIndexes(this.#config.indexes, prepared.domain, this.#store.backend),
          { conflictPolicy: 'replace' }
        )
      else
        await current.putRecord(raw, composeRepositoryKey(this.#name, id), {
          conflictPolicy: 'replace'
        })
      await current.deleteRecord(composeStructuredKey(this.#name, id))
      binding.activeChanges?.deref()!.set(encodeFlatStorageKey(id), {
        id,
        projection: this.#projectUniqueWrite(prepared.domain)
      })
      return id
    })
  /** Perform transaction-bound remove work through its authentic original scope. */
  #boundRemove = (
    binding: IEntityRepositoryBinding,
    id: IStorageKey
  ): ReturnType<IEntityTransactionScope<TDomain, TIndexes, TAugmentMethods>['remove']> =>
    runTransactionOperation(binding.scope, async (current) => {
      this.#backend.assertScope(current)
      assertStorageKey(id, this.#store.backend)
      await current.deleteRecord(composeRepositoryKey(this.#name, id))
      await current.deleteRecord(composeStructuredKey(this.#name, id))
      binding.activeChanges?.deref()!.set(encodeFlatStorageKey(id), { id, projection: undefined })
    })
  /** Perform transaction-bound list work through its authentic original scope. */
  #boundList = (
    binding: IEntityRepositoryBinding,
    options?: IListSnapshot<TDomain> | IIndexedListOptions<TDomain, TIndexes>
  ): ReturnType<IEntityTransactionScope<TDomain, TIndexes, TAugmentMethods>['list']> =>
    runTransactionOperation(binding.scope, async (current) => {
      this.#backend.assertScope(current)
      const context = readTransactionOperationContext(current)
      /** Metadata probes never build indexes or poison this transaction on a stale generation. */
      const handle =
        this.#readyHandle !== undefined && (await current.isRecordIndexReady?.(this.#readyHandle))
          ? this.#readyHandle
          : undefined
      const view: IRepositoryReadView = {
        runtime: entityRuntime(current),
        readyHandle: handle,
        getRecord: (key) => current.getRecord(key),
        iterateRecords: (range) => current.iterateRecords(range),
        ...(current.iterateRecordIndex === undefined
          ? {}
          : { iterateRecordIndex: (query) => current.iterateRecordIndex!(query) })
      }
      const indexed = this.#snapshotIndexedListOptions(options)
      const normalized = indexed?.options ?? this.#normalizeListOptions(options)
      const counter = this.#queryStages === undefined ? undefined : { readCount: 0 }
      const onRead =
        counter === undefined
          ? undefined
          : () => {
              counter.readCount++
            }
      const query =
        indexed === undefined
          ? this.#listQuery(normalized, context, entityRuntime(current), view, onRead)
          : this.#createIndexQuery(indexed, context, view, onRead)
      return this.#observeQueryRead(
        () => query.all(context),
        {
          hasWhere: false,
          hasOrder: (normalized?.orderBy ?? this.#defaultOrderBy) !== undefined,
          hasLimit: normalized?.limit !== undefined
        },
        { index: indexed?.index },
        current,
        () => counter,
        (values) => values.length
      )
    })

  /** Publish the original repository methods without exposing its internal state. */
  #createApi = (): IRepository<TDomain, TIndexes, TChangeFeed, TAugmentMethods> => ({
    query: this.#apiQuery,
    get: this.#apiGet,
    put: this.#apiPut,
    remove: this.#apiRemove,
    list: this.#apiList,
    stream: this.#apiStream,
    findBy: this.#apiFindBy,
    migrate: this.#apiMigrate,
    in: this.#apiIn,
    lockKey: this.#apiLockKey,
    batch: this.#apiBatch
  })
  /** Perform the public query operation using this repository state. */
  #apiQuery: IRepository<TDomain, TIndexes, TChangeFeed, TAugmentMethods>['query'] = () =>
    this.#queryFor<IOperationContext>() as ReturnType<
      IRepository<TDomain, TIndexes, TChangeFeed, TAugmentMethods>['query']
    >
  /** Perform the public get operation using this repository state. */
  #apiGet: IRepository<TDomain, TIndexes, TChangeFeed, TAugmentMethods>['get'] = async (
    id,
    ctx
  ) => {
    const context = snapshotOperationContext(ctx)
    const runtime = createStorageOperationRuntime()
    assertStorageKey(id, this.#store.backend, `entity "${this.#name}" id`)
    return this.#materializeForRead(
      id,
      await this.#readEnvelope(id, context, runtime),
      context,
      runtime
    )
  }
  /** Perform the public put operation using this repository state. */
  #apiPut: IRepository<TDomain, TIndexes, TChangeFeed, TAugmentMethods>['put'] = async (
    value,
    ctx
  ) => {
    if (this.#recordStore !== undefined)
      return this.#recordStore.transaction((scope) => this.#bindRepository(scope).put(value), ctx)
    if (this.#uniqueDefinitions.length !== 0 && getBackendValueCommit(this.#store) === undefined)
      throw new StorageContractError(StorageContractErrorCode.unsupported, {
        backend: this.#store.backend
      })
    const context = snapshotOperationContext(ctx)
    const runtime = createStorageOperationRuntime()
    const prepared = await this.#toEnvelope(value, context, runtime)
    const id = idOf(this.#name, this.#keyProp, prepared.domain, this.#store.backend)
    if (this.#uniqueDefinitions.length > 0)
      await this.#writeUniqueValue(id, prepared.domain, prepared.envelope, context)
    else
      await this.#writeEnvelopeAt(
        { flatKey: composeFlatKey(this.#name, id) },
        prepared.envelope,
        context,
        runtime
      )
    return id
  }
  /** Perform the public remove operation using this repository state. */
  #apiRemove: IRepository<TDomain, TIndexes, TChangeFeed, TAugmentMethods>['remove'] = async (
    id,
    ctx
  ) => {
    if (this.#recordStore !== undefined)
      return this.#recordStore.transaction((scope) => this.#bindRepository(scope).remove(id), ctx)
    assertStorageKey(id, this.#store.backend)
    await this.#store.remove(composeFlatKey(this.#name, id), ctx)
  }
  /** Perform the public list operation using this repository state. */
  #apiList: IRepository<TDomain, TIndexes, TChangeFeed, TAugmentMethods>['list'] = async (
    options,
    ctx
  ) => {
    const indexed = this.#snapshotIndexedListOptions(options)
    const normalized = indexed?.options ?? this.#normalizeListOptions(options)
    const context = snapshotOperationContext(ctx)
    const counter = this.#queryStages === undefined ? undefined : { readCount: 0 }
    const onRead =
      counter === undefined
        ? undefined
        : () => {
            counter.readCount++
          }
    const query =
      indexed === undefined
        ? this.#listQuery(normalized, context, createStorageOperationRuntime(), undefined, onRead)
        : this.#createIndexQuery(indexed, context, undefined, onRead)
    return this.#observeQueryRead(
      () => query.all(context),
      {
        hasWhere: false,
        hasOrder: (normalized?.orderBy ?? this.#defaultOrderBy) !== undefined,
        hasLimit: normalized?.limit !== undefined
      },
      { index: indexed?.index },
      undefined,
      () => counter,
      (values) => values.length
    )
  }
  /** Perform the public stream operation using this repository state. */
  #apiStream: IRepository<TDomain, TIndexes, TChangeFeed, TAugmentMethods>['stream'] = (
    options,
    ctx
  ) => {
    const indexed = this.#snapshotIndexedListOptions(options)
    const normalized = indexed?.options ?? this.#normalizeListOptions(options)
    const context = snapshotOperationContext(ctx)
    const counter = this.#queryStages === undefined ? undefined : { readCount: 0 }
    const onRead =
      counter === undefined
        ? undefined
        : () => {
            counter.readCount++
          }
    const query =
      indexed === undefined
        ? this.#listQuery(normalized, context, createStorageOperationRuntime(), undefined, onRead)
        : this.#createIndexQuery(indexed, context, undefined, onRead)
    return this.#observeQueryStream(
      query.stream(context),
      {
        hasWhere: false,
        hasOrder: (normalized?.orderBy ?? this.#defaultOrderBy) !== undefined,
        hasLimit: normalized?.limit !== undefined
      },
      { index: indexed?.index },
      counter
    )
  }
  /** Perform the public findBy operation using this repository state. */
  #apiFindBy: IRepository<TDomain, TIndexes, TChangeFeed, TAugmentMethods>['findBy'] = async (
    index,
    key,
    ctx
  ) => {
    assertStorageKey(key, this.#store.backend, `entity "${this.#name}" index query`)
    const context = snapshotOperationContext(ctx)
    const snapshot = this.#createIndexedListSnapshot(index, { lower: key, upper: key }, undefined)
    let matched = 0
    const runtime = createStorageOperationRuntime()
    /** One source scan caps its diagnostic count while the original heap retains one result. */
    const source = createRecordQuery<IMatch<TDomain>>({
      asyncDisposeKey,
      pushdown: { source: EntityState.querySource, operations: [], operators: [] },
      execute: () =>
        entityIterator(
          (async function* (
            repositoryOwner: EntityRepositoryOwner<
              TDomain,
              TStored,
              TIndexes,
              TAugmentMethods,
              TChangeFeed
            >
          ) {
            for await (const row of repositoryOwner.#indexRows(
              snapshot,
              context,
              undefined,
              false
            )) {
              if (matched < 2) matched++
              yield row
            }
          })(this),
          runtime
        )
    })
    const [best] = await source
      .orderByComparator((left, right) => {
        let compared = 0
        if (this.#defaultOrderBy !== undefined) {
          try {
            /** A user comparator remains an ordinary function invocation. */
            const compare = this.#defaultOrderBy
            compared = compare(left.value, right.value)
            if (!Number.isFinite(compared)) {
              void Promise.resolve(compared).catch(runtime.reporter)
              throw new TypeError(StorageErrorText.entityComparatorInvalid)
            }
          } catch (cause) {
            throw new StorageError(StorageErrorCode.extensionFailed, {
              backend: this.#store.backend,
              cause,
              operation: StorageOperation.entityOrderBy,
              extensionStage: 'comparator'
            })
          }
        }
        return (
          compared ||
          compareStorageKeys(left.key, right.key) ||
          compareStorageKeys(left.id, right.id)
        )
      })
      .limit(1)
      .all(context)
    const definition = this.#config.indexes[index]?.definition
    if (definition !== undefined && !definition.unique && matched === 2)
      this.#emitDiagnostic(
        EntityText.storageWebEntityFindByOnNonUniqueIndexReturnedTheFirst(this.#name, index)
      )
    return best?.value
  }
  /** Perform the public migrate operation using this repository state. */
  #apiMigrate: IRepository<TDomain, TIndexes, TChangeFeed, TAugmentMethods>['migrate'] = async (
    options: IMigrateOptions<TDomain> = {},
    ctx
  ) => {
    /** Migration progress belongs to this run and its existing checkpoint. */
    const migration = {} as IEntityMigrationContext<TDomain>
    if (
      this.#recordStore === undefined &&
      this.#uniqueDefinitions.length !== 0 &&
      getBackendValueCommit(this.#store) === undefined
    )
      throw new StorageContractError(StorageContractErrorCode.unsupported, {
        backend: this.#store.backend
      })
    migration.context = snapshotOperationContext(ctx)
    migration.runtime = createStorageOperationRuntime()
    ;({ batchSize: migration.batchSize, onInvalid: migration.onInvalid } =
      this.#normalizeMigrateOptions(options))
    migration.migrationMetadata = this.#recordStore?.metadata
    migration.checkpointKey = repositoryMigrationKey(this.#name)
    migration.checkpoint = (await migration.migrationMetadata?.get(
      migration.checkpointKey,
      migration.context
    )) as IEntityMigrationCheckpoint | undefined
    migration.checkpointMatches =
      migration.checkpoint?.status === StorageMigrationStatus.running &&
      migration.checkpoint.version === this.#version &&
      migration.checkpoint.schemaFingerprint === this.#migrationFingerprint
    migration.scanned = migration.checkpointMatches ? migration.checkpoint!.scanned : 0
    migration.migrated = migration.checkpointMatches ? migration.checkpoint!.migrated : 0
    migration.eligible = migration.checkpointMatches ? migration.checkpoint!.eligible : 0
    migration.alreadyCurrent = migration.checkpointMatches
      ? migration.checkpoint!.alreadyCurrent
      : 0
    migration.skipped = migration.checkpointMatches ? migration.checkpoint!.skipped : 0
    migration.conflicted = migration.checkpointMatches ? migration.checkpoint!.conflicted : 0
    migration.lastPhysicalKey = migration.checkpointMatches
      ? migration.checkpoint!.lastPhysicalKey
      : undefined
    migration.phase = migration.checkpointMatches
      ? (migration.checkpoint!.phase ?? StorageMigrationPhase.legacy)
      : StorageMigrationPhase.v2
    migration.batch = []
    if (this.#recordStore) await this.#scanMigrationRecords(migration, this.#recordStore)
    else await this.#scanMigrationValues(migration)
    await this.#persistMigrationBatch(migration)
    await this.#writeMigrationCheckpoint(migration, {
      status: StorageMigrationStatus.complete,
      phase: migration.phase,
      version: this.#version,
      schemaFingerprint: this.#migrationFingerprint,
      lastPhysicalKey: migration.lastPhysicalKey,
      scanned: migration.scanned,
      eligible: migration.eligible,
      migrated: migration.migrated,
      skipped: migration.skipped,
      alreadyCurrent: migration.alreadyCurrent,
      conflicted: migration.conflicted
    })
    return {
      scanned: migration.scanned,
      eligible: migration.eligible,
      migrated: migration.migrated,
      skipped: migration.skipped,
      alreadyCurrent: migration.alreadyCurrent,
      conflicted: migration.conflicted
    }
  }
  /** Scan canonical and legacy record phases without changing checkpoint order. */
  #scanMigrationRecords = async (
    migration: IEntityMigrationContext<TDomain>,
    recordStore: IEntityRecordMethods
  ): Promise<void> => {
    const phases =
      migration.phase === StorageMigrationPhase.v2
        ? [StorageMigrationPhase.v2, StorageMigrationPhase.legacy]
        : [StorageMigrationPhase.legacy]
    for (const scanPhase of phases) {
      migration.phase = scanPhase
      if (
        scanPhase !==
        (migration.checkpointMatches
          ? (migration.checkpoint!.phase ?? StorageMigrationPhase.legacy)
          : StorageMigrationPhase.v2)
      )
        migration.lastPhysicalKey = undefined
      const entityRange = repositoryEntityRange(this.#name)
      const migrationRange =
        scanPhase === StorageMigrationPhase.v2
          ? migration.lastPhysicalKey
            ? { ...entityRange, lower: migration.lastPhysicalKey, lowerOpen: true }
            : entityRange
          : migration.lastPhysicalKey
            ? { lower: migration.lastPhysicalKey, lowerOpen: true }
            : undefined
      for await (const [physicalKey, raw] of recordStore.iterateRecords(
        migrationRange,
        migration.context
      )) {
        migration.lastPhysicalKey = physicalKey
        const v2RecordId = decodeRepositoryKey(this.#name, physicalKey)
        const legacy =
          v2RecordId === undefined &&
          Array.isArray(physicalKey) &&
          physicalKey.length === 2 &&
          physicalKey[0] === this.#name
        const recordId = v2RecordId ?? (legacy ? (physicalKey[1] as IStorageKey) : undefined)
        if (scanPhase === StorageMigrationPhase.v2 && v2RecordId === undefined) continue
        if (scanPhase === StorageMigrationPhase.legacy && !legacy) continue
        if (recordId === undefined) continue
        migration.scanned += 1
        let envelope: IEnvelope
        try {
          envelope = await this.#decodeEnvelope(raw, migration.context, migration.runtime)
          /** Eligible records are materialized only under the commit transaction's read set. */
          const value =
            envelope.version >= this.#version
              ? await this.#materialize(envelope, migration.context, migration.runtime)
              : undefined
          if (envelope.version >= this.#version && value === undefined) continue
          if (envelope.version >= this.#version) {
            migration.alreadyCurrent += 1
            // A current-version legacy envelope still requires physical relocation before
            // migration completion can prove that entity queries may stop scanning legacy.
            if (legacy)
              migration.batch.push({
                physicalKey,
                raw,
                id: recordId,
                legacy,
                migrationRequired: false,
                value
              })
            continue
          }
          migration.eligible += 1
          migration.batch.push({
            physicalKey,
            raw,
            id: recordId,
            legacy,
            migrationRequired: true,
            value
          })
        } catch (cause) {
          const issue: IInvalidRecordIssue<TDomain> = {
            key: recordId,
            raw,
            stage: (cause as Partial<IStageFailure>).stage ?? StorageRecordStage.decode,
            cause
          }
          const action = this.#invokeInvalidHandler(migration.onInvalid, issue)
          if (action === StorageInvalidRecordAction.throw) this.#throwInvalid(issue)
          migration.skipped += 1
        }
        if (migration.batch.length >= migration.batchSize)
          await this.#persistMigrationBatch(migration)
      }
      if (scanPhase === StorageMigrationPhase.v2 && phases.length > 1) {
        migration.phase = StorageMigrationPhase.legacy
        migration.lastPhysicalKey = undefined
        await this.#writeMigrationCheckpoint(migration, {
          status: StorageMigrationStatus.running,
          phase: migration.phase,
          version: this.#version,
          schemaFingerprint: this.#migrationFingerprint,
          scanned: migration.scanned,
          eligible: migration.eligible,
          migrated: migration.migrated,
          skipped: migration.skipped,
          alreadyCurrent: migration.alreadyCurrent,
          conflicted: migration.conflicted
        })
      }
    }
  }
  /** Scan text records using the existing canonical ordered key index. */
  #scanMigrationValues = async (migration: IEntityMigrationContext<TDomain>): Promise<void> => {
    const prefix = flatKeyPrefix(this.#name)
    /** Migration traverses the same canonical ordered structure without a second sorting path. */
    const keys = createOrderedRecordIndex<{
      readonly rawKey: string
      readonly id: IStorageKey
    }>()
    for (const rawKey of await this.#store.keys(migration.context)) {
      if (!rawKey.startsWith(prefix)) continue
      const id = decodeFlatStorageKey(rawKey.slice(prefix.length))
      if (id !== undefined)
        keys.set(encodeOrderedStorageKey(id, this.#store.backend), { rawKey, id })
    }
    for (const {
      value: { rawKey, id }
    } of keys.range()) {
      const raw = await this.#store.get(rawKey, migration.context)
      if (raw === null) continue
      migration.scanned += 1
      try {
        const envelope = await this.#decodeEnvelope(raw, migration.context, migration.runtime)
        const value = await this.#materialize(envelope, migration.context, migration.runtime)
        if (value === undefined) continue
        if (envelope.version >= this.#version) {
          migration.alreadyCurrent += 1
          continue
        }
        migration.eligible += 1
        migration.batch.push({
          physicalKey: rawKey,
          raw,
          id,
          legacy: false,
          migrationRequired: true,
          value
        })
      } catch (cause) {
        const issue: IInvalidRecordIssue<TDomain> = {
          key: id,
          raw,
          stage: (cause as Partial<IStageFailure>).stage ?? StorageRecordStage.decode,
          cause
        }
        const action = this.#invokeInvalidHandler(migration.onInvalid, issue)
        if (action === StorageInvalidRecordAction.throw) this.#throwInvalid(issue)
        migration.skipped += 1
      }
      if (migration.batch.length >= migration.batchSize)
        await this.#persistMigrationBatch(migration)
    }
  }
  /** Apply a prepared batch against the current native transaction snapshot. */
  #executeMigrationBatch = async (
    migration: IEntityMigrationContext<TDomain>,
    indexedHandle: IRecordIndexHandle | undefined,
    tx: ITransactionScope,
    indexed: boolean
  ) => {
    /** Publish counts only after this transaction commits, including invalid-record policy. */
    const transactionContext = readTransactionOperationContext(tx)
    const currentIndexed =
      indexed &&
      indexedHandle !== undefined &&
      (await tx.isRecordIndexReady?.(indexedHandle)) === true
    const counts = { migrated: 0, alreadyCurrent: 0, skipped: 0, invalidEligible: 0 }
    /** Written rows supply prepared projections; unchanged rows use the transactional view. */
    const uniqueChanges = new Map<string, IEntityUniqueMutation>()
    for (const entry of migration.batch) {
      /** Every write is derived from a read tracked by this transaction. */
      const currentRaw = await tx.getRecord(entry.physicalKey)
      if (currentRaw === undefined) continue
      if (entry.legacy) {
        /** An authoritative current-layout record wins over an obsolete legacy copy. */
        const existingTarget = await tx.getRecord(composeRepositoryKey(this.#name, entry.id))
        if (existingTarget !== undefined) {
          await tx.deleteRecord(entry.physicalKey)
          continue
        }
      }
      /** Keep decoding/migration failures under the existing per-record invalid policy. */
      let currentValue: TDomain | undefined
      try {
        /** A concurrent current-version update must not be rewritten by this migration. */
        const currentEnvelope = await this.#decodeEnvelope(
          currentRaw,
          transactionContext,
          migration.runtime
        )
        if (!entry.legacy && currentEnvelope.version >= this.#version) {
          counts.alreadyCurrent += 1
          continue
        }
        currentValue = await this.#materialize(
          currentEnvelope,
          transactionContext,
          migration.runtime
        )
      } catch (cause) {
        /** The issue reports the actual transactional value, not stale scan data. */
        const issue: IInvalidRecordIssue<TDomain> = {
          key: entry.id,
          raw: currentRaw,
          stage: (cause as Partial<IStageFailure>).stage ?? StorageRecordStage.decode,
          cause
        }
        if (
          this.#invokeInvalidHandler(migration.onInvalid, issue) ===
          StorageInvalidRecordAction.throw
        )
          this.#throwInvalid(issue)
        counts.skipped += 1
        if (entry.migrationRequired) counts.invalidEligible += 1
        continue
      }
      if (currentValue === undefined) {
        if (entry.migrationRequired) counts.invalidEligible += 1
        continue
      }
      /** Preparation retains the existing write-side schema/codec validation boundary. */
      const prepared = await this.#toEnvelope(currentValue, transactionContext, migration.runtime)
      /** Native and fallback paths write the same current envelope. */
      const raw = await this.#encodeEnvelope(
        prepared.envelope,
        transactionContext,
        migration.runtime
      )
      if (currentIndexed && indexedHandle !== undefined && tx.putIndexedRecord !== undefined)
        await tx.putIndexedRecord(
          raw,
          composeRepositoryKey(this.#name, entry.id),
          indexedHandle,
          projectEntityIndexes(this.#config.indexes, prepared.domain, this.#store.backend),
          { conflictPolicy: 'replace' }
        )
      else
        await tx.putRecord(raw, composeRepositoryKey(this.#name, entry.id), {
          conflictPolicy: 'replace'
        })
      if (entry.legacy) await tx.deleteRecord(entry.physicalKey)
      if (!currentIndexed && this.#uniqueDefinitions.length > 0)
        uniqueChanges.set(encodeFlatStorageKey(entry.id), {
          id: entry.id,
          projection: this.#projectUniqueWrite(prepared.domain)
        })
      if (entry.migrationRequired) counts.migrated += 1
    }
    if (!currentIndexed)
      await this.#validateUniqueRecordCommit(
        tx,
        uniqueChanges,
        transactionContext,
        migration.runtime
      )
    return counts
  }
  /** Re-read one conflicted row in the original retry transaction. */
  #retryMigrationEntry = async (
    migration: IEntityMigrationContext<TDomain>,
    indexedHandle: IRecordIndexHandle | undefined,
    entry: IEntityMigrationContext<TDomain>['batch'][number],
    tx: ITransactionScope
  ) => {
    const retryContext = readTransactionOperationContext(tx)
    const currentIndexed =
      indexedHandle !== undefined && (await tx.isRecordIndexReady?.(indexedHandle)) === true
    const targetRaw = await tx.getRecord(composeRepositoryKey(this.#name, entry.id))
    if (targetRaw !== undefined) {
      const targetEnvelope = await this.#decodeEnvelope(targetRaw, retryContext, migration.runtime)
      if (targetEnvelope.version >= this.#version) {
        if (entry.legacy) await tx.deleteRecord(entry.physicalKey)
        return 'alreadyCurrent' as const
      }
    }
    const currentRaw = await tx.getRecord(entry.physicalKey)
    if (currentRaw === undefined) return 'missing' as const
    const currentEnvelope = await this.#decodeEnvelope(currentRaw, retryContext, migration.runtime)
    const currentValue = await this.#materialize(currentEnvelope, retryContext, migration.runtime)
    if (currentValue === undefined) return 'missing' as const
    if (currentEnvelope.version >= this.#version) return 'alreadyCurrent' as const
    const prepared = await this.#toEnvelope(currentValue, retryContext, migration.runtime)
    const nextRaw = await this.#encodeEnvelope(prepared.envelope, retryContext, migration.runtime)
    if (currentIndexed && indexedHandle !== undefined && tx.putIndexedRecord !== undefined)
      await tx.putIndexedRecord(
        nextRaw,
        composeRepositoryKey(this.#name, entry.id),
        indexedHandle,
        projectEntityIndexes(this.#config.indexes, prepared.domain, this.#store.backend),
        { conflictPolicy: 'replace' }
      )
    else
      await tx.putRecord(nextRaw, composeRepositoryKey(this.#name, entry.id), {
        conflictPolicy: 'replace'
      })
    if (entry.legacy) await tx.deleteRecord(entry.physicalKey)
    if (!currentIndexed)
      await this.#validateUniqueRecordCommit(
        tx,
        new Map([
          [
            encodeFlatStorageKey(entry.id),
            {
              id: entry.id,
              projection: projectEntityIndexes(
                this.#uniqueIndexes,
                prepared.domain,
                this.#store.backend
              )
            }
          ]
        ]),
        retryContext,
        migration.runtime
      )
    return 'migrated' as const
  }
  /** Write the existing migration checkpoint through its native metadata owner. */
  #writeMigrationCheckpoint = async (
    migration: IEntityMigrationContext<TDomain>,
    value: unknown
  ): Promise<void> => {
    if (migration.migrationMetadata)
      await migration.migrationMetadata.set(migration.checkpointKey, value, migration.context)
  }
  /** Commit one prepared migration batch and publish its durable progress. */
  #persistMigrationBatch = async (migration: IEntityMigrationContext<TDomain>): Promise<void> => {
    if (migration.batch.length === 0) return
    if (!this.#recordStore) {
      for (const entry of migration.batch) {
        const prepared = await this.#toEnvelope(entry.value!, migration.context, migration.runtime)
        const nextKey = composeFlatKey(this.#name, entry.id)
        if (this.#uniqueDefinitions.length > 0)
          await this.#writeUniqueValue(
            entry.id,
            prepared.domain,
            prepared.envelope,
            migration.context
          )
        else
          await this.#writeEnvelopeAt(
            { flatKey: nextKey },
            prepared.envelope,
            migration.context,
            migration.runtime
          )
      }
      migration.migrated += migration.batch.length
    } else {
      let indexedStore: IEntitySecondaryMethods | undefined
      let indexedHandle: IRecordIndexHandle | undefined
      try {
        indexedStore =
          Object.keys(this.#config.indexes).length > 0 ? this.#backend.secondaryStore() : undefined
        /** Materialize the transaction's current snapshot once, not the earlier scan value. */

        if (indexedStore !== undefined) {
          indexedHandle = await indexedStore.ensureRecordIndexes(
            this.#name,
            Object.values(this.#config.indexes).map((index) => index.definition),
            migration.context
          )
          const readiness = await indexedStore.getRecordIndexReadiness(
            indexedHandle,
            migration.context
          )
          if (readiness.status !== 'complete') indexedHandle = undefined
        }
        /** One callback owns migration semantics; backend adapters only supply their scope. */
        const batchOutcome = await this.#recordStore.transaction(
          (tx) =>
            this.#executeMigrationBatch(migration, indexedHandle, tx, indexedHandle !== undefined),
          migration.context
        )
        migration.migrated += batchOutcome.migrated
        migration.alreadyCurrent += batchOutcome.alreadyCurrent
        migration.skipped += batchOutcome.skipped
        migration.eligible -= batchOutcome.invalidEligible
      } catch (cause) {
        if (
          isStorageContractError(cause) &&
          cause.code === StorageContractErrorCode.writeConflict
        ) {
          for (const entry of migration.batch) {
            try {
              const retryOutcome = await this.#recordStore.transaction(
                (tx) => this.#retryMigrationEntry(migration, indexedHandle, entry, tx),
                migration.context
              )
              if (retryOutcome === 'migrated') migration.migrated += 1
              if (retryOutcome === 'alreadyCurrent') migration.alreadyCurrent += 1
            } catch (retryCause) {
              if (
                isStorageContractError(retryCause) &&
                retryCause.code === StorageContractErrorCode.writeConflict
              ) {
                migration.conflicted += 1
                continue
              }
              throw normalizeError(
                retryCause,
                this.#store.backend,
                StorageErrorCode.transactionFailed,
                'entity.migrate'
              )
            }
          }
        } else {
          throw normalizeError(
            cause,
            this.#store.backend,
            StorageErrorCode.transactionFailed,
            'entity.migrate'
          )
        }
      }
    }
    await this.#writeMigrationCheckpoint(migration, {
      status: StorageMigrationStatus.running,
      phase: migration.phase,
      version: this.#version,
      schemaFingerprint: this.#migrationFingerprint,
      lastPhysicalKey: migration.lastPhysicalKey,
      scanned: migration.scanned,
      eligible: migration.eligible,
      migrated: migration.migrated,
      skipped: migration.skipped,
      alreadyCurrent: migration.alreadyCurrent,
      conflicted: migration.conflicted
    })
    migration.batch.length = 0
  }
  /** Perform the public in operation using this repository state. */
  #apiIn: IRepository<TDomain, TIndexes, TChangeFeed, TAugmentMethods>['in'] = (scope) =>
    this.#bindRepository(scope)
  /** Perform the public lockKey operation using this repository state. */
  #apiLockKey: IRepository<TDomain, TIndexes, TChangeFeed, TAugmentMethods>['lockKey'] = (id) => {
    assertStorageKey(id, this.#store.backend)
    return this.#records
      ? lockKey.record(composeRepositoryKey(this.#name, id))
      : lockKey.text(composeFlatKey(this.#name, id))
  }
  /** Perform the public batch operation using this repository state. */
  #apiBatch: IRepository<TDomain, TIndexes, TChangeFeed, TAugmentMethods>['batch'] = (run, ctx) => {
    if (typeof run !== 'function')
      return Promise.reject(
        new StorageError(StorageErrorCode.invalidConfig, {
          backend: this.#store.backend,
          cause: new TypeError(EntityText.batchCallbackMustBeAFunction)
        })
      )
    if (this.#recordStore === undefined)
      return Promise.reject(
        new StorageContractError(StorageContractErrorCode.unsupported, {
          backend: this.#store.backend
        })
      )
    return this.#recordStore.transaction((scope) => run(this.#bindRepository(scope)), ctx)
  }

  /** Read canonical and legacy physical rows with the existing deduplication policy. */
  async *#scanEntityCandidates(
    scan: IEntityScanContext<TDomain>
  ): AsyncGenerator<IEntityScanCandidate, void, unknown> {
    if (this.#recordStore !== undefined) {
      const canonicalIds = new Set<string>()
      const iterate =
        scan.readView?.iterateRecords ??
        ((range) => this.#recordStore!.iterateRecords(range, scan.ctx))
      try {
        for (const range of [repositoryEntityRange(this.#name), undefined]) {
          for await (const [physical, raw] of iterate(range)) {
            const canonical = decodeRepositoryKey(this.#name, physical)
            const legacy =
              Array.isArray(physical) && physical.length === 2 && physical[0] === this.#name
                ? (physical[1] as IStorageKey)
                : undefined
            const id = canonical ?? legacy
            if (id === undefined || !isStorageKeyInRange(id, scan.options?.range)) continue
            if (range === undefined && canonical !== undefined) continue
            scan.onRead?.()
            const identity = encodeFlatStorageKey(id)
            if (range === undefined && canonicalIds.has(identity)) continue
            if (canonical !== undefined) canonicalIds.add(identity)
            yield { id, physical, raw }
          }
        }
      } finally {
        canonicalIds.clear()
      }
    } else {
      this.#emitDiagnostic(EntityText.valueScan(this.#name))
      const prefix = flatKeyPrefix(this.#name)
      for (const physical of scan.readView?.keys === undefined
        ? await this.#store.keys(scan.ctx)
        : await scan.readView.keys()) {
        if (!physical.startsWith(prefix)) continue
        const id = decodeFlatStorageKey(physical.slice(prefix.length))
        if (id !== undefined && isStorageKeyInRange(id, scan.options?.range)) {
          scan.onRead?.()
          yield { id, physical, raw: undefined }
        }
      }
    }
  }
  /** Apply canonical key ordering only when the selected source requires it. */
  async *#orderedEntityCandidates(
    scan: IEntityScanContext<TDomain>
  ): AsyncGenerator<IEntityScanCandidate, void, unknown> {
    if (!scan.applyOrdering) {
      yield* this.#scanEntityCandidates(scan)
      return
    }
    for await (const candidate of this.#scanEntityCandidates(scan))
      scan.candidates.set(encodeOrderedStorageKey(candidate.id, this.#store.backend), candidate)
    for (
      let item = scan.options?.direction === 'prev' ? scan.candidates.last : scan.candidates.first;
      item !== undefined;
      item = scan.options?.direction === 'prev' ? item.previous : item.next
    )
      yield item.value
  }
  /** Advance the same registered source through initialization, selection and ordered rows. */
  #advanceScopedEntitySource = async (
    sourceContext: IEntityScopedSourceContext<TDomain>,
    next: () => Promise<IteratorResult<[IStorageKey, unknown]>>,
    currentScope: ITransactionScope
  ): Promise<IteratorResult<readonly [IStorageKey, TDomain]>> => {
    const current = currentScope as ITransactionScope
    this.#backend.assertScope(current)
    const context = readTransactionOperationContext(current)
    const runtime = entityRuntime(current)
    const index =
      sourceContext.selection.index === undefined
        ? undefined
        : this.#config.indexes[sourceContext.selection.index]
    if (!sourceContext.initialized) {
      sourceContext.initialized = true
      const handle =
        this.#readyHandle !== undefined &&
        index !== undefined &&
        (await current.isRecordIndexReady?.(this.#readyHandle))
          ? this.#readyHandle
          : undefined
      if (handle !== undefined && current.iterateRecordIndex !== undefined)
        sourceContext.cursor = current.iterateRecordIndex({
          handle,
          index: sourceContext.selection.index!,
          range: sourceContext.selection.range
        })
    }
    if (!sourceContext.prepared) {
      while (true) {
        const result =
          sourceContext.cursor === undefined
            ? await next()
            : await nextTransactionIterator(current, sourceContext.cursor)
        if (result.done) break
        const [physical, raw] = result.value
        const canonical = decodeRepositoryKey(this.#name, physical)
        const legacy =
          Array.isArray(physical) && physical.length === 2 && physical[0] === this.#name
            ? (physical[1] as IStorageKey)
            : undefined
        const physicalId = canonical ?? legacy
        if (physicalId === undefined) continue
        sourceContext.onRead?.()
        if (
          legacy !== undefined &&
          canonical === undefined &&
          (await current.getRecord(composeRepositoryKey(this.#name, legacy))) !== undefined
        )
          continue
        let value: TDomain | undefined
        try {
          value = await this.#materialize(
            await this.#decodeEnvelope(raw, context, runtime),
            context,
            runtime
          )
        } catch (cause) {
          const issue: IInvalidRecordIssue<TDomain> = {
            key: physicalId,
            raw,
            stage: (cause as Partial<IStageFailure>).stage ?? StorageRecordStage.validate,
            cause
          }
          if (
            this.#invalidAction(issue, { onInvalid: sourceContext.selection.onInvalid }) ===
            StorageInvalidRecordAction.throw
          )
            this.#throwInvalid(issue)
          this.#emitDiagnostic(EntityText.invalidRecord(this.#name, physicalId))
        }
        if (value === undefined) continue
        const id = idOf(this.#name, this.#keyProp, value, this.#store.backend)
        const identity = encodeFlatStorageKey(id)
        if (sourceContext.seen.has(identity)) continue
        let ordering: IStorageKey = [id]
        let encodedOrdering: Uint8Array | undefined
        if (index !== undefined) {
          let projection: ReturnType<typeof index.project>
          try {
            projection = index.project(value, this.#store.backend)
          } catch (cause) {
            const issue: IInvalidRecordIssue<TDomain> = {
              key: physicalId,
              raw,
              stage: StorageRecordStage.validate,
              cause
            }
            if (
              this.#invalidAction(issue, { onInvalid: sourceContext.selection.onInvalid }) ===
              StorageInvalidRecordAction.throw
            )
              this.#throwInvalid(issue)
            this.#emitDiagnostic(EntityText.invalidRecord(this.#name, physicalId))
            continue
          }
          const first = minimumProjectedIndexKey(projection, sourceContext.selection.range)
          if (first === undefined) continue
          ordering = [first, id]
          if (sourceContext.orderedSource) encodedOrdering = this.#encodeIndexOrder(first, id)
        } else if (!isStorageKeyInRange(id, sourceContext.selection.range)) continue
        if (sourceContext.seen instanceof Map) sourceContext.seen.set(identity, physicalId)
        else sourceContext.seen.add(identity)
        if (sourceContext.accepts !== undefined && !sourceContext.accepts(value)) continue
        if (!sourceContext.orderedSource) return { done: false, value: [ordering, value] as const }
        sourceContext.rows.set(
          encodedOrdering ?? encodeOrderedStorageKey(id, this.#store.backend),
          [ordering, value]
        )
      }
      sourceContext.prepared = true
      sourceContext.item = sourceContext.rows.first
    }
    if (sourceContext.item === undefined) return { done: true, value: undefined }
    const value = sourceContext.item.value
    sourceContext.item = sourceContext.item.next
    return { done: false, value }
  }
  /** Release the native index cursor before clearing source-owned ordering and deduplication. */
  #closeScopedEntitySource = async (
    sourceContext: IEntityScopedSourceContext<TDomain>
  ): Promise<void> => {
    try {
      await sourceContext.cursor?.dispose()
    } finally {
      sourceContext.rows.clear()
      if (sourceContext.physicalIds === undefined) sourceContext.seen.clear()
    }
  }
  /** Observe one advance using the actual transaction stages and original result. */
  #advanceObservedEntityQuery = async <R>(
    observation: IEntityQueryObservation<TDomain, R>,
    next: () => Promise<IteratorResult<R>>,
    current?: ITransactionScope
  ): Promise<IteratorResult<R>> => {
    const stages =
      current === undefined ? this.#queryStages : this.#queryStages?.forTransaction(current)
    const started = stages === undefined ? 0 : systemScheduler.now()
    if (stages?.beforeQuery !== undefined)
      observeEntity(stages, () =>
        stages.beforeQuery!(this.#name, observation.selection.index, observation.plan)
      )
    try {
      const value = await next()
      if (!value.done) observation.returnedCount++
      if (stages !== undefined) observation.elapsedMs += systemScheduler.now() - started
      if (stages?.afterQuery !== undefined)
        observeEntity(stages, () =>
          stages.afterQuery!(this.#name, observation.selection.index, {
            readCount: observation.counter?.readCount ?? 0,
            returnedCount: observation.returnedCount,
            elapsedMs: observation.elapsedMs,
            completed: value.done === true
          })
        )
      return value
    } catch (cause) {
      if (stages?.onQueryError !== undefined)
        observeEntity(stages, () =>
          stages.onQueryError!(
            this.#name,
            observation.selection.index,
            readStorageHookFailureCode(cause, stages.report)
          )
        )
      throw cause
    }
  }

  /** Decode one current backfill candidate under the original renewable session. */
  #prepareEntityBackfillCandidate = async (
    session: IRecordIndexBackfillSession<unknown>,
    ctx: IOperationContext | undefined,
    candidate: IRecordIndexBackfillCandidate<unknown>
  ): Promise<IRecordIndexBackfillPreparation> => {
    await session.renew(ctx)
    const runtime = createStorageOperationRuntime()
    let domain: TDomain | undefined
    try {
      if (candidate.phase === RecordIndexBackfillPhase.legacy) {
        const canonicalId = decodeRepositoryKey(this.#name, candidate.key)
        const legacyId =
          Array.isArray(candidate.key) &&
          candidate.key.length === 2 &&
          candidate.key[0] === this.#name &&
          (typeof candidate.key[1] === 'string' || Array.isArray(candidate.key[1]))
            ? (candidate.key[1] as IStorageKey)
            : undefined
        if (canonicalId === undefined && legacyId === undefined)
          return { decodedBytes: 0, outcome: 'skipped', counted: false }
        if (canonicalId !== undefined)
          return { decodedBytes: 0, outcome: 'skipped', counted: false }
        if (legacyId !== undefined) {
          const id = legacyId
          const canonicalRaw = await this.#recordStore!.getRecord(
            composeRepositoryKey(this.#name, id),
            ctx
          )
          if (canonicalRaw !== undefined)
            return { decodedBytes: 0, outcome: 'skipped', counted: false }
        }
      }
      const envelope = await this.#decodeEnvelope(candidate.raw, ctx, runtime)
      domain = await this.#materialize(envelope, ctx, runtime)
    } catch (cause) {
      this.#emitDiagnostic(
        EntityText.storageWebEntitySkippedInvalidIndexBackfillRecord(
          this.#name,
          String(candidate.key),
          String(cause)
        )
      )
      return { decodedBytes: 0, outcome: 'skipped' }
    }
    return {
      decodedBytes: safeJsonPayloadByteLength(domain),
      outcome: domain === undefined ? 'skipped' : 'indexed',
      projection:
        domain === undefined
          ? undefined
          : projectEntityIndexes(this.#config.indexes, domain, this.#store.backend)
    }
  }
  /** Select mutation rows from the same authentic transaction and physical identity table. */
  #executeEntityMutationRows = (
    mutation: IEntityQueryMutationContext<TDomain>,
    current: ITransactionScope,
    physicalIds: Map<string, IStorageKey>,
    { selection: planned, conditions }: Parameters<IRecordQuerySource['execute']>[0]
  ): IStorageIterator<readonly [IStorageKey, TDomain]> => {
    const selection = {
      ...((planned as IEntityQuerySourceSelection<TDomain> | undefined) ??
        mutation.source.selection),
      onInvalid: mutation.policy.onInvalid
    }
    const predicates = conditions.map((condition) =>
      compileStorageQueryCondition<TDomain>(condition)
    )
    return this.#scopedQuerySource(
      current,
      selection,
      mutation.onRead,
      mutation.orderedSource,
      physicalIds,
      (value) => predicates.every((predicate) => predicate(value))
    )
  }
  /** Write or remove a row only while its selected physical identity remains in the draft. */
  #acceptEntityMutationRow = async (
    mutation: IEntityQueryMutationContext<TDomain>,
    current: ITransactionScope,
    physicalIds: Map<string, IStorageKey>,
    value: unknown
  ): Promise<boolean> => {
    const id = idOf(this.#name, this.#keyProp, value as TDomain, this.#store.backend)
    const physicalId = physicalIds.get(encodeFlatStorageKey(id))
    if (physicalId === undefined)
      throw new StorageError(StorageErrorCode.invalidConfig, {
        backend: this.#store.backend,
        cause: new TypeError(EntityText.queryIdentityChanged)
      })
    /** Count only rows still present in this same draft after selection callbacks. */
    const raw =
      (await current.getRecord(composeRepositoryKey(this.#name, physicalId))) ??
      (await current.getRecord(composeStructuredKey(this.#name, physicalId)))
    if (raw === undefined) return false
    if (mutation.request.operation === RecordQueryMethod.delete)
      await this.#bindRepository(current).remove(physicalId)
    else
      await this.#bindRepository(current, physicalId).put({
        ...(value as TDomain),
        ...mutation.request.patch
      })
    return true
  }
  /** Run writes in the existing transaction operation, clearing its identity table on every exit. */
  #applyEntityQueryMutation = (
    mutation: IEntityQueryMutationContext<TDomain>,
    target: ITransactionScope
  ): Promise<number> =>
    runTransactionOperation(target, async (current) => {
      this.#backend.assertScope(current)
      /** This is the source's original seen table, not an index or a retained row cache. */
      const physicalIds = new Map<string, IStorageKey>()
      try {
        return await mutation.run({
          execute: (input) =>
            this.#executeEntityMutationRows(mutation, current, physicalIds, input),
          accept: (_key, value) =>
            this.#acceptEntityMutationRow(mutation, current, physicalIds, value)
        })
      } finally {
        physicalIds.clear()
      }
    })
}

export const createRepository = <
  TDomain,
  TStored,
  TIndexes extends Readonly<Record<string, IStorageKey>> = Readonly<Record<never, IStorageKey>>,
  TAugmentMethods extends object = {},
  TChangeFeed extends boolean = false
>(
  config: IRepositoryConfig<TDomain, TStored>,
  inputStore: IEntityConnectStore,
  connectOptions?: IEntityConnectOptions
): IRepository<TDomain, TIndexes, TChangeFeed, TAugmentMethods> => {
  return new EntityRepositoryOwner<TDomain, TStored, TIndexes, TAugmentMethods, TChangeFeed>(
    config,
    inputStore,
    connectOptions
  ).api()
}
