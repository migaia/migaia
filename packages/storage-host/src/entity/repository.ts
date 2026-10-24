import { inspectThenable, observeThenableRejection } from '@migaia/utils/function'
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
  type IEntitySecondaryMethods
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
  type IRecordIndexBackfillPreparation
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
    observeThenableRejection(result, inspectThenable(result), (error) => {
      port.report(error)
    })
  } catch (error) {
    port.report(error)
  }
}

/** Give one actual generator its explicit resource protocol without another iterator owner. */
function entityIterator<T>(
  generator: AsyncGenerator<T, void, unknown>,
  runtime: IEntityOperationRuntime
): IStorageIterator<T> {
  let closing: Promise<void> | undefined
  let symbolic: Promise<void> | undefined
  const dispose = (): Promise<void> =>
    (closing ??= generator.return(undefined).then(() => undefined))
  return Object.assign(generator, {
    dispose,
    [asyncDisposeKey]: () =>
      (symbolic ??= dispose().catch((cause) => reportCleanupError(runtime.reporter, cause)))
  })
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
  /** Entity gets business methods and original owner assertions, never a native close handle. */
  const backend = snapshotEntityStore(inputStore)
  const store = backend.store
  const {
    name,
    key: keyProp,
    version,
    schema,
    migrationPlan,
    validateOnRead,
    onDiagnostic,
    defaultOrderBy
  } = config
  /** Capture only the two declared ports once and reject cross-kind wiring at connect. */
  let codecStages: ICodecStageObserver | undefined
  let queryStages: IQueryStageObserver | undefined
  try {
    codecStages = connectOptions?.codecStages
    queryStages = connectOptions?.queryStages
    if (
      (codecStages !== undefined && codecStages.kind !== StorageStageKind.codec) ||
      (queryStages !== undefined && queryStages.kind !== StorageStageKind.query)
    )
      throw new TypeError(StorageErrorText.backendKindMismatch)
  } catch (cause) {
    throw new StorageError(StorageErrorCode.invalidConfig, { backend: store.backend, cause })
  }

  const recordStore = backend.recordStore()
  const records = recordStore !== undefined
  /** Non-unique selectors retain their existing write call counts; only constraints need scans. */
  const uniqueIndexes: ISnapshotEntityIndexes<TDomain> = Object.fromEntries(
    Object.entries(config.indexes).filter(([, index]) => index.definition.unique)
  )
  /** Native and fallback commits share the same canonical unique-key ownership rule. */
  const uniqueDefinitions = Object.values(uniqueIndexes).map((index) => index.definition)

  const emitDiagnostic = (message: string): void => {
    try {
      onDiagnostic(message)
    } catch (cause) {
      reportCleanupError(createStorageOperationRuntime().reporter, cause)
    }
  }

  /**
   * Select one codec for every repository path. Structured backends use the identity-like
   * structured codec by default, while text-only backends use JSON; an explicit codec is always
   * routed through capability validation.
   */
  const selectedCodec: ISelectedCodec = selectCodec(
    config.codec ?? (records ? structuredCodec : jsonCodec),
    store.capabilities,
    emitDiagnostic
  )

  /** The selected route preserves the original codec identity for observation. */
  const codecName = config.codec?.name ?? (records ? structuredCodec.name : jsonCodec.name)

  /** Drive backend-private projection migration without exposing its lease/checkpoint protocol. */
  const backfillIndexes = async (ctx?: IOperationContext): Promise<void> => {
    const capability = asRecordIndexBackfillStore<unknown>(store)
    const definitions = Object.values(config.indexes).map((index) => index.definition)
    if (capability === undefined || definitions.length === 0) return
    const handle = await capability.ensureRecordIndexes(name, definitions, ctx)
    const readiness = await capability.getRecordIndexReadiness(handle, ctx)
    if (readiness.status === 'complete') return
    const migrationState = (await recordStore?.metadata?.get(repositoryMigrationKey(name), ctx)) as
      | { readonly status?: unknown; readonly schemaFingerprint?: unknown }
      | undefined
    const allowComplete =
      migrationState?.status === StorageMigrationStatus.complete &&
      migrationState.schemaFingerprint === migrationFingerprint
    let session = await capability.openBackfillSession(
      handle,
      {
        range: repositoryEntityRange(name),
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
          prepare: async (candidate): Promise<IRecordIndexBackfillPreparation> => {
            await session.renew(ctx)
            const runtime = createStorageOperationRuntime()
            let domain: TDomain | undefined
            try {
              if (candidate.phase === RecordIndexBackfillPhase.legacy) {
                const canonicalId = decodeRepositoryKey(name, candidate.key)
                const legacyId =
                  Array.isArray(candidate.key) &&
                  candidate.key.length === 2 &&
                  candidate.key[0] === name &&
                  (typeof candidate.key[1] === 'string' || Array.isArray(candidate.key[1]))
                    ? (candidate.key[1] as IStorageKey)
                    : undefined
                if (canonicalId === undefined && legacyId === undefined)
                  return { decodedBytes: 0, outcome: 'skipped', counted: false }
                if (canonicalId !== undefined)
                  return { decodedBytes: 0, outcome: 'skipped', counted: false }
                if (legacyId !== undefined) {
                  const id = legacyId
                  const canonicalRaw = await recordStore!.getRecord(
                    composeRepositoryKey(name, id),
                    ctx
                  )
                  if (canonicalRaw !== undefined)
                    return { decodedBytes: 0, outcome: 'skipped', counted: false }
                }
              }
              const envelope = await decodeEnvelope(candidate.raw, ctx, runtime)
              domain = await materialize(envelope, ctx, runtime)
            } catch (cause) {
              emitDiagnostic(
                EntityText.storageWebEntitySkippedInvalidIndexBackfillRecord(
                  name,
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
                  : projectEntityIndexes(config.indexes, domain, store.backend)
            }
          }
        })
        if (
          batch.preparations === undefined ||
          batch.preparations.length !== batch.candidates.length
        )
          throw new StorageError(StorageErrorCode.invalidConfig, {
            backend: store.backend
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
              range: repositoryEntityRange(name),
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
          indexBackfillFailureText(name),
          [cause, persistFailure]
        )
      }
      throw cause
    } finally {
      session.release()
    }
  }
  const migrationFingerprint = [
    name,
    String(version),
    keyProp,
    schema.name,
    config.codec?.name ?? (records ? structuredCodec.name : jsonCodec.name),
    `range:${migrationPlan.baseVersion}:${migrationPlan.version}`
  ].join('|')

  const writeEnvelopeAt = async (
    target: IWriteTarget,
    envelope: IEnvelope,
    ctx: IOperationContext | undefined,
    runtime: IEntityOperationRuntime
  ): Promise<void> => {
    await writeEncodedEnvelopeAt(target, await encodeEnvelope(envelope, ctx, runtime), ctx)
  }

  /** Commit already encoded data so exclusive KV sections never invoke application codecs. */
  const writeEncodedEnvelopeAt = async (
    target: IWriteTarget,
    raw: unknown,
    ctx: IOperationContext | undefined
  ): Promise<void> => {
    if (recordStore && target.documentKey !== undefined) {
      await recordStore.putRecord(raw, target.documentKey, ctx)
      return
    }
    if (target.flatKey !== undefined) {
      await store.set(target.flatKey, raw as string, ctx)
    }
  }

  /** Every real conversion emits exactly one matching observation sequence. */
  const codecCall = async <R>(
    phase: 'encode' | 'decode',
    invoke: () => Promise<R>,
    runtime: IEntityOperationRuntime
  ): Promise<R> => {
    const stages =
      runtime.scope === undefined ? codecStages : codecStages?.forTransaction(runtime.scope)
    const operation =
      phase === 'encode' ? StorageOperation.entityCodecEncode : StorageOperation.entityCodecDecode
    const before = phase === 'encode' ? stages?.beforeEncode : stages?.beforeDecode
    const after = phase === 'encode' ? stages?.afterEncode : stages?.afterDecode
    const failed = phase === 'encode' ? stages?.onEncodeError : stages?.onDecodeError
    if (before !== undefined)
      observeEntity(stages!, () => Reflect.apply(before, stages, [operation, codecName]))
    try {
      const value = await invoke()
      if (after !== undefined)
        observeEntity(stages!, () => Reflect.apply(after, stages, [operation, codecName]))
      return value
    } catch (cause) {
      if (failed !== undefined)
        observeEntity(stages!, () =>
          Reflect.apply(failed, stages, [
            operation,
            codecName,
            readStorageHookFailureCode(cause, stages!.report)
          ])
        )
      throw cause
    }
  }
  /** Encode every repository write through the original codec and extension error boundary. */
  const encodeEnvelope = (
    envelope: IEnvelope,
    ctx: IOperationContext | undefined,
    runtime: IEntityOperationRuntime
  ): Promise<unknown> =>
    codecCall(
      'encode',
      () =>
        invokeExtension(
          () => selectedCodec.encode(envelope, ctx),
          store.backend,
          StorageOperation.entityCodecEncode,
          'codec',
          ctx?.signal,
          runtime
        ),
      runtime
    )

  const materialize = async (
    envelope: IEnvelope | undefined,
    ctx: IOperationContext | undefined,
    runtime: IEntityOperationRuntime
  ): Promise<TDomain | undefined> => {
    if (!envelope) return undefined
    /** Observation borrows this original host row and the shared plan's actual execution. */
    const stages = getBackendEnvelopeStages(store, {
      operation: StorageOperation.entityEnvelope,
      targetVersion: version
    })
    /** Timing observes only a real migration; the shared executor owns all steps and cancellation. */
    const started = stages === undefined ? 0 : systemScheduler.now()
    let stored: unknown
    try {
      stored = await migrateEnvelope(migrationPlan, envelope, {
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
    if (envelope.version !== version)
      stages?.afterMigrate(
        version,
        migrationPlan.reset === undefined ? 'steps' : 'reset',
        migrationPlan.reset === undefined ? version - envelope.version : 0,
        systemScheduler.now() - started
      )
    let decoded: TDomain
    try {
      decoded = schema.decode
        ? await invokeExtension(
            () => schema.decode!(stored as TStored, ctx),
            store.backend,
            StorageOperation.entitySchemaDecode,
            'schema',
            ctx?.signal,
            runtime
          )
        : (stored as TDomain)
    } catch (cause) {
      throw stageFailure('decode', cause)
    }
    if (!validateOnRead) return decoded
    try {
      return await invokeExtension(
        () => schema.validate(decoded, ctx),
        store.backend,
        StorageOperation.entitySchemaValidate,
        'schema',
        ctx?.signal,
        runtime
      )
    } catch (cause) {
      throw stageFailure('validate', cause)
    }
  }

  const toEnvelope = async (
    value: TDomain,
    ctx: IOperationContext | undefined,
    runtime: IEntityOperationRuntime
  ): Promise<{ readonly domain: TDomain; readonly envelope: IEnvelope }> => {
    const domain = await invokeExtension(
      () => schema.validate(value, ctx),
      store.backend,
      StorageOperation.entitySchemaValidate,
      'schema',
      ctx?.signal,
      runtime
    )
    const normalized = schema.normalize
      ? await invokeExtension(
          () => schema.normalize!(domain, ctx),
          store.backend,
          StorageOperation.entitySchemaNormalize,
          'schema',
          ctx?.signal,
          runtime
        )
      : domain
    const stored = schema.encode
      ? await invokeExtension(
          () => schema.encode!(normalized, ctx),
          store.backend,
          StorageOperation.entitySchemaEncode,
          'schema',
          ctx?.signal,
          runtime
        )
      : (normalized as unknown as TStored)
    try {
      return { domain: normalized, envelope: assertVersionedEnvelope({ version, state: stored }) }
    } catch (cause) {
      throw new StorageError(StorageErrorCode.serializeFailed, { cause })
    }
  }

  const decodeEnvelope = async (
    raw: unknown,
    ctx: IOperationContext | undefined,
    runtime: IEntityOperationRuntime
  ): Promise<IEnvelope> => {
    const decoded: unknown = await codecCall(
      'decode',
      () =>
        invokeExtension(
          () => selectedCodec.decode(raw, ctx),
          store.backend,
          StorageOperation.entityCodecDecode,
          'codec',
          ctx?.signal,
          runtime
        ),
      runtime
    )
    /** The shared validator captures hostile envelope fields once; hooks never re-read raw data. */
    const stages = getBackendEnvelopeStages(store, {
      operation: StorageOperation.entityEnvelope,
      targetVersion: version
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
  const invalidAction = (
    issue: IInvalidRecordIssue<TDomain>,
    option: IListSnapshot<TDomain> | undefined
  ): IInvalidRecordAction => invokeInvalidHandler(option?.onInvalid, issue)

  const validateInvalidHandler = (handler: unknown): void => {
    if (
      handler !== undefined &&
      handler !== 'skip' &&
      handler !== 'throw' &&
      typeof handler !== 'function'
    )
      throw new StorageError(StorageErrorCode.invalidConfig, {
        backend: store.backend,
        cause: new TypeError(EntityText.oninvalidMustBeSkipThrowOrAHandler)
      })
  }

  /** Snapshot list options once so getters cannot change values after validation. */
  const normalizeListOptions = (
    options:
      | IListSnapshot<TDomain>
      | IIndexedListOptions<TDomain, Readonly<Record<string, IStorageKey>>>
      | undefined
  ): IListSnapshot<TDomain> | undefined => {
    validateListOptions(options, store.backend)
    if (options === undefined) return undefined
    let range: IListSnapshot<TDomain>['range']
    let limit: IListSnapshot<TDomain>['limit']
    let orderBy: IListSnapshot<TDomain>['orderBy']
    let direction: IListSnapshot<TDomain>['direction']
    let onInvalid: IListSnapshot<TDomain>['onInvalid']
    try {
      range = options.range
      limit = options.limit
      orderBy = options.orderBy
      direction = options.direction
      onInvalid = options.onInvalid
    } catch (cause) {
      throw new StorageError(StorageErrorCode.invalidConfig, {
        backend: store.backend,
        cause
      })
    }
    const rangeSnapshot = snapshotKeyRange(range, store.backend)
    validateLimit(limit, store.backend)
    validateOrderBy(orderBy, store.backend)
    if (direction !== undefined && direction !== 'next' && direction !== 'prev')
      throw new StorageError(StorageErrorCode.invalidConfig, {
        backend: store.backend,
        cause: new TypeError(EntityText.listDirectionMustBeNextOrPrev)
      })
    validateInvalidHandler(onInvalid)
    return { range: rangeSnapshot, limit, orderBy, direction, onInvalid }
  }

  /** Immutable indexed-query input captured before any query route consumes it. */
  type IIndexedListSnapshot = {
    readonly index: string
    readonly range: IListSnapshot<TDomain>['range']
    readonly options: IListSnapshot<TDomain> | undefined
  }

  /** Read every indexed-list option once and convert it to a guarded snapshot. */
  const snapshotIndexedListOptions = (
    options:
      | IListSnapshot<TDomain>
      | IIndexedListOptions<TDomain, Readonly<Record<string, IStorageKey>>>
      | undefined
  ): IIndexedListSnapshot | undefined => {
    validateListOptions(options, store.backend)
    if (options === undefined) return undefined
    let index: unknown
    let range: IListSnapshot<TDomain>['range']
    let limit: IListSnapshot<TDomain>['limit']
    let orderBy: IListSnapshot<TDomain>['orderBy']
    let direction: IListSnapshot<TDomain>['direction']
    let onInvalid: IListSnapshot<TDomain>['onInvalid']
    try {
      index = (options as { readonly index?: unknown }).index
      if (index === undefined) return undefined
      range = options.range
      limit = options.limit
      orderBy = options.orderBy
      direction = options.direction
      onInvalid = options.onInvalid
    } catch (cause) {
      throw new StorageError(StorageErrorCode.invalidConfig, {
        backend: store.backend,
        cause
      })
    }
    if (typeof index !== 'string' || index.length === 0)
      throw new StorageError(StorageErrorCode.invalidConfig, {
        backend: store.backend,
        cause: new TypeError(EntityText.indexedListIndexMustBeANonEmptyString)
      })
    const normalized = normalizeListOptions({ range, limit, orderBy, direction, onInvalid })
    return { index, range: normalized?.range, options: normalized }
  }

  /** Build an indexed snapshot for the findManyBy/findBy/streamBy APIs. */
  const createIndexedListSnapshot = (
    index: string,
    range: IListSnapshot<TDomain>['range'],
    options:
      | IListSnapshot<TDomain>
      | IIndexedListOptions<TDomain, Readonly<Record<string, IStorageKey>>>
      | undefined
  ): IIndexedListSnapshot => {
    const normalized = normalizeListOptions(options)
    const rangeSnapshot = snapshotKeyRange(range, store.backend)
    return { index, range: rangeSnapshot, options: normalized }
  }

  /** Snapshot migration options once before checkpoint or record work begins. */
  const normalizeMigrateOptions = (
    options: IMigrateOptions<TDomain>
  ): { readonly batchSize: number; readonly onInvalid: IMigrateOptions<TDomain>['onInvalid'] } => {
    if (options === null || typeof options !== 'object' || Array.isArray(options))
      throw new StorageError(StorageErrorCode.invalidConfig, {
        backend: store.backend,
        cause: new TypeError(EntityText.migrateOptionsMustBeAnObject)
      })
    let batchSize: IMigrateOptions<TDomain>['batchSize']
    let onInvalid: IMigrateOptions<TDomain>['onInvalid']
    try {
      batchSize = options.batchSize
      onInvalid = options.onInvalid
    } catch (cause) {
      throw new StorageError(StorageErrorCode.invalidConfig, {
        backend: store.backend,
        cause
      })
    }
    const normalizedBatchSize = batchSize === undefined ? 100 : batchSize
    if (!Number.isSafeInteger(normalizedBatchSize) || normalizedBatchSize < 1)
      throw new StorageError(StorageErrorCode.invalidConfig, {
        backend: store.backend,
        cause: new RangeError(EntityText.migrateBatchSizeMustBeAPositiveSafeInteger)
      })
    validateInvalidHandler(onInvalid)
    return { batchSize: normalizedBatchSize, onInvalid }
  }

  const invokeInvalidHandler = (
    handler: IInvalidRecordAction | IInvalidRecordHandler<TDomain> | undefined,
    issue: IInvalidRecordIssue<TDomain>
  ): IInvalidRecordAction => {
    if (handler === undefined || handler === 'skip' || handler === 'throw') return handler ?? 'skip'
    if (typeof handler !== 'function')
      throw new StorageError(StorageErrorCode.invalidConfig, {
        backend: store.backend,
        key: issue.key,
        cause: new TypeError(EntityText.oninvalidMustBeSkipThrowOrAHandler)
      })
    try {
      const action = handler(issue)
      if (action !== 'skip' && action !== 'throw')
        throw new StorageError(StorageErrorCode.invalidConfig, {
          backend: store.backend,
          key: issue.key,
          cause: new TypeError(EntityText.oninvalidHandlerMustReturnSkipOrThrow)
        })
      return action
    } catch (cause) {
      if (isStorageErrorFamily(cause) && cause.code === StorageErrorCode.invalidConfig) throw cause
      throw new StorageError(StorageErrorCode.validationFailed, {
        backend: store.backend,
        key: issue.key,
        cause
      })
    }
  }

  const throwInvalid = (issue: IInvalidRecordIssue<TDomain>): never => {
    /* c8 ignore start -- all current decode/migrate/validate stages normalize to StorageError. */
    if (isStorageErrorFamily(issue.cause)) throw issue.cause
    const code =
      issue.stage === StorageRecordStage.migrate
        ? StorageErrorCode.migrationFailed
        : issue.stage === StorageRecordStage.decode
          ? StorageErrorCode.deserializeFailed
          : StorageErrorCode.validationFailed
    throw new StorageError(code, {
      backend: store.backend,
      key: issue.key,
      cause: issue.cause
    })
    /* c8 ignore stop */
  }

  const materializeForRead = async (
    id: IStorageKey,
    envelope: IEnvelope | undefined,
    ctx: IOperationContext | undefined,
    runtime: IEntityOperationRuntime
  ): Promise<TDomain | undefined> => {
    try {
      return await materialize(envelope, ctx, runtime)
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
      throw new StorageError(code, { backend: store.backend, key: id, cause })
    }
  }

  const readEnvelope = async (
    id: IStorageKey,
    ctx: IOperationContext | undefined,
    runtime: IEntityOperationRuntime
  ): Promise<IEnvelope | undefined> => {
    if (recordStore) {
      let raw = await recordStore.getRecord(composeRepositoryKey(name, id), ctx)
      if (raw === undefined) raw = await recordStore.getRecord(composeStructuredKey(name, id), ctx)
      if (raw === undefined) return undefined
      return decodeEnvelope(raw, ctx, runtime)
    }
    const raw = await store.get(composeFlatKey(name, id), ctx)
    if (raw === null) return undefined
    return decodeEnvelope(raw, ctx, runtime)
  }

  /**
   * Canonical ID ordering uses the same radix structure; comparator scans retain only heap
   * candidates.
   */
  const streamImpl = async function* (
    options: IListSnapshot<TDomain> | undefined,
    ctx: IOperationContext | undefined,
    runtime: IEntityOperationRuntime,
    applyOrdering = true,
    readView?: IRepositoryReadView,
    onRead?: () => void,
    project?: (value: TDomain) => void
  ): AsyncGenerator<TDomain, void, unknown> {
    if (options?.limit === 0) return
    type ICandidate = {
      readonly id: IStorageKey
      readonly physical: IStorageKey | string
      readonly raw: unknown
    }
    /**
     * Unordered source scans yield immediately; only ordinary canonical ordering builds a candidate
     * index.
     */
    const scan = async function* (): AsyncGenerator<ICandidate, void, unknown> {
      if (recordStore !== undefined) {
        const canonicalIds = new Set<string>()
        const iterate =
          readView?.iterateRecords ?? ((range) => recordStore.iterateRecords(range, ctx))
        try {
          for (const range of [repositoryEntityRange(name), undefined]) {
            for await (const [physical, raw] of iterate(range)) {
              const canonical = decodeRepositoryKey(name, physical)
              const legacy =
                Array.isArray(physical) && physical.length === 2 && physical[0] === name
                  ? (physical[1] as IStorageKey)
                  : undefined
              const id = canonical ?? legacy
              if (id === undefined || !isStorageKeyInRange(id, options?.range)) continue
              if (range === undefined && canonical !== undefined) continue
              onRead?.()
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
        emitDiagnostic(EntityText.valueScan(name))
        const prefix = flatKeyPrefix(name)
        for (const physical of readView?.keys === undefined
          ? await store.keys(ctx)
          : await readView.keys()) {
          if (!physical.startsWith(prefix)) continue
          const id = decodeFlatStorageKey(physical.slice(prefix.length))
          if (id !== undefined && isStorageKeyInRange(id, options?.range)) {
            onRead?.()
            yield { id, physical, raw: undefined }
          }
        }
      }
    }
    const candidates = createOrderedRecordIndex<ICandidate>()
    const orderedScan = async function* (): AsyncGenerator<ICandidate, void, unknown> {
      if (!applyOrdering) {
        yield* scan()
        return
      }
      for await (const candidate of scan())
        candidates.set(encodeOrderedStorageKey(candidate.id, store.backend), candidate)
      for (
        let item = options?.direction === 'prev' ? candidates.last : candidates.first;
        item !== undefined;
        item = options?.direction === 'prev' ? item.previous : item.next
      )
        yield item.value
    }
    let count = 0
    try {
      for await (const row of orderedScan()) {
        const raw =
          recordStore !== undefined
            ? readView?.getRecord === undefined
              ? row.raw
              : await readView.getRecord(row.physical as IStorageKey)
            : readView?.get === undefined
              ? await store.get(row.physical as string, ctx)
              : await readView.get(row.physical as string)
        if (raw === undefined || (!recordStore && raw === null)) continue
        let value: TDomain | undefined
        try {
          let envelope: IEnvelope
          try {
            envelope = await decodeEnvelope(raw, ctx, runtime)
          } catch (cause) {
            throw stageFailure(StorageRecordStage.decode, cause)
          }
          value = await materialize(envelope, ctx, runtime)
          if (value !== undefined) project?.(value)
        } catch (cause) {
          value = undefined
          const issue: IInvalidRecordIssue<TDomain> = {
            key: row.id,
            raw,
            stage: (cause as Partial<IStageFailure>).stage ?? StorageRecordStage.validate,
            cause
          }
          if (invalidAction(issue, options) === StorageInvalidRecordAction.throw)
            throwInvalid(issue)
          emitDiagnostic(EntityText.invalidRecord(name, row.id))
        }
        if (value !== undefined) {
          yield value
          if (options?.limit !== undefined && ++count >= options.limit) return
        }
      }
    } finally {
      candidates.clear()
    }
  }

  /** Domain callbacks and bounded selection use the sole contract query executor. */
  const listQuery = (
    options: IListSnapshot<TDomain> | undefined,
    ctx: IOperationContext | undefined,
    runtime: IEntityOperationRuntime,
    readView?: IRepositoryReadView,
    onRead?: () => void
  ): IRecordQueryBase<TDomain, IOperationContext> => {
    const comparator = options?.orderBy ?? defaultOrderBy
    if (comparator !== undefined && options?.limit === undefined)
      throw new StorageError(StorageErrorCode.invalidConfig, {
        backend: store.backend,
        cause: new TypeError(EntityText.comparatorLimit)
      })
    const source = createRecordQuery<TDomain>({
      asyncDisposeKey,
      pushdown: { source: EntityState.querySource, operations: [], operators: [] },
      execute: () =>
        entityIterator(
          (async function* () {
            for await (const value of streamImpl(
              { ...options, orderBy: undefined, limit: undefined },
              ctx,
              runtime,
              comparator === undefined,
              readView,
              onRead
            ))
              yield [idOf(name, keyProp, value, store.backend), value] as const
          })(),
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
              backend: store.backend,
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
  const projectUniqueWrite = (value: TDomain): IRecordIndexProjection => {
    try {
      return projectEntityIndexes(uniqueIndexes, value, store.backend)
    } catch (cause) {
      throw normalizeError(
        cause,
        store.backend,
        StorageErrorCode.extensionFailed,
        StorageOperation.entityIndexProjection
      )
    }
  }

  /** Validate the final proposed rows through the same projection/ownership owner as native IDB. */
  const validateUniqueRows = async (
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
    for await (const value of streamImpl(undefined, ctx, runtime, false, readView)) {
      /** Normal repository writes bind the domain key to the physical record identity. */
      const id = idOf(name, keyProp, value, store.backend)
      rows.push({ key: id, projection: projectUniqueWrite(value) })
    }
    for (const change of changes.values())
      if (change.projection !== undefined)
        rows.push({ key: change.id, projection: change.projection })
    collectUniqueIndexOwners(uniqueDefinitions, rows, store.backend)
  }

  /** Use one normal record revision as a phantom barrier, with no sidecar or duplicate queue. */
  const validateUniqueRecordCommit = async (
    tx: ITransactionScope,
    changes: ReadonlyMap<string, IEntityUniqueMutation>,
    ctx: IOperationContext | undefined,
    runtime: IEntityOperationRuntime
  ): Promise<void> => {
    if (
      uniqueDefinitions.length === 0 ||
      ![...changes.values()].some((change) => change.projection !== undefined)
    )
      return
    const marker = repositoryUniqueWriteKey(name)
    await tx.getRecord(marker)
    const replaced = new Set(
      [...changes.values()].flatMap((change) => [
        encodeFlatStorageKey(composeRepositoryKey(name, change.id)),
        encodeFlatStorageKey(composeStructuredKey(name, change.id))
      ])
    )
    await validateUniqueRows(changes, ctx, runtime, {
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
  const snapshotUniqueValues = async (
    ctx: IOperationContext | undefined
  ): Promise<ReadonlyMap<string, string>> => {
    /** Backend namespace isolation is already owned by its public keys/get methods. */
    const prefix = flatKeyPrefix(name)
    /** Missing keys are absent from the snapshot even if enumeration raced their deletion. */
    const snapshot = new Map<string, string>()
    for (const key of await store.keys(ctx)) {
      if (!key.startsWith(prefix)) continue
      /** Read each stored text once for subsequent schema/projection work. */
      const raw = await store.get(key, ctx)
      if (raw !== null) snapshot.set(key, raw)
    }
    return snapshot
  }

  /**
   * Preserve KV support: validate outside the critical section, then compare-and-commit under its
   * host owner.
   */
  const writeUniqueValue = async (
    id: IStorageKey,
    domain: TDomain,
    envelope: IEnvelope,
    ctx: IOperationContext | undefined
  ): Promise<void> => {
    const commit = getBackendValueCommit(store)
    if (commit === undefined)
      throw new StorageContractError(StorageContractErrorCode.unsupported, {
        backend: store.backend
      })
    return withAbort(ctx, async (signal, context, runtime) => {
      /** One deadline covers preparation and lock admission; nested backend calls share its signal. */
      const operation = { ...context, signal, timeoutMs: undefined }
      /** All application encoding runs before lock admission, including asynchronous codecs. */
      const raw = await encodeEnvelope(envelope, operation, runtime)
      /** Incoming projection is prepared once; the old value at the same primary key is replaced. */
      const changes = new Map<string, IEntityUniqueMutation>([
        [
          encodeFlatStorageKey(id),
          {
            id,
            projection: projectUniqueWrite(domain)
          }
        ]
      ])
      /** Capture the exact raw values whose materialized projections are checked. */
      const snapshot = await snapshotUniqueValues(operation)
      /** The current primary key is not a competing owner. */
      const targetKey = composeFlatKey(name, id)
      await validateUniqueRows(changes, operation, runtime, {
        keys: async () => [...snapshot.keys()].filter((key) => key !== targetKey),
        get: async (key) => snapshot.get(key) ?? null
      })
      await commit(
        {
          prefix: flatKeyPrefix(name),
          expected: [...snapshot],
          key: targetKey,
          value: raw as string
        },
        operation
      )
    })
  }

  /** Fixed ordering metadata concatenates two canonical encodings without taxing a synthetic key. */
  const encodeIndexOrder = (key: IStorageKey, id: IStorageKey): Uint8Array => {
    const index = encodeOrderedStorageKey(key, store.backend)
    const primary = encodeOrderedStorageKey(id, store.backend)
    const encoded = new Uint8Array(index.byteLength + primary.byteLength)
    encoded.set(index)
    encoded.set(primary, index.byteLength)
    return encoded
  }

  /** A ready handle is a captured backend fact; bound transactions never create or backfill it. */
  let readyHandle: IRecordIndexHandle | undefined
  /** Index collection and streaming share native cursors, filtering and the sole bounded heap. */
  /** Native and fallback index rows share one materializer and canonical metadata ordering. */
  type IMatch = { readonly id: IStorageKey; readonly key: IStorageKey; readonly value: TDomain }
  const indexRows = (
    snapshot: IIndexedListSnapshot,
    ctx: IOperationContext | undefined,
    readView?: IRepositoryReadView,
    orderedSource = true,
    onRead?: () => void
  ): IStorageIterator<readonly [IStorageKey, IMatch]> => {
    const index = config.indexes[snapshot.index]
    if (index === undefined)
      throw new StorageError(StorageErrorCode.invalidConfig, {
        backend: store.backend,
        cause: new TypeError(EntityText.indexMissing(name, snapshot.index))
      })
    const runtime = readView?.runtime ?? createStorageOperationRuntime()
    return entityIterator(
      (async function* () {
        if (snapshot.options?.limit === 0) return
        const seen = new Set<string>()
        const ordered = createOrderedRecordIndex<IMatch>()
        const match = (value: TDomain): IMatch | undefined => {
          const id = idOf(name, keyProp, value, store.backend)
          const identity = encodeFlatStorageKey(id)
          if (seen.has(identity)) return
          const projection = index.project(value, store.backend)
          const first = minimumProjectedIndexKey(projection, snapshot.range)
          if (first === undefined) return
          seen.add(identity)
          return { id, key: first, value }
        }
        try {
          if (readView === undefined) {
            const capability = asRecordIndexBackfillStore<unknown>(store)
            if (capability !== undefined) {
              try {
                await backfillIndexes(ctx)
                const handle = await capability.ensureRecordIndexes(
                  name,
                  Object.values(config.indexes).map((item) => item.definition),
                  ctx
                )
                if ((await capability.getRecordIndexReadiness(handle, ctx)).status === 'complete')
                  readyHandle = handle
              } catch (cause) {
                if (!isBackfillContentionFailure(cause)) throw cause
              }
            }
          }
          /** Native index admission retains its original lazy position after source preparation. */
          const secondaryStore =
            readView === undefined && recordStore !== undefined
              ? backend.secondaryStore()
              : undefined
          const native =
            readView === undefined
              ? secondaryStore !== undefined
                ? (query: Parameters<ISecondaryIndexRecordStore['iterateRecordIndex']>[0]) =>
                    secondaryStore.iterateRecordIndex(query, ctx)
                : undefined
              : readView.iterateRecordIndex
          /** Bound operations carry only readiness proved by their own current native scope. */
          const selectedHandle = readView === undefined ? readyHandle : readView.readyHandle
          if (selectedHandle !== undefined && native !== undefined) {
            for await (const [physical, raw] of native({
              handle: selectedHandle,
              index: snapshot.index,
              range: snapshot.range,
              direction: snapshot.options?.direction
            })) {
              onRead?.()
              let current: IMatch | undefined
              try {
                const value = await materialize(
                  await decodeEnvelope(raw, ctx, runtime),
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
                if (invalidAction(issue, snapshot.options) === StorageInvalidRecordAction.throw)
                  throwInvalid(issue)
                emitDiagnostic(EntityText.invalidRecord(name, physical))
              }
              if (current !== undefined) {
                if (!orderedSource) yield [current.id, current] as const
                else ordered.set(encodeIndexOrder(current.key, current.id), current)
              }
            }
          } else {
            emitDiagnostic(EntityText.indexFallback(name, snapshot.index))
            let projected: IMatch | undefined
            for await (const _value of streamImpl(
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
              else ordered.set(encodeIndexOrder(current.key, current.id), current)
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
      })(),
      runtime
    )
  }

  const createIndexQuery = (
    snapshot: IIndexedListSnapshot,
    ctx: IOperationContext | undefined,
    readView?: IRepositoryReadView,
    onRead?: () => void
  ): IQueryResult<TDomain, IOperationContext> => {
    ctx = snapshotOperationContext(ctx)
    const index = config.indexes[snapshot.index]
    if (index === undefined)
      throw new StorageError(StorageErrorCode.invalidConfig, {
        backend: store.backend,
        cause: new TypeError(EntityText.indexMissing(name, snapshot.index))
      })
    const comparator = snapshot.options?.orderBy ?? defaultOrderBy
    if (comparator !== undefined && snapshot.options?.limit === undefined)
      throw new StorageError(StorageErrorCode.invalidConfig, {
        backend: store.backend,
        cause: new TypeError(EntityText.comparatorLimit)
      })
    const source = createRecordQuery<IMatch>({
      asyncDisposeKey,
      pushdown: { source: EntityState.querySource, operations: [], operators: [] },
      execute: () => indexRows(snapshot, ctx, readView, comparator === undefined, onRead)
    })
    let query: IRecordQueryBase<IMatch, IOperationContext> = source
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
              backend: store.backend,
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
  const scopedQuerySource = (
    scope: ITransactionScope,
    selection: IEntityQuerySourceSelection<TDomain>,
    onRead?: () => void,
    orderedSource = true,
    physicalIds?: Map<string, IStorageKey>,
    accepts?: (value: TDomain) => boolean
  ): IStorageIterator<readonly [IStorageKey, TDomain]> => {
    backend.assertScope(scope)
    const source = scope.iterateRecords()
    const rows = createOrderedRecordIndex<readonly [IStorageKey, TDomain]>()
    /** Mutation reuses this existing deduplication table to retain actual physical identities. */
    const seen = physicalIds ?? new Set<string>()
    let prepared = false
    let initialized = false
    let cursor: IStorageIterator<[IStorageKey, unknown]> | undefined
    let item: typeof rows.first
    const derived = deriveTransactionIterator<
      [IStorageKey, unknown],
      readonly [IStorageKey, TDomain]
    >(
      source,
      async (next, _fail, currentScope) => {
        const current = currentScope as ITransactionScope
        backend.assertScope(current)
        const context = readTransactionOperationContext(current)
        const runtime = entityRuntime(current)
        const index = selection.index === undefined ? undefined : config.indexes[selection.index]
        if (!initialized) {
          initialized = true
          const handle =
            readyHandle !== undefined &&
            index !== undefined &&
            (await current.isRecordIndexReady?.(readyHandle))
              ? readyHandle
              : undefined
          if (handle !== undefined && current.iterateRecordIndex !== undefined)
            cursor = current.iterateRecordIndex({
              handle,
              index: selection.index!,
              range: selection.range
            })
        }
        if (!prepared) {
          while (true) {
            const result =
              cursor === undefined ? await next() : await nextTransactionIterator(current, cursor)
            if (result.done) break
            const [physical, raw] = result.value
            const canonical = decodeRepositoryKey(name, physical)
            const legacy =
              Array.isArray(physical) && physical.length === 2 && physical[0] === name
                ? (physical[1] as IStorageKey)
                : undefined
            const physicalId = canonical ?? legacy
            if (physicalId === undefined) continue
            onRead?.()
            if (
              legacy !== undefined &&
              canonical === undefined &&
              (await current.getRecord(composeRepositoryKey(name, legacy))) !== undefined
            )
              continue
            let value: TDomain | undefined
            try {
              value = await materialize(
                await decodeEnvelope(raw, context, runtime),
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
                invalidAction(issue, { onInvalid: selection.onInvalid }) ===
                StorageInvalidRecordAction.throw
              )
                throwInvalid(issue)
              emitDiagnostic(EntityText.invalidRecord(name, physicalId))
            }
            if (value === undefined) continue
            const id = idOf(name, keyProp, value, store.backend)
            const identity = encodeFlatStorageKey(id)
            if (seen.has(identity)) continue
            let ordering: IStorageKey = [id]
            let encodedOrdering: Uint8Array | undefined
            if (index !== undefined) {
              let projection: ReturnType<typeof index.project>
              try {
                projection = index.project(value, store.backend)
              } catch (cause) {
                const issue: IInvalidRecordIssue<TDomain> = {
                  key: physicalId,
                  raw,
                  stage: StorageRecordStage.validate,
                  cause
                }
                if (
                  invalidAction(issue, { onInvalid: selection.onInvalid }) ===
                  StorageInvalidRecordAction.throw
                )
                  throwInvalid(issue)
                emitDiagnostic(EntityText.invalidRecord(name, physicalId))
                continue
              }
              const first = minimumProjectedIndexKey(projection, selection.range)
              if (first === undefined) continue
              ordering = [first, id]
              if (orderedSource) encodedOrdering = encodeIndexOrder(first, id)
            } else if (!isStorageKeyInRange(id, selection.range)) continue
            if (seen instanceof Map) seen.set(identity, physicalId)
            else seen.add(identity)
            if (accepts !== undefined && !accepts(value)) continue
            if (!orderedSource) return { done: false, value: [ordering, value] as const }
            rows.set(encodedOrdering ?? encodeOrderedStorageKey(id, store.backend), [
              ordering,
              value
            ])
          }
          prepared = true
          item = rows.first
        }
        if (item === undefined) return { done: true, value: undefined }
        const value = item.value
        item = item.next
        return { done: false, value }
      },
      async () => {
        try {
          await cursor?.dispose()
        } finally {
          rows.clear()
          if (physicalIds === undefined) seen.clear()
        }
      }
    )
    // The source was just registered by the authentic scope; derivation shares that original owner.
    return derived!
  }

  /** Observation wraps the same original core for both fluent and legacy option adapters. */
  const observeQueryRead = <R>(
    invoke: () => Promise<R>,
    plan: IEntityQueryPlan,
    selection: IEntityQuerySourceSelection<TDomain>,
    current: ITransactionScope | undefined,
    openedCounter: () => { readCount: number } | undefined,
    returnedCount: (value: R) => number
  ): Promise<R> => {
    if (queryStages === undefined) return invoke()
    const stages = current === undefined ? queryStages : queryStages?.forTransaction(current)
    const started = stages === undefined ? 0 : systemScheduler.now()
    if (stages?.beforeQuery !== undefined)
      observeEntity(stages, () => stages.beforeQuery!(name, selection.index, plan))
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
            stages.afterQuery!(name, selection.index, {
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
              name,
              selection.index,
              readStorageHookFailureCode(cause, stages.report)
            )
          )
        throw cause
      }
    )
  }
  const observeQueryStream = <R>(
    iterator: IStorageIterator<R>,
    plan: IEntityQueryPlan,
    selection: IEntityQuerySourceSelection<TDomain>,
    counter: { readCount: number } | undefined
  ): IStorageIterator<R> => {
    let returnedCount = 0
    let elapsedMs = 0
    const advance = async (
      next: () => Promise<IteratorResult<R>>,
      current?: ITransactionScope
    ): Promise<IteratorResult<R>> => {
      const stages = current === undefined ? queryStages : queryStages?.forTransaction(current)
      const started = stages === undefined ? 0 : systemScheduler.now()
      if (stages?.beforeQuery !== undefined)
        observeEntity(stages, () => stages.beforeQuery!(name, selection.index, plan))
      try {
        const value = await next()
        if (!value.done) returnedCount++
        if (stages !== undefined) elapsedMs += systemScheduler.now() - started
        if (stages?.afterQuery !== undefined)
          observeEntity(stages, () =>
            stages.afterQuery!(name, selection.index, {
              readCount: counter?.readCount ?? 0,
              returnedCount,
              elapsedMs,
              completed: value.done === true
            })
          )
        return value
      } catch (cause) {
        if (stages?.onQueryError !== undefined)
          observeEntity(stages, () =>
            stages.onQueryError!(
              name,
              selection.index,
              readStorageHookFailureCode(cause, stages.report)
            )
          )
        throw cause
      }
    }
    if (queryStages === undefined) return iterator
    const derived = deriveTransactionIterator(iterator, (next, _fail, current) =>
      advance(next, current as ITransactionScope)
    )
    if (derived !== undefined) return derived
    return {
      next: () => advance(() => iterator.next()),
      return: iterator.return === undefined ? undefined : (value) => iterator.return!(value),
      dispose: iterator.dispose,
      [asyncDisposeKey]: iterator[asyncDisposeKey],
      [Symbol.asyncIterator]() {
        return this
      }
    }
  }
  /** Source adaptation contributes no second AST or query executor. */
  const queryFor = <C extends IOperationContext | undefined>(
    scope?: ITransactionScope
  ): IEntityQuery<TDomain, TIndexes, C, TAugmentMethods> => {
    /** Each opened source owns one numeric counter; terminals capture it synchronously on open. */
    let opened: { readCount: number } | undefined
    /** Only immutable observer flags are carried through synchronous source opening. */
    let openingPlan: IEntityQueryPlan | undefined
    let openingSelection: IEntityQuerySourceSelection<TDomain> | undefined
    return createEntityQuery<TDomain, TIndexes, C, TAugmentMethods>({
      predicate: (fn) => (value) => {
        try {
          const result = fn(value)
          const inspected = inspectThenable(result)
          if (typeof result !== 'boolean') {
            observeThenableRejection(result, inspected, createStorageOperationRuntime().reporter)
            throw new TypeError(EntityText.queryPredicateBoolean)
          }
          return result
        } catch (cause) {
          throw new StorageError(StorageErrorCode.extensionFailed, {
            backend: store.backend,
            cause,
            operation: StorageOperation.queryWhere,
            extensionStage: 'where'
          })
        }
      },
      selector: (fn) => (value) => {
        try {
          const result = fn(value)
          const inspected = inspectThenable(result)
          if ('error' in inspected) throw inspected.error
          if (inspected.then !== undefined) {
            observeThenableRejection(result, inspected, createStorageOperationRuntime().reporter)
            throw new TypeError(EntityText.querySelectorKey)
          }
          try {
            return snapshotStorageKey(result, store.backend)
          } catch (cause) {
            throw new TypeError(EntityText.querySelectorKey, { cause })
          }
        } catch (cause) {
          throw new StorageError(StorageErrorCode.extensionFailed, {
            backend: store.backend,
            cause,
            operation: StorageOperation.querySelector,
            extensionStage: 'selector'
          })
        }
      },
      mapper: (fn) => async (value) => {
        try {
          return await fn(value)
        } catch (cause) {
          throw new StorageError(StorageErrorCode.extensionFailed, {
            backend: store.backend,
            cause,
            operation: StorageOperation.querySelect,
            extensionStage: 'select'
          })
        }
      },
      comparator: (fn) => (left, right) => {
        try {
          const result = fn(left, right)
          if (!Number.isFinite(result)) {
            observeThenableRejection(
              result,
              inspectThenable(result),
              createStorageOperationRuntime().reporter
            )
            throw new TypeError(StorageErrorText.entityComparatorInvalid)
          }
          return result
        } catch (cause) {
          throw new StorageError(StorageErrorCode.extensionFailed, {
            backend: store.backend,
            cause,
            operation: StorageOperation.queryComparator,
            extensionStage: 'comparator'
          })
        }
      },
      methods: getBackendEntityQueryMethods(store) as TAugmentMethods | undefined,
      defaultComparator: defaultOrderBy,
      run: (invoke, plan, selection, returnedCount) => {
        const collect = (current?: ITransactionScope) => {
          const previous = openingPlan
          const previousSelection = openingSelection
          openingPlan = plan
          openingSelection = selection
          try {
            return observeQueryRead(invoke, plan, selection, current, () => opened, returnedCount)
          } finally {
            openingPlan = previous
            openingSelection = previousSelection
          }
        }
        return scope === undefined
          ? collect()
          : runTransactionOperation(scope, (current) => collect(current))
      },
      stream: (open, plan, selection) => {
        const previous = openingPlan
        const previousSelection = openingSelection
        openingPlan = plan
        openingSelection = selection
        let iterator: ReturnType<typeof open>
        try {
          iterator = open()
        } finally {
          openingPlan = previous
          openingSelection = previousSelection
        }
        return observeQueryStream(iterator, plan, selection, opened)
      },
      missingLimit: () => {
        throw new StorageError(StorageErrorCode.invalidConfig, {
          backend: store.backend,
          cause: new TypeError(EntityText.comparatorLimit)
        })
      },
      invalidState: (cause) => {
        throw new StorageError(StorageErrorCode.invalidConfig, {
          backend: store.backend,
          cause: cause ?? new TypeError(EntityText.queryState)
        })
      },
      invalid: (action) => {
        normalizeListOptions({ onInvalid: action as IInvalidRecordAction })
      },
      range: (range) => snapshotKeyRange(range, store.backend)!,
      index: (index, match) => {
        const range =
          match === undefined
            ? undefined
            : isPlainObject(match) && ('lower' in match || 'upper' in match)
              ? match
              : { lower: match, upper: match }
        const snapshot = createIndexedListSnapshot(
          index,
          range as import('@migaia/storage-contract').IKeyRange | undefined,
          undefined
        )
        if (config.indexes[index] === undefined)
          throw new StorageError(StorageErrorCode.invalidConfig, {
            backend: store.backend,
            cause: new TypeError(EntityText.indexMissing(name, index))
          })
        return { index, range: snapshot.range }
      },
      source: (selectedSource): IRecordQuerySource => ({
        asyncDisposeKey,
        // A uniform author container permits terminal-local index selection without shrinking key budgets.
        tieBreakByKey: { direction: 'next', parts: true },
        pushdown: { source: EntityState.querySource, operations: [], operators: [] },
        ...(scope !== undefined || backend.watchRecords === undefined
          ? {}
          : {
              watch: ({ ctx }: import('@migaia/storage-contract').IRecordQueryInput) =>
                backend.watchRecords!(ctx)
            }),
        plan: (conditions) => {
          /** Explicit source choice precedes automatic static condition selection. */
          const explicit = selectedSource.index !== undefined || selectedSource.range !== undefined
          const automatic = explicit
            ? undefined
            : chooseEntityQueryIndex(config.indexes, conditions, store.backend)
          const selection = { ...(automatic?.selection ?? selectedSource) }
          const index = selection.index === undefined ? undefined : config.indexes[selection.index]
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
                      supportsEntityIndexCondition(config.indexes, condition)
                  })
            },
            sourceReason: explicit ? EntityText.queryIndexExplicit : automatic!.sourceReason,
            sourceCandidates: explicit
              ? Object.keys(config.indexes).map((index) => ({
                  index,
                  reason: EntityText.queryIndexExplicit
                }))
              : automatic!.sourceCandidates
          }
        },
        mutate: (request, run) => {
          if (recordStore === undefined)
            throw new StorageContractError(StorageContractErrorCode.unsupported, {
              backend: store.backend
            })
          /** Capture the same observer/source facts before the original transaction can suspend. */
          const policy = openingSelection ?? selectedSource
          const orderedSource = openingPlan?.hasOrder !== true
          const counter = queryStages === undefined ? undefined : { readCount: 0 }
          opened = counter
          const onRead =
            counter === undefined
              ? undefined
              : () => {
                  counter.readCount++
                }
          /** The authentic operation owns selection, repository writes and the existing first error. */
          const apply = (target: ITransactionScope): Promise<number> =>
            runTransactionOperation(target, async (current) => {
              backend.assertScope(current)
              /** This is the source's original seen table, not an index or a retained row cache. */
              const physicalIds = new Map<string, IStorageKey>()
              try {
                return await run({
                  execute: ({ selection: planned, conditions }) => {
                    const selection = {
                      ...((planned as IEntityQuerySourceSelection<TDomain> | undefined) ??
                        selectedSource),
                      onInvalid: policy.onInvalid
                    }
                    const predicates = conditions.map((condition) =>
                      compileStorageQueryCondition<TDomain>(condition)
                    )
                    return scopedQuerySource(
                      current,
                      selection,
                      onRead,
                      orderedSource,
                      physicalIds,
                      (value) => predicates.every((predicate) => predicate(value))
                    )
                  },
                  accept: async (_key, value) => {
                    const id = idOf(name, keyProp, value as TDomain, store.backend)
                    const physicalId = physicalIds.get(encodeFlatStorageKey(id))
                    if (physicalId === undefined)
                      throw new StorageError(StorageErrorCode.invalidConfig, {
                        backend: store.backend,
                        cause: new TypeError(EntityText.queryIdentityChanged)
                      })
                    /** Count only rows still present in this same draft after selection callbacks. */
                    const raw =
                      (await current.getRecord(composeRepositoryKey(name, physicalId))) ??
                      (await current.getRecord(composeStructuredKey(name, physicalId)))
                    if (raw === undefined) return false
                    if (request.operation === RecordQueryMethod.delete)
                      await bindRepository(current).remove(physicalId)
                    else
                      await bindRepository(current, physicalId).put({
                        ...(value as TDomain),
                        ...request.patch
                      })
                    return true
                  }
                })
              } finally {
                physicalIds.clear()
              }
            })
          return scope === undefined
            ? recordStore.transaction(apply, { ...request.ctx, concurrency: request.concurrency })
            : apply(scope)
        },
        execute: ({ ctx, conditions, selection: planned }) => {
          const selection = {
            ...((planned as IEntityQuerySourceSelection<TDomain> | undefined) ?? selectedSource),
            onInvalid: (openingSelection ?? selectedSource).onInvalid
          }
          const predicates = conditions.map((condition) =>
            compileStorageQueryCondition<TDomain>(condition)
          )
          const accepts = (value: TDomain) => predicates.every((predicate) => predicate(value))
          const counter = queryStages === undefined ? undefined : { readCount: 0 }
          opened = counter
          const onRead =
            counter === undefined
              ? undefined
              : () => {
                  counter.readCount++
                }
          const orderedSource = openingPlan?.hasOrder !== true
          if (scope !== undefined)
            return scopedQuerySource(scope, selection, onRead, orderedSource, undefined, accepts)
          const context = snapshotOperationContext(ctx)
          const runtime = createStorageOperationRuntime()
          return entityIterator(
            (async function* () {
              if (selection.index !== undefined) {
                const snapshot = createIndexedListSnapshot(selection.index, selection.range, {
                  onInvalid: selection.onInvalid
                })
                for await (const [id, row] of indexRows(
                  snapshot,
                  context,
                  undefined,
                  orderedSource,
                  onRead
                ))
                  if (accepts(row.value)) yield [[row.key, id], row.value] as const
              } else {
                for await (const value of streamImpl(
                  { range: selection.range, onInvalid: selection.onInvalid },
                  context,
                  runtime,
                  orderedSource,
                  undefined,
                  onRead
                ))
                  if (accepts(value))
                    yield [[idOf(name, keyProp, value, store.backend)], value] as const
              }
            })(),
            runtime
          )
        }
      })
    })
  }

  /** Per-repository final changes belong to one authentic original transaction identity. */
  const uniqueStates = new WeakMap<ITransactionInfo, WeakRef<Map<string, IEntityUniqueMutation>>>()
  const bindRepository = (
    scope: ITransactionScope,
    expectedIdentity?: IStorageKey
  ): IEntityTransactionScope<TDomain, TIndexes, TAugmentMethods> => {
    const info = backend.assertScope(scope)
    let stateReference = uniqueStates.get(info)
    if (uniqueDefinitions.length !== 0 && stateReference?.deref() === undefined) {
      const changes = new Map<string, IEntityUniqueMutation>()
      stateReference = new WeakRef(changes)
      uniqueStates.set(info, stateReference)
      registerTransactionFinalizer(scope, async (check) => {
        try {
          await validateUniqueRecordCommit(
            check,
            changes,
            readTransactionOperationContext(check),
            entityRuntime(check)
          )
        } finally {
          changes.clear()
          uniqueStates.delete(info)
        }
      })
    }
    /**
     * The original finalizer owns strong state while active; saved endpoints keep only this weak
     * reference.
     */
    const activeChanges = stateReference
    return {
      query: () => queryFor<undefined>(scope),
      get: (id: IStorageKey) =>
        runTransactionOperation(scope, async (current) => {
          backend.assertScope(current)
          const context = readTransactionOperationContext(current)
          assertStorageKey(id, store.backend)
          const runtime = entityRuntime(current)
          const raw =
            (await current.getRecord(composeRepositoryKey(name, id))) ??
            (await current.getRecord(composeStructuredKey(name, id)))
          return raw === undefined
            ? undefined
            : materializeForRead(id, await decodeEnvelope(raw, context, runtime), context, runtime)
        }),
      put: (value: TDomain) =>
        runTransactionOperation(scope, async (current) => {
          backend.assertScope(current)
          const context = readTransactionOperationContext(current)
          const runtime = entityRuntime(current)
          const prepared = await toEnvelope(value, context, runtime)
          const id = idOf(name, keyProp, prepared.domain, store.backend)
          /** Query patches cannot move a physical record or overwrite another entity identity. */
          if (expectedIdentity !== undefined && compareStorageKeys(id, expectedIdentity) !== 0)
            throw new StorageError(StorageErrorCode.invalidConfig, {
              backend: store.backend,
              cause: new TypeError(EntityText.queryIdentityChanged)
            })
          const raw = await encodeEnvelope(prepared.envelope, context, runtime)
          /** A historical repository handle is usable only after this native snapshot confirms it. */
          const handle =
            readyHandle !== undefined && (await current.isRecordIndexReady?.(readyHandle))
              ? readyHandle
              : undefined
          if (handle !== undefined && current.putIndexedRecord !== undefined)
            await current.putIndexedRecord(
              raw,
              composeRepositoryKey(name, id),
              handle,
              projectEntityIndexes(config.indexes, prepared.domain, store.backend),
              { conflictPolicy: 'replace' }
            )
          else
            await current.putRecord(raw, composeRepositoryKey(name, id), {
              conflictPolicy: 'replace'
            })
          await current.deleteRecord(composeStructuredKey(name, id))
          activeChanges
            ?.deref()!
            .set(encodeFlatStorageKey(id), { id, projection: projectUniqueWrite(prepared.domain) })
          return id
        }),
      remove: (id: IStorageKey) =>
        runTransactionOperation(scope, async (current) => {
          backend.assertScope(current)
          assertStorageKey(id, store.backend)
          await current.deleteRecord(composeRepositoryKey(name, id))
          await current.deleteRecord(composeStructuredKey(name, id))
          activeChanges?.deref()!.set(encodeFlatStorageKey(id), { id, projection: undefined })
        }),
      list: (options?: IListSnapshot<TDomain> | IIndexedListOptions<TDomain, TIndexes>) =>
        runTransactionOperation(scope, async (current) => {
          backend.assertScope(current)
          const context = readTransactionOperationContext(current)
          /** Metadata probes never build indexes or poison this transaction on a stale generation. */
          const handle =
            readyHandle !== undefined && (await current.isRecordIndexReady?.(readyHandle))
              ? readyHandle
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
          const indexed = snapshotIndexedListOptions(options)
          const normalized = indexed?.options ?? normalizeListOptions(options)
          const counter = queryStages === undefined ? undefined : { readCount: 0 }
          const onRead =
            counter === undefined
              ? undefined
              : () => {
                  counter.readCount++
                }
          const query =
            indexed === undefined
              ? listQuery(normalized, context, entityRuntime(current), view, onRead)
              : createIndexQuery(indexed, context, view, onRead)
          return observeQueryRead(
            () => query.all(context),
            {
              hasWhere: false,
              hasOrder: (normalized?.orderBy ?? defaultOrderBy) !== undefined,
              hasLimit: normalized?.limit !== undefined
            },
            { index: indexed?.index },
            current,
            () => counter,
            (values) => values.length
          )
        })
    }
  }

  const repository: IRepository<TDomain, TIndexes, TChangeFeed, TAugmentMethods> = {
    // Runtime source.watch is installed only for the genuine native feed captured above.
    query: () =>
      queryFor<IOperationContext>() as ReturnType<
        IRepository<TDomain, TIndexes, TChangeFeed, TAugmentMethods>['query']
      >,
    get: async (id, ctx) => {
      const context = snapshotOperationContext(ctx)
      const runtime = createStorageOperationRuntime()
      assertStorageKey(id, store.backend, `entity "${name}" id`)
      return materializeForRead(id, await readEnvelope(id, context, runtime), context, runtime)
    },

    put: async (value, ctx) => {
      if (recordStore !== undefined)
        return recordStore.transaction((scope) => bindRepository(scope).put(value), ctx)
      if (uniqueDefinitions.length !== 0 && getBackendValueCommit(store) === undefined)
        throw new StorageContractError(StorageContractErrorCode.unsupported, {
          backend: store.backend
        })
      const context = snapshotOperationContext(ctx)
      const runtime = createStorageOperationRuntime()
      const prepared = await toEnvelope(value, context, runtime)
      const id = idOf(name, keyProp, prepared.domain, store.backend)
      if (uniqueDefinitions.length > 0)
        await writeUniqueValue(id, prepared.domain, prepared.envelope, context)
      else
        await writeEnvelopeAt(
          { flatKey: composeFlatKey(name, id) },
          prepared.envelope,
          context,
          runtime
        )
      return id
    },
    remove: async (id, ctx) => {
      if (recordStore !== undefined)
        return recordStore.transaction((scope) => bindRepository(scope).remove(id), ctx)
      assertStorageKey(id, store.backend)
      await store.remove(composeFlatKey(name, id), ctx)
    },

    list: async (options, ctx) => {
      const indexed = snapshotIndexedListOptions(options)
      const normalized = indexed?.options ?? normalizeListOptions(options)
      const context = snapshotOperationContext(ctx)
      const counter = queryStages === undefined ? undefined : { readCount: 0 }
      const onRead =
        counter === undefined
          ? undefined
          : () => {
              counter.readCount++
            }
      const query =
        indexed === undefined
          ? listQuery(normalized, context, createStorageOperationRuntime(), undefined, onRead)
          : createIndexQuery(indexed, context, undefined, onRead)
      return observeQueryRead(
        () => query.all(context),
        {
          hasWhere: false,
          hasOrder: (normalized?.orderBy ?? defaultOrderBy) !== undefined,
          hasLimit: normalized?.limit !== undefined
        },
        { index: indexed?.index },
        undefined,
        () => counter,
        (values) => values.length
      )
    },
    stream: (options, ctx) => {
      const indexed = snapshotIndexedListOptions(options)
      const normalized = indexed?.options ?? normalizeListOptions(options)
      const context = snapshotOperationContext(ctx)
      const counter = queryStages === undefined ? undefined : { readCount: 0 }
      const onRead =
        counter === undefined
          ? undefined
          : () => {
              counter.readCount++
            }
      const query =
        indexed === undefined
          ? listQuery(normalized, context, createStorageOperationRuntime(), undefined, onRead)
          : createIndexQuery(indexed, context, undefined, onRead)
      return observeQueryStream(
        query.stream(context),
        {
          hasWhere: false,
          hasOrder: (normalized?.orderBy ?? defaultOrderBy) !== undefined,
          hasLimit: normalized?.limit !== undefined
        },
        { index: indexed?.index },
        counter
      )
    },

    findBy: async (index, key, ctx) => {
      assertStorageKey(key, store.backend, `entity "${name}" index query`)
      const context = snapshotOperationContext(ctx)
      const snapshot = createIndexedListSnapshot(index, { lower: key, upper: key }, undefined)
      let matched = 0
      const runtime = createStorageOperationRuntime()
      /** One source scan caps its diagnostic count while the original heap retains one result. */
      const source = createRecordQuery<IMatch>({
        asyncDisposeKey,
        pushdown: { source: EntityState.querySource, operations: [], operators: [] },
        execute: () =>
          entityIterator(
            (async function* () {
              for await (const row of indexRows(snapshot, context, undefined, false)) {
                if (matched < 2) matched++
                yield row
              }
            })(),
            runtime
          )
      })
      const [best] = await source
        .orderByComparator((left, right) => {
          let compared = 0
          if (defaultOrderBy !== undefined) {
            try {
              compared = defaultOrderBy(left.value, right.value)
              if (!Number.isFinite(compared)) {
                observeThenableRejection(compared, inspectThenable(compared), runtime.reporter)
                throw new TypeError(StorageErrorText.entityComparatorInvalid)
              }
            } catch (cause) {
              throw new StorageError(StorageErrorCode.extensionFailed, {
                backend: store.backend,
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
      const definition = config.indexes[index]?.definition
      if (definition !== undefined && !definition.unique && matched === 2)
        emitDiagnostic(
          EntityText.storageWebEntityFindByOnNonUniqueIndexReturnedTheFirst(name, index)
        )
      return best?.value
    },

    migrate: async (options: IMigrateOptions<TDomain> = {}, ctx) => {
      if (
        recordStore === undefined &&
        uniqueDefinitions.length !== 0 &&
        getBackendValueCommit(store) === undefined
      )
        throw new StorageContractError(StorageContractErrorCode.unsupported, {
          backend: store.backend
        })
      const context = snapshotOperationContext(ctx)
      const runtime = createStorageOperationRuntime()
      const { batchSize, onInvalid } = normalizeMigrateOptions(options)
      const migrationMetadata = recordStore?.metadata
      const checkpointKey = repositoryMigrationKey(name)
      type IMigrationCheckpoint = {
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
      const writeCheckpoint = async (value: unknown): Promise<void> => {
        if (migrationMetadata) await migrationMetadata.set(checkpointKey, value, context)
      }
      const checkpoint = (await migrationMetadata?.get(checkpointKey, context)) as
        | IMigrationCheckpoint
        | undefined
      const checkpointMatches =
        checkpoint?.status === StorageMigrationStatus.running &&
        checkpoint.version === version &&
        checkpoint.schemaFingerprint === migrationFingerprint
      let scanned = checkpointMatches ? checkpoint.scanned : 0
      let migrated = checkpointMatches ? checkpoint.migrated : 0
      let eligible = checkpointMatches ? checkpoint.eligible : 0
      let alreadyCurrent = checkpointMatches ? checkpoint.alreadyCurrent : 0
      let skipped = checkpointMatches ? checkpoint.skipped : 0
      let conflicted = checkpointMatches ? checkpoint.conflicted : 0
      let lastPhysicalKey = checkpointMatches ? checkpoint.lastPhysicalKey : undefined
      let phase = checkpointMatches
        ? (checkpoint.phase ?? StorageMigrationPhase.legacy)
        : StorageMigrationPhase.v2
      const batch: Array<{
        readonly physicalKey: IStorageKey
        readonly raw: unknown
        readonly id: IStorageKey
        readonly legacy: boolean
        readonly migrationRequired: boolean
        readonly value: TDomain | undefined
      }> = []
      const persistBatch = async (): Promise<void> => {
        if (batch.length === 0) return
        if (!recordStore) {
          for (const entry of batch) {
            const prepared = await toEnvelope(entry.value!, context, runtime)
            const nextKey = composeFlatKey(name, entry.id)
            if (uniqueDefinitions.length > 0)
              await writeUniqueValue(entry.id, prepared.domain, prepared.envelope, context)
            else await writeEnvelopeAt({ flatKey: nextKey }, prepared.envelope, context, runtime)
          }
          migrated += batch.length
        } else {
          let indexedStore: IEntitySecondaryMethods | undefined
          let indexedHandle: IRecordIndexHandle | undefined
          try {
            indexedStore =
              Object.keys(config.indexes).length > 0 ? backend.secondaryStore() : undefined
            /** Materialize the transaction's current snapshot once, not the earlier scan value. */
            const executeMigrationBatch = async (tx: ITransactionScope, indexed: boolean) => {
              /**
               * Publish counts only after this transaction commits, including invalid-record
               * policy.
               */
              const transactionContext = readTransactionOperationContext(tx)
              const currentIndexed =
                indexed &&
                indexedHandle !== undefined &&
                (await tx.isRecordIndexReady?.(indexedHandle)) === true
              const counts = { migrated: 0, alreadyCurrent: 0, skipped: 0, invalidEligible: 0 }
              /**
               * Written rows supply prepared projections; unchanged rows use the transactional
               * view.
               */
              const uniqueChanges = new Map<string, IEntityUniqueMutation>()
              for (const entry of batch) {
                /** Every write is derived from a read tracked by this transaction. */
                const currentRaw = await tx.getRecord(entry.physicalKey)
                if (currentRaw === undefined) continue
                if (entry.legacy) {
                  /** An authoritative current-layout record wins over an obsolete legacy copy. */
                  const existingTarget = await tx.getRecord(composeRepositoryKey(name, entry.id))
                  if (existingTarget !== undefined) {
                    await tx.deleteRecord(entry.physicalKey)
                    continue
                  }
                }
                /** Keep decoding/migration failures under the existing per-record invalid policy. */
                let currentValue: TDomain | undefined
                try {
                  /** A concurrent current-version update must not be rewritten by this migration. */
                  const currentEnvelope = await decodeEnvelope(
                    currentRaw,
                    transactionContext,
                    runtime
                  )
                  if (!entry.legacy && currentEnvelope.version >= version) {
                    counts.alreadyCurrent += 1
                    continue
                  }
                  currentValue = await materialize(currentEnvelope, transactionContext, runtime)
                } catch (cause) {
                  /** The issue reports the actual transactional value, not stale scan data. */
                  const issue: IInvalidRecordIssue<TDomain> = {
                    key: entry.id,
                    raw: currentRaw,
                    stage: (cause as Partial<IStageFailure>).stage ?? StorageRecordStage.decode,
                    cause
                  }
                  if (invokeInvalidHandler(onInvalid, issue) === StorageInvalidRecordAction.throw)
                    throwInvalid(issue)
                  counts.skipped += 1
                  if (entry.migrationRequired) counts.invalidEligible += 1
                  continue
                }
                if (currentValue === undefined) {
                  if (entry.migrationRequired) counts.invalidEligible += 1
                  continue
                }
                /** Preparation retains the existing write-side schema/codec validation boundary. */
                const prepared = await toEnvelope(currentValue, transactionContext, runtime)
                /** Native and fallback paths write the same current envelope. */
                const raw = await encodeEnvelope(prepared.envelope, transactionContext, runtime)
                if (
                  currentIndexed &&
                  indexedHandle !== undefined &&
                  tx.putIndexedRecord !== undefined
                )
                  await tx.putIndexedRecord(
                    raw,
                    composeRepositoryKey(name, entry.id),
                    indexedHandle,
                    projectEntityIndexes(config.indexes, prepared.domain, store.backend),
                    { conflictPolicy: 'replace' }
                  )
                else
                  await tx.putRecord(raw, composeRepositoryKey(name, entry.id), {
                    conflictPolicy: 'replace'
                  })
                if (entry.legacy) await tx.deleteRecord(entry.physicalKey)
                if (!currentIndexed && uniqueDefinitions.length > 0)
                  uniqueChanges.set(encodeFlatStorageKey(entry.id), {
                    id: entry.id,
                    projection: projectUniqueWrite(prepared.domain)
                  })
                if (entry.migrationRequired) counts.migrated += 1
              }
              if (!currentIndexed)
                await validateUniqueRecordCommit(tx, uniqueChanges, transactionContext, runtime)
              return counts
            }
            if (indexedStore !== undefined) {
              indexedHandle = await indexedStore.ensureRecordIndexes(
                name,
                Object.values(config.indexes).map((index) => index.definition),
                context
              )
              const readiness = await indexedStore.getRecordIndexReadiness(indexedHandle, context)
              if (readiness.status !== 'complete') indexedHandle = undefined
            }
            /** One callback owns migration semantics; backend adapters only supply their scope. */
            const batchOutcome = await recordStore.transaction(
              (tx) => executeMigrationBatch(tx, indexedHandle !== undefined),
              context
            )
            migrated += batchOutcome.migrated
            alreadyCurrent += batchOutcome.alreadyCurrent
            skipped += batchOutcome.skipped
            eligible -= batchOutcome.invalidEligible
          } catch (cause) {
            if (
              isStorageContractError(cause) &&
              cause.code === StorageContractErrorCode.writeConflict
            ) {
              for (const entry of batch) {
                try {
                  const retryRun = async (tx: ITransactionScope) => {
                    const retryContext = readTransactionOperationContext(tx)
                    const currentIndexed =
                      indexedHandle !== undefined &&
                      (await tx.isRecordIndexReady?.(indexedHandle)) === true
                    const targetRaw = await tx.getRecord(composeRepositoryKey(name, entry.id))
                    if (targetRaw !== undefined) {
                      const targetEnvelope = await decodeEnvelope(targetRaw, retryContext, runtime)
                      if (targetEnvelope.version >= version) {
                        if (entry.legacy) await tx.deleteRecord(entry.physicalKey)
                        return 'alreadyCurrent' as const
                      }
                    }
                    const currentRaw = await tx.getRecord(entry.physicalKey)
                    if (currentRaw === undefined) return 'missing' as const
                    const currentEnvelope = await decodeEnvelope(currentRaw, retryContext, runtime)
                    const currentValue = await materialize(currentEnvelope, retryContext, runtime)
                    if (currentValue === undefined) return 'missing' as const
                    if (currentEnvelope.version >= version) return 'alreadyCurrent' as const
                    const prepared = await toEnvelope(currentValue, retryContext, runtime)
                    const nextRaw = await encodeEnvelope(prepared.envelope, retryContext, runtime)
                    if (
                      currentIndexed &&
                      indexedHandle !== undefined &&
                      tx.putIndexedRecord !== undefined
                    )
                      await tx.putIndexedRecord(
                        nextRaw,
                        composeRepositoryKey(name, entry.id),
                        indexedHandle,
                        projectEntityIndexes(config.indexes, prepared.domain, store.backend),
                        { conflictPolicy: 'replace' }
                      )
                    else
                      await tx.putRecord(nextRaw, composeRepositoryKey(name, entry.id), {
                        conflictPolicy: 'replace'
                      })
                    if (entry.legacy) await tx.deleteRecord(entry.physicalKey)
                    if (!currentIndexed)
                      await validateUniqueRecordCommit(
                        tx,
                        new Map([
                          [
                            encodeFlatStorageKey(entry.id),
                            {
                              id: entry.id,
                              projection: projectEntityIndexes(
                                uniqueIndexes,
                                prepared.domain,
                                store.backend
                              )
                            }
                          ]
                        ]),
                        retryContext,
                        runtime
                      )
                    return 'migrated' as const
                  }
                  const retryOutcome = await recordStore.transaction(retryRun, context)
                  if (retryOutcome === 'migrated') migrated += 1
                  if (retryOutcome === 'alreadyCurrent') alreadyCurrent += 1
                } catch (retryCause) {
                  if (
                    isStorageContractError(retryCause) &&
                    retryCause.code === StorageContractErrorCode.writeConflict
                  ) {
                    conflicted += 1
                    continue
                  }
                  throw normalizeError(
                    retryCause,
                    store.backend,
                    StorageErrorCode.transactionFailed,
                    'entity.migrate'
                  )
                }
              }
            } else {
              throw normalizeError(
                cause,
                store.backend,
                StorageErrorCode.transactionFailed,
                'entity.migrate'
              )
            }
          }
        }
        await writeCheckpoint({
          status: StorageMigrationStatus.running,
          phase,
          version,
          schemaFingerprint: migrationFingerprint,
          lastPhysicalKey,
          scanned,
          eligible,
          migrated,
          skipped,
          alreadyCurrent,
          conflicted
        })
        batch.length = 0
      }
      if (recordStore) {
        const phases =
          phase === StorageMigrationPhase.v2
            ? [StorageMigrationPhase.v2, StorageMigrationPhase.legacy]
            : [StorageMigrationPhase.legacy]
        for (const scanPhase of phases) {
          phase = scanPhase
          if (
            scanPhase !==
            (checkpointMatches
              ? (checkpoint.phase ?? StorageMigrationPhase.legacy)
              : StorageMigrationPhase.v2)
          )
            lastPhysicalKey = undefined
          const entityRange = repositoryEntityRange(name)
          const migrationRange =
            scanPhase === StorageMigrationPhase.v2
              ? lastPhysicalKey
                ? { ...entityRange, lower: lastPhysicalKey, lowerOpen: true }
                : entityRange
              : lastPhysicalKey
                ? { lower: lastPhysicalKey, lowerOpen: true }
                : undefined
          for await (const [physicalKey, raw] of recordStore.iterateRecords(
            migrationRange,
            context
          )) {
            lastPhysicalKey = physicalKey
            const v2RecordId = decodeRepositoryKey(name, physicalKey)
            const legacy =
              v2RecordId === undefined &&
              Array.isArray(physicalKey) &&
              physicalKey.length === 2 &&
              physicalKey[0] === name
            const recordId = v2RecordId ?? (legacy ? (physicalKey[1] as IStorageKey) : undefined)
            if (scanPhase === StorageMigrationPhase.v2 && v2RecordId === undefined) continue
            if (scanPhase === StorageMigrationPhase.legacy && !legacy) continue
            if (recordId === undefined) continue
            scanned += 1
            let envelope: IEnvelope
            try {
              envelope = await decodeEnvelope(raw, context, runtime)
              /** Eligible records are materialized only under the commit transaction's read set. */
              const value =
                envelope.version >= version
                  ? await materialize(envelope, context, runtime)
                  : undefined
              if (envelope.version >= version && value === undefined) continue
              if (envelope.version >= version) {
                alreadyCurrent += 1
                // A current-version legacy envelope still requires physical relocation before
                // migration completion can prove that entity queries may stop scanning legacy.
                if (legacy)
                  batch.push({
                    physicalKey,
                    raw,
                    id: recordId,
                    legacy,
                    migrationRequired: false,
                    value
                  })
                continue
              }
              eligible += 1
              batch.push({
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
              const action = invokeInvalidHandler(onInvalid, issue)
              if (action === StorageInvalidRecordAction.throw) throwInvalid(issue)
              skipped += 1
            }
            if (batch.length >= batchSize) await persistBatch()
          }
          if (scanPhase === StorageMigrationPhase.v2 && phases.length > 1) {
            phase = StorageMigrationPhase.legacy
            lastPhysicalKey = undefined
            await writeCheckpoint({
              status: StorageMigrationStatus.running,
              phase,
              version,
              schemaFingerprint: migrationFingerprint,
              scanned,
              eligible,
              migrated,
              skipped,
              alreadyCurrent,
              conflicted
            })
          }
        }
      } else {
        const prefix = flatKeyPrefix(name)
        /** Migration traverses the same canonical ordered structure without a second sorting path. */
        const keys = createOrderedRecordIndex<{
          readonly rawKey: string
          readonly id: IStorageKey
        }>()
        for (const rawKey of await store.keys(context)) {
          if (!rawKey.startsWith(prefix)) continue
          const id = decodeFlatStorageKey(rawKey.slice(prefix.length))
          if (id !== undefined) keys.set(encodeOrderedStorageKey(id, store.backend), { rawKey, id })
        }
        for (const {
          value: { rawKey, id }
        } of keys.range()) {
          const raw = await store.get(rawKey, context)
          if (raw === null) continue
          scanned += 1
          try {
            const envelope = await decodeEnvelope(raw, context, runtime)
            const value = await materialize(envelope, context, runtime)
            if (value === undefined) continue
            if (envelope.version >= version) {
              alreadyCurrent += 1
              continue
            }
            eligible += 1
            batch.push({
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
            const action = invokeInvalidHandler(onInvalid, issue)
            if (action === StorageInvalidRecordAction.throw) throwInvalid(issue)
            skipped += 1
          }
          if (batch.length >= batchSize) await persistBatch()
        }
      }
      await persistBatch()
      await writeCheckpoint({
        status: StorageMigrationStatus.complete,
        phase,
        version,
        schemaFingerprint: migrationFingerprint,
        lastPhysicalKey,
        scanned,
        eligible,
        migrated,
        skipped,
        alreadyCurrent,
        conflicted
      })
      return { scanned, eligible, migrated, skipped, alreadyCurrent, conflicted }
    },

    in: (scope) => bindRepository(scope),
    lockKey: (id) => {
      assertStorageKey(id, store.backend)
      return records
        ? lockKey.record(composeRepositoryKey(name, id))
        : lockKey.text(composeFlatKey(name, id))
    },
    batch: (run, ctx) => {
      if (typeof run !== 'function')
        return Promise.reject(
          new StorageError(StorageErrorCode.invalidConfig, {
            backend: store.backend,
            cause: new TypeError(EntityText.batchCallbackMustBeAFunction)
          })
        )
      if (recordStore === undefined)
        return Promise.reject(
          new StorageContractError(StorageContractErrorCode.unsupported, { backend: store.backend })
        )
      return recordStore.transaction((scope) => run(bindRepository(scope)), ctx)
    }
  }
  return repository
}
