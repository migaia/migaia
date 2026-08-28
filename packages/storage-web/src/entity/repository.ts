import {
  StorageContractError,
  StorageContractErrorCode,
  isKeyValueStore,
  isSecondaryIndexRecordStore,
  isStorageContractError,
  type IRecordIndexHandle,
  type IRecordIndexProjection,
  type ISecondaryIndexRecordStore
} from '@migaia/storage-contract'
import { isStorageErrorFamily } from '../core/error-family.js'
import { isRecordStore } from '../types/storage.js'
import { StorageError, StorageErrorCode } from '../types/errors.js'
import { indexBackfillFailureText } from '../error-text.js'
import { runMigrationsWithRuntime } from '../schema/migrate.js'
import { selectCodec } from '../serialize/registry.js'
import { jsonCodec } from '../serialize/json.js'
import { structuredCodec } from '../serialize/structured.js'
import {
  composeFlatKey,
  composeRepositoryKey,
  composeStructuredKey,
  decodeRepositoryKey,
  flatKeyPrefix,
  repositoryMigrationKey,
  repositoryEntityRange
} from './key.js'
import {
  assertStorageKey,
  compareStorageKeys,
  decodeFlatStorageKey,
  encodeFlatStorageKey,
  snapshotKeyRange
} from '../core/key-domain.js'
import { isStorageKeyInRange } from '../core/query.js'
import { invokeExtension, normalizeError } from '../core/errors.js'
import {
  createStorageOperationRuntime,
  type IStorageOperationRuntime
} from '../core/operation-reporter.js'
import { snapshotOperationContext } from '../core/operation.js'
import type { IOperationContext, IStorageKey } from '../types/context.js'
import type { IRecordStore, IKeyValueStore } from '../types/storage.js'
import type { ISchemaAdapter } from '../schema/types.js'
import type { IMigration } from '../schema/migrate.js'
import type { ICodec } from '../serialize/types.js'
import type { ISelectedCodec } from '../serialize/registry.js'
import type {
  IEntityTransactionScope,
  IIndexedListOptions,
  IInvalidRecordHandler,
  IListOptions,
  IInvalidRecordAction,
  IInvalidRecordIssue,
  IMigrateOptions,
  IRepository
} from './types.js'
import type { ISnapshotEntityIndexes } from './index-projection.js'
import { projectEntityIndexes } from './index-projection.js'
import { safeJsonPayloadByteLength } from '../utils/json.js'
import {
  asIndexedDbBackfillStore,
  IndexedDbBackfillPhase,
  isBackfillContentionFailure,
  type IIndexedDbBackfillPreparation
} from '../backends/indexed-db-backfill.js'
import {
  StorageMigrationPhase,
  StorageMigrationStatus,
  StorageInvalidRecordAction,
  StorageOperation,
  StorageRecordStage,
  type IStorageRecordStage
} from '../constants.js'

type IEnvelope = { readonly __v: number; readonly data: unknown }
type IStageFailure = Error & {
  readonly stage: IStorageRecordStage
  readonly cause: unknown
}

type IWriteTarget = { readonly documentKey?: IStorageKey; readonly flatKey?: string }
type IEntityRetryTransactionScope = {
  get(key: IStorageKey): Promise<unknown | undefined>
  put(value: unknown, key: IStorageKey, projection?: IRecordIndexProjection): Promise<IStorageKey>
  delete(key: IStorageKey): Promise<void>
}

/* c8 ignore start -- defensive stage wrapping is exercised through the public error assertions. */
const stageFailure = (stage: IStageFailure['stage'], cause: unknown): IStageFailure => {
  /* c8 ignore next -- all current extension boundaries normalize to StorageError; retain a defensive path for future callers. */
  if (cause instanceof StorageError) {
    const staged = new StorageError(
      cause.code,
      {
        backend: cause.backend,
        key: cause.key,
        existingChannel: cause.existingChannel,
        attemptedChannel: cause.attemptedChannel,
        operation: cause.operation,
        extensionStage: cause.extensionStage,
        cause: cause.cause ?? cause
      },
      cause.message,
      stage
    ) as unknown as IStageFailure
    return staged
  }
  if (isStorageContractError(cause)) return cause as unknown as IStageFailure
  const error = new Error(String(cause)) as IStageFailure
  Object.defineProperties(error, {
    stage: { value: stage, enumerable: true },
    cause: { value: cause, enumerable: true }
  })
  return error
}
/* c8 ignore stop */

const validateLimit = (limit: number | undefined, backend: IKeyValueStore['backend']): void => {
  if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 0))
    throw new StorageError(StorageErrorCode.invalidConfig, {
      backend,
      cause: new RangeError('list limit must be a non-negative safe integer')
    })
}

const validateOrderBy = (orderBy: unknown, backend: IKeyValueStore['backend']): void => {
  if (orderBy !== undefined && typeof orderBy !== 'function')
    throw new StorageError(StorageErrorCode.invalidConfig, {
      backend,
      cause: new TypeError('list orderBy must be a function')
    })
}

const validateListOptions = (options: unknown, backend: IKeyValueStore['backend']): void => {
  if (
    options !== undefined &&
    (typeof options !== 'object' || options === null || Array.isArray(options))
  )
    throw new StorageError(StorageErrorCode.invalidConfig, {
      backend,
      cause: new TypeError('list options must be an object')
    })
}

const BACKEND_KINDS = new Set(['local', 'session', 'cookie', 'indexeddb', 'memory'])

/** Reject foreign objects before capability selection can dereference an incomplete store. */
const assertKeyValueStore: (store: unknown) => asserts store is IKeyValueStore = (store) => {
  if (isKeyValueStore(store)) return
  if (typeof store !== 'object' || store === null || Array.isArray(store)) {
    throw new StorageError(StorageErrorCode.invalidConfig, {
      cause: new TypeError('entity store must be an object')
    })
  }
  const candidate = store as Record<string, unknown>
  const capabilities = candidate.capabilities as Record<string, unknown>
  const capabilityFlags = [
    'syncRead',
    'binary',
    'records',
    'transactions',
    'iteration',
    'opaqueEntries'
  ]
  if (
    typeof candidate.backend !== 'string' ||
    !BACKEND_KINDS.has(candidate.backend) ||
    typeof candidate.capabilities !== 'object' ||
    candidate.capabilities === null ||
    Array.isArray(candidate.capabilities) ||
    !capabilityFlags.every((flag) => typeof capabilities[flag] === 'boolean') ||
    (capabilities.maxValueBytes !== undefined &&
      (typeof capabilities.maxValueBytes !== 'number' ||
        !Number.isSafeInteger(capabilities.maxValueBytes) ||
        capabilities.maxValueBytes < 0)) ||
    !['get', 'set', 'remove', 'has', 'keys', 'clearValues', 'clearAll', 'dispose'].every(
      (method) => typeof candidate[method] === 'function'
    )
  )
    throw new StorageError(StorageErrorCode.invalidConfig, {
      cause: new TypeError('entity store does not implement the key-value store contract')
    })
}

export type IRepositoryConfig<TDomain, TStored> = {
  readonly name: string
  readonly key: Extract<keyof TDomain, string>
  readonly version: number
  readonly schema: ISchemaAdapter<TDomain, TStored>
  /** 未提供时按后端类型选默认值，见 createRepository。 */
  readonly codec: ICodec<unknown, unknown> | undefined
  readonly migrations: Record<number, IMigration> | undefined
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
      cause: new TypeError(`entity "${entityName}": missing storage key "${keyProp}"`)
    })
  assertStorageKey(id, backend, `entity "${entityName}" key "${keyProp}"`)
  return id
}

export const createRepository = <
  TDomain,
  TStored,
  TIndexes extends Readonly<Record<string, IStorageKey>> = Readonly<Record<never, IStorageKey>>
>(
  config: IRepositoryConfig<TDomain, TStored>,
  store: IKeyValueStore
): IRepository<TDomain, TIndexes> => {
  assertKeyValueStore(store)
  const {
    name,
    key: keyProp,
    version,
    schema,
    migrations,
    validateOnRead,
    onDiagnostic,
    defaultOrderBy
  } = config
  const records = isRecordStore(store)
  const recordStore = records ? (store as IRecordStore<unknown>) : undefined
  const emitDiagnostic = (message: string): void => {
    try {
      onDiagnostic(message)
    } catch {
      // Diagnostics are observational and cannot alter storage semantics.
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

  /** Drive backend-private projection migration without exposing its lease/checkpoint protocol. */
  const backfillIndexes = async (ctx?: IOperationContext): Promise<void> => {
    const capability = asIndexedDbBackfillStore<unknown>(store)
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
          prepare: async (candidate): Promise<IIndexedDbBackfillPreparation> => {
            await session.renew(ctx)
            const runtime = createStorageOperationRuntime()
            let domain: TDomain | undefined
            try {
              if (candidate.phase === IndexedDbBackfillPhase.legacy) {
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
                `[storage-web] entity "${name}" skipped invalid index backfill record ${String(candidate.key)}: ${String(cause)}`
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
            phase: batch.phase ?? IndexedDbBackfillPhase.canonical,
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
          (batch.phase ?? IndexedDbBackfillPhase.canonical) === IndexedDbBackfillPhase.legacy &&
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
        throw new AggregateError([cause, persistFailure], indexBackfillFailureText(name), {
          cause
        })
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
    Object.keys(migrations ?? {})
      .map(Number)
      .sort((left, right) => left - right)
      .join(',')
  ].join('|')

  const writeEnvelopeAt = async (
    target: IWriteTarget,
    envelope: IEnvelope,
    ctx: IOperationContext | undefined,
    runtime: IStorageOperationRuntime
  ): Promise<void> => {
    const raw = await encodeEnvelope(envelope, ctx, runtime)
    if (recordStore && target.documentKey !== undefined) {
      await recordStore.putRecord(raw, target.documentKey, ctx)
      return
    }
    if (target.flatKey !== undefined) {
      await store.set(target.flatKey, raw as string, ctx)
    }
  }

  /** Encode every repository write through one extension error boundary. */
  const encodeEnvelope = async (
    envelope: IEnvelope,
    ctx: IOperationContext | undefined,
    runtime: IStorageOperationRuntime
  ): Promise<unknown> =>
    invokeExtension(
      () => selectedCodec.encode(envelope, ctx),
      store.backend,
      'entity.codec.encode',
      'codec',
      ctx?.signal,
      runtime
    )

  const materialize = async (
    envelope: IEnvelope | undefined,
    ctx: IOperationContext | undefined,
    runtime: IStorageOperationRuntime
  ): Promise<TDomain | undefined> => {
    if (!envelope) return undefined
    if (envelope.__v > version)
      throw new StorageError(StorageErrorCode.versionUnsupported, {
        backend: store.backend,
        cause: new RangeError(`entity "${name}" requires version ${envelope.__v}`)
      })
    let stored = envelope.data
    if (envelope.__v < version) {
      try {
        stored = await runMigrationsWithRuntime(
          runtime,
          stored,
          envelope.__v,
          version,
          migrations,
          ctx?.signal
        )
      } catch (cause) {
        throw stageFailure('migrate', cause)
      }
    }
    let decoded: TDomain
    try {
      decoded = schema.decode
        ? await invokeExtension(
            () => schema.decode!(stored as TStored, ctx),
            store.backend,
            'entity.schema.decode',
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
        'entity.schema.validate',
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
    runtime: IStorageOperationRuntime
  ): Promise<{ readonly domain: TDomain; readonly envelope: IEnvelope }> => {
    const domain = await invokeExtension(
      () => schema.validate(value, ctx),
      store.backend,
      'entity.schema.validate',
      'schema',
      ctx?.signal,
      runtime
    )
    const normalized = schema.normalize
      ? await invokeExtension(
          () => schema.normalize!(domain, ctx),
          store.backend,
          'entity.schema.normalize',
          'schema',
          ctx?.signal,
          runtime
        )
      : domain
    const stored = schema.encode
      ? await invokeExtension(
          () => schema.encode!(normalized, ctx),
          store.backend,
          'entity.schema.encode',
          'schema',
          ctx?.signal,
          runtime
        )
      : (normalized as unknown as TStored)
    return { domain: normalized, envelope: { __v: version, data: stored } }
  }

  const decodeEnvelope = async (
    raw: unknown,
    ctx: IOperationContext | undefined,
    runtime: IStorageOperationRuntime
  ): Promise<IEnvelope> => {
    const decoded: unknown = await invokeExtension(
      () => selectedCodec.decode(raw, ctx),
      store.backend,
      'entity.codec.decode',
      'codec',
      ctx?.signal,
      runtime
    )
    if (
      typeof decoded !== 'object' ||
      decoded === null ||
      !Number.isSafeInteger((decoded as { __v?: unknown }).__v) ||
      (decoded as { __v: number }).__v < 0 ||
      !Object.hasOwn(decoded, 'data')
    )
      throw new StorageError(StorageErrorCode.deserializeFailed, {
        backend: store.backend,
        cause: new TypeError('invalid entity envelope')
      })
    return decoded as IEnvelope
  }

  /** Apply the invalid-record policy once so handler failures have one stable error boundary. */
  const invalidAction = (
    issue: IInvalidRecordIssue<TDomain>,
    option: IListOptions<TDomain> | undefined
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
        cause: new TypeError('onInvalid must be skip, throw, or a handler')
      })
  }

  /** Snapshot list options once so getters cannot change values after validation. */
  const normalizeListOptions = (
    options:
      | IListOptions<TDomain>
      | IIndexedListOptions<TDomain, Readonly<Record<string, IStorageKey>>>
      | undefined
  ): IListOptions<TDomain> | undefined => {
    validateListOptions(options, store.backend)
    if (options === undefined) return undefined
    let range: IListOptions<TDomain>['range']
    let limit: IListOptions<TDomain>['limit']
    let orderBy: IListOptions<TDomain>['orderBy']
    let direction: IListOptions<TDomain>['direction']
    let onInvalid: IListOptions<TDomain>['onInvalid']
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
        cause: new TypeError('list direction must be next or prev')
      })
    validateInvalidHandler(onInvalid)
    return Object.freeze({ range: rangeSnapshot, limit, orderBy, direction, onInvalid })
  }

  /** Immutable indexed-query input captured before any query route consumes it. */
  type IIndexedListSnapshot = {
    readonly index: string
    readonly range: IListOptions<TDomain>['range']
    readonly options: IListOptions<TDomain> | undefined
  }

  /** Read every indexed-list option once and convert it to a guarded snapshot. */
  const snapshotIndexedListOptions = (
    options:
      | IListOptions<TDomain>
      | IIndexedListOptions<TDomain, Readonly<Record<string, IStorageKey>>>
      | undefined
  ): IIndexedListSnapshot | undefined => {
    validateListOptions(options, store.backend)
    if (options === undefined) return undefined
    let index: unknown
    let range: IListOptions<TDomain>['range']
    let limit: IListOptions<TDomain>['limit']
    let orderBy: IListOptions<TDomain>['orderBy']
    let direction: IListOptions<TDomain>['direction']
    let onInvalid: IListOptions<TDomain>['onInvalid']
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
        cause: new TypeError('indexed list index must be a non-empty string')
      })
    const normalized = normalizeListOptions(
      Object.freeze({ range, limit, orderBy, direction, onInvalid })
    )
    return Object.freeze({ index, range: normalized?.range, options: normalized })
  }

  /** Build an indexed snapshot for the findManyBy/findBy/streamBy APIs. */
  const createIndexedListSnapshot = (
    index: string,
    range: IListOptions<TDomain>['range'],
    options:
      | IListOptions<TDomain>
      | IIndexedListOptions<TDomain, Readonly<Record<string, IStorageKey>>>
      | undefined
  ): IIndexedListSnapshot => {
    const normalized = normalizeListOptions(options)
    const rangeSnapshot = snapshotKeyRange(range, store.backend)
    return Object.freeze({ index, range: rangeSnapshot, options: normalized })
  }

  /** Snapshot migration options once before checkpoint or record work begins. */
  const normalizeMigrateOptions = (
    options: IMigrateOptions<TDomain>
  ): { readonly batchSize: number; readonly onInvalid: IMigrateOptions<TDomain>['onInvalid'] } => {
    if (options === null || typeof options !== 'object' || Array.isArray(options))
      throw new StorageError(StorageErrorCode.invalidConfig, {
        backend: store.backend,
        cause: new TypeError('migrate options must be an object')
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
        cause: new RangeError('migrate batchSize must be a positive safe integer')
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
        cause: new TypeError('onInvalid must be skip, throw, or a handler')
      })
    try {
      const action = handler(issue)
      if (action !== 'skip' && action !== 'throw')
        throw new StorageError(StorageErrorCode.invalidConfig, {
          backend: store.backend,
          key: issue.key,
          cause: new TypeError('onInvalid handler must return skip or throw')
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
    runtime: IStorageOperationRuntime
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
    runtime: IStorageOperationRuntime
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

  const sortRecords = (
    records: TDomain[],
    comparator: (left: TDomain, right: TDomain) => number
  ): void => {
    try {
      records.sort((left, right) => {
        const result = comparator(left, right)
        if (typeof result !== 'number' || Number.isNaN(result))
          throw new TypeError('entity orderBy comparator must return a number')
        return result
      })
    } catch (cause) {
      throw new StorageError(StorageErrorCode.extensionFailed, {
        backend: store.backend,
        cause,
        operation: StorageOperation.entityOrderBy,
        extensionStage: 'comparator'
      })
      /* c8 ignore stop */
    }
  }

  const streamImpl = async function* (
    options: IListOptions<TDomain> | undefined,
    ctx: IOperationContext | undefined,
    runtime: IStorageOperationRuntime,
    applyOrdering = true
  ) {
    const comparator = applyOrdering ? (options?.orderBy ?? defaultOrderBy) : undefined
    if (comparator) {
      const buffered: TDomain[] = []
      const scanOptions = { ...options, orderBy: undefined, limit: undefined }
      for await (const record of streamImpl(scanOptions, ctx, runtime, false)) buffered.push(record)
      sortRecords(buffered, comparator)
      const limited = options?.limit === undefined ? buffered : buffered.slice(0, options.limit)
      for (const record of limited) yield record
      return
    }
    if (recordStore) {
      const ranges: Array<ReturnType<typeof repositoryEntityRange> | undefined> = [
        repositoryEntityRange(name),
        undefined
      ]
      let count = 0
      const seenIds = new Set<string>()
      for (const range of ranges) {
        for await (const [physicalKey, raw] of recordStore.iterateRecords(range, ctx)) {
          const v2RecordId = decodeRepositoryKey(name, physicalKey)
          const recordId =
            v2RecordId ??
            (Array.isArray(physicalKey) && physicalKey.length === 2 && physicalKey[0] === name
              ? (physicalKey[1] as IStorageKey)
              : undefined)
          if (recordId === undefined) continue
          if (!isStorageKeyInRange(recordId, options?.range)) continue
          const identity = encodeFlatStorageKey(recordId)
          if (v2RecordId !== undefined) seenIds.add(identity)
          if (range === undefined) {
            if (!Array.isArray(physicalKey) || physicalKey.length !== 2 || physicalKey[0] !== name)
              continue
            if (seenIds.has(identity)) continue
          }
          let value: TDomain | undefined
          try {
            let envelope: IEnvelope
            try {
              envelope = await decodeEnvelope(raw, ctx, runtime)
            } catch (cause) {
              throw stageFailure('decode', cause)
            }
            value = await materialize(envelope, ctx, runtime)
          } catch (cause) {
            const issue: IInvalidRecordIssue<TDomain> = {
              key: recordId,
              raw,
              stage: (cause as Partial<IStageFailure>).stage ?? 'validate',
              cause
            }
            const action = invalidAction(issue, options)
            if (action === 'throw') throwInvalid(issue)
            emitDiagnostic(
              `[storage-web] entity "${name}" skipped invalid record ${String(recordId)}`
            )
            continue
          }
          if (value !== undefined) {
            yield value
            count += 1
            if (options?.limit !== undefined && count >= options.limit) return
          }
        }
      }
      return
    }
    emitDiagnostic(
      `[storage-web] entity "${name}".list/stream on a value-only backend performs a full key scan`
    )
    const prefix = flatKeyPrefix(name)
    const keys = (await store.keys(ctx))
      .filter((rawKey) => rawKey.startsWith(prefix))
      .map((rawKey) => ({ rawKey, id: decodeFlatStorageKey(rawKey.slice(prefix.length)) }))
      .filter((entry): entry is { rawKey: string; id: IStorageKey } => entry.id !== undefined)
      .sort((left, right) => compareStorageKeys(left.id, right.id))
    let count = 0
    for (const { rawKey, id } of keys) {
      if (!isStorageKeyInRange(id, options?.range)) continue
      const raw = await store.get(rawKey, ctx)
      if (raw === null) continue
      let value: TDomain | undefined
      try {
        let envelope: IEnvelope
        try {
          envelope = await decodeEnvelope(raw, ctx, runtime)
        } catch (cause) {
          throw stageFailure('decode', cause)
        }
        value = await materialize(envelope, ctx, runtime)
      } catch (cause) {
        const issue: IInvalidRecordIssue<TDomain> = {
          key: id,
          raw,
          stage: (cause as Partial<IStageFailure>).stage ?? 'validate',
          cause
        }
        const action = invalidAction(issue, options)
        if (action === 'throw') throwInvalid(issue)
        emitDiagnostic(`[storage-web] entity "${name}" skipped invalid record ${rawKey}`)
        continue
      }
      if (value !== undefined) {
        yield value
        count += 1
        if (options?.limit !== undefined && count >= options.limit) return
      }
    }
  }

  type IIndexedQueryMatch = {
    readonly id: IStorageKey
    readonly indexKey: IStorageKey
    readonly value: TDomain
  }

  /** Execute indexed queries through one projection/filter/order/limit owner. */
  const queryByIndex = async (
    snapshot: IIndexedListSnapshot,
    ctx: IOperationContext | undefined
  ): Promise<TDomain[]> => {
    const index = config.indexes[snapshot.index]
    if (index === undefined)
      throw new StorageError(StorageErrorCode.invalidConfig, {
        backend: store.backend,
        cause: new TypeError(`entity "${name}" index "${snapshot.index}" is not declared`)
      })
    const context = snapshotOperationContext(ctx)
    const normalized = snapshot.options
    const indexRange = snapshot.range
    const matches: IIndexedQueryMatch[] = []
    const seen = new Set<string>()
    const accept = (value: TDomain): void => {
      const id = idOf(name, keyProp, value, store.backend)
      const identity = encodeFlatStorageKey(id)
      if (seen.has(identity)) return
      const entry = index.project(value, store.backend)
      if (entry === undefined) return
      const keys = entry.kind === 'multiple' ? entry.keys : [entry.key]
      const matchingKeys = keys.filter((key) => isStorageKeyInRange(key, indexRange))
      if (matchingKeys.length === 0) return
      matchingKeys.sort(compareStorageKeys)
      seen.add(identity)
      matches.push({ id, indexKey: matchingKeys[0]!, value })
    }
    const capability = asIndexedDbBackfillStore<unknown>(store)
    if (capability !== undefined) {
      try {
        await backfillIndexes(context)
      } catch (cause) {
        if (!isBackfillContentionFailure(cause)) throw cause
      }
    }
    const nativeIndexStore =
      recordStore !== undefined && isSecondaryIndexRecordStore(recordStore)
        ? recordStore
        : undefined
    if (nativeIndexStore !== undefined && capability !== undefined) {
      const handle = await capability.ensureRecordIndexes(
        name,
        Object.values(config.indexes).map((entry) => entry.definition),
        context
      )
      const readiness = await capability.getRecordIndexReadiness(handle, context)
      if (readiness.status === 'complete') {
        const runtime = createStorageOperationRuntime()
        for await (const [recordKey, raw] of nativeIndexStore.iterateRecordIndex(
          {
            handle,
            index: snapshot.index,
            range: indexRange,
            direction: normalized?.direction
          },
          context
        )) {
          try {
            const envelope = await decodeEnvelope(raw, context, runtime)
            const value = await materialize(envelope, context, runtime)
            if (value !== undefined) accept(value)
          } catch (cause) {
            const issue: IInvalidRecordIssue<TDomain> = {
              key: recordKey,
              raw,
              stage: (cause as Partial<IStageFailure>).stage ?? 'validate',
              cause
            }
            const action = invalidAction(issue, normalized)
            if (action === 'throw') throwInvalid(issue)
            emitDiagnostic(
              `[storage-web] entity "${name}" skipped invalid indexed record ${String(recordKey)}`
            )
          }
        }
        const comparator = normalized?.orderBy ?? defaultOrderBy
        if (comparator) {
          try {
            matches.sort((left, right) => {
              const result = comparator(left.value, right.value)
              if (typeof result !== 'number' || Number.isNaN(result))
                throw new TypeError('entity orderBy comparator must return a number')
              if (result !== 0) return normalized?.direction === 'prev' ? -result : result
              const byIndex = compareStorageKeys(left.indexKey, right.indexKey)
              const ordered = byIndex === 0 ? compareStorageKeys(left.id, right.id) : byIndex
              return normalized?.direction === 'prev' ? -ordered : ordered
            })
          } catch (cause) {
            throw new StorageError(StorageErrorCode.extensionFailed, {
              backend: store.backend,
              cause,
              operation: StorageOperation.entityOrderBy,
              extensionStage: 'comparator'
            })
          }
        } else {
          matches.sort((left, right) => {
            const byIndex = compareStorageKeys(left.indexKey, right.indexKey)
            const ordered = byIndex === 0 ? compareStorageKeys(left.id, right.id) : byIndex
            return normalized?.direction === 'prev' ? -ordered : ordered
          })
        }
        const values = matches.map((match) => match.value)
        return normalized?.limit === undefined ? values : values.slice(0, normalized.limit)
      }
    }
    emitDiagnostic(
      `[storage-web] entity "${name}" index "${snapshot.index}" uses authoritative full-scan fallback`
    )
    const scanOptions =
      normalized === undefined
        ? undefined
        : { ...normalized, range: undefined, limit: undefined, orderBy: undefined }
    const runtime = createStorageOperationRuntime()
    for await (const value of streamImpl(scanOptions, context, runtime, false)) accept(value)
    const values = matches.map((match) => match.value)
    const comparator = normalized?.orderBy ?? defaultOrderBy
    if (comparator) {
      try {
        matches.sort((left, right) => {
          const result = comparator(left.value, right.value)
          if (typeof result !== 'number' || Number.isNaN(result))
            throw new TypeError('entity orderBy comparator must return a number')
          if (result !== 0) return normalized?.direction === 'prev' ? -result : result
          const byIndex = compareStorageKeys(left.indexKey, right.indexKey)
          const ordered = byIndex === 0 ? compareStorageKeys(left.id, right.id) : byIndex
          return normalized?.direction === 'prev' ? -ordered : ordered
        })
      } catch (cause) {
        throw new StorageError(StorageErrorCode.extensionFailed, {
          backend: store.backend,
          cause,
          operation: StorageOperation.entityOrderBy,
          extensionStage: 'comparator'
        })
        /* c8 ignore stop */
      }
      values.splice(0, values.length, ...matches.map((match) => match.value))
    } else {
      matches.sort((left, right) => {
        const byIndex = compareStorageKeys(left.indexKey, right.indexKey)
        const ordered = byIndex === 0 ? compareStorageKeys(left.id, right.id) : byIndex
        return normalized?.direction === 'prev' ? -ordered : ordered
      })
      values.splice(0, values.length, ...matches.map((match) => match.value))
    }
    return normalized?.limit === undefined ? values : values.slice(0, normalized.limit)
  }

  return {
    get: async (id, ctx) => {
      const context = snapshotOperationContext(ctx)
      const runtime = createStorageOperationRuntime()
      assertStorageKey(id, store.backend, `entity "${name}" id`)
      return materializeForRead(id, await readEnvelope(id, context, runtime), context, runtime)
    },

    put: async (value, ctx) => {
      const context = snapshotOperationContext(ctx)
      const runtime = createStorageOperationRuntime()
      const prepared = await toEnvelope(value, context, runtime)
      const id = idOf(name, keyProp, prepared.domain, store.backend)
      if (recordStore) {
        const raw = await encodeEnvelope(prepared.envelope, context, runtime)
        const indexedStore =
          Object.keys(config.indexes).length > 0 && isSecondaryIndexRecordStore(recordStore)
            ? recordStore
            : undefined
        if (indexedStore !== undefined) {
          const handle = await indexedStore.ensureRecordIndexes(
            name,
            Object.values(config.indexes).map((index) => index.definition),
            context
          )
          const readiness = await indexedStore.getRecordIndexReadiness(handle, context)
          if (readiness.status === 'complete') {
            const projection = projectEntityIndexes(config.indexes, prepared.domain, store.backend)
            await indexedStore.transactionIndexed(
              handle,
              async (tx) => {
                await tx.put(raw, composeRepositoryKey(name, id), projection)
                await tx.delete(composeStructuredKey(name, id))
              },
              context
            )
            return id
          }
        }
        await recordStore.transaction(async (tx) => {
          await tx.put(raw, composeRepositoryKey(name, id))
          await tx.delete(composeStructuredKey(name, id))
        }, context)
        return id
      }
      const target: IWriteTarget = { flatKey: composeFlatKey(name, id) }
      await writeEnvelopeAt(target, prepared.envelope, context, runtime)
      return id
    },

    remove: async (id, ctx) => {
      const context = snapshotOperationContext(ctx)
      assertStorageKey(id, store.backend, `entity "${name}" id`)
      if (recordStore) {
        const indexedStore =
          Object.keys(config.indexes).length > 0 && isSecondaryIndexRecordStore(recordStore)
            ? recordStore
            : undefined
        if (indexedStore !== undefined) {
          const handle = await indexedStore.ensureRecordIndexes(
            name,
            Object.values(config.indexes).map((index) => index.definition),
            context
          )
          const readiness = await indexedStore.getRecordIndexReadiness(handle, context)
          if (readiness.status === 'complete') {
            await indexedStore.transactionIndexed(
              handle,
              async (tx) => {
                await tx.delete(composeRepositoryKey(name, id))
                await tx.delete(composeStructuredKey(name, id))
              },
              context
            )
            return
          }
        }
        await recordStore.transaction(async (tx) => {
          await tx.delete(composeRepositoryKey(name, id))
          await tx.delete(composeStructuredKey(name, id))
        }, context)
        return
      }
      await store.remove(composeFlatKey(name, id), context)
    },

    list: async (options, ctx) => {
      const indexedSnapshot = snapshotIndexedListOptions(options)
      if (indexedSnapshot !== undefined) return queryByIndex(indexedSnapshot, ctx)
      const context = snapshotOperationContext(ctx)
      const runtime = createStorageOperationRuntime()
      const normalized = normalizeListOptions(options)
      const results: TDomain[] = []
      const comparator = normalized?.orderBy ?? defaultOrderBy
      const streamOptions = comparator ? { ...normalized, limit: undefined } : normalized
      for await (const record of streamImpl(streamOptions, context, runtime)) results.push(record)
      if (normalized?.limit !== undefined) return results.slice(0, normalized.limit)
      return results
    },

    stream: (options, ctx) => {
      const indexedSnapshot = snapshotIndexedListOptions(options)
      if (indexedSnapshot !== undefined)
        return (async function* () {
          for (const value of await queryByIndex(indexedSnapshot, ctx)) yield value
        })()
      const runtime = createStorageOperationRuntime()
      return streamImpl(normalizeListOptions(options), snapshotOperationContext(ctx), runtime)
    },

    findBy: async (index, key, ctx) => {
      assertStorageKey(key, store.backend, `entity "${name}" index query`)
      const results = await queryByIndex(
        createIndexedListSnapshot(index, { lower: key, upper: key }, undefined),
        ctx
      )
      const definition = config.indexes[index]?.definition
      if (definition !== undefined && !definition.unique && results.length > 1)
        emitDiagnostic(
          `[storage-web] entity "${name}" findBy on non-unique index "${index}" returned the first canonical match`
        )
      return results[0]
    },

    findManyBy: (index, range, options, ctx) =>
      queryByIndex(createIndexedListSnapshot(index, range, options), ctx),

    streamBy: async function* (index, range, options, ctx) {
      const snapshot = createIndexedListSnapshot(index, range, options)
      const nativeCapability = asIndexedDbBackfillStore<unknown>(store)
      const nativeIndexStore =
        recordStore !== undefined && isSecondaryIndexRecordStore(recordStore)
          ? recordStore
          : undefined
      const normalized = snapshot.options
      if (
        nativeCapability !== undefined &&
        nativeIndexStore !== undefined &&
        !(normalized?.orderBy ?? defaultOrderBy)
      ) {
        try {
          await backfillIndexes(ctx)
          const handle = await nativeCapability.ensureRecordIndexes(
            name,
            Object.values(config.indexes).map((entry) => entry.definition),
            ctx
          )
          const readiness = await nativeCapability.getRecordIndexReadiness(handle, ctx)
          if (readiness.status === 'complete') {
            const runtime = createStorageOperationRuntime()
            let yielded = 0
            for await (const [recordKey, raw] of nativeIndexStore.iterateRecordIndex(
              {
                handle,
                index,
                range: snapshot.range,
                direction: normalized?.direction
              },
              ctx
            )) {
              try {
                const envelope = await decodeEnvelope(raw, ctx, runtime)
                const value = await materialize(envelope, ctx, runtime)
                if (value === undefined) continue
                yield value
                yielded += 1
                if (normalized?.limit !== undefined && yielded >= normalized.limit) return
              } catch (cause) {
                const issue: IInvalidRecordIssue<TDomain> = {
                  key: recordKey,
                  raw,
                  stage: (cause as Partial<IStageFailure>).stage ?? 'validate',
                  cause
                }
                const action = invalidAction(issue, normalized)
                if (action === 'throw') throwInvalid(issue)
                emitDiagnostic(
                  `[storage-web] entity "${name}" skipped invalid indexed record ${String(recordKey)}`
                )
              }
            }
            return
          }
        } catch (cause) {
          if (!isBackfillContentionFailure(cause)) throw cause
        }
      }
      for (const value of await queryByIndex(snapshot, ctx)) yield value
    },

    migrate: async (options: IMigrateOptions<TDomain> = {}, ctx) => {
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
        readonly value: TDomain
      }> = []
      const persistBatch = async (): Promise<void> => {
        if (batch.length === 0) return
        if (!recordStore) {
          for (const entry of batch) {
            const prepared = await toEnvelope(entry.value, context, runtime)
            const nextKey = composeFlatKey(name, entry.id)
            await writeEnvelopeAt({ flatKey: nextKey }, prepared.envelope, context, runtime)
          }
          migrated += batch.length
        } else {
          let indexedStore: ISecondaryIndexRecordStore | undefined
          let indexedHandle: IRecordIndexHandle | undefined
          try {
            indexedStore =
              Object.keys(config.indexes).length > 0 && isSecondaryIndexRecordStore(recordStore)
                ? recordStore
                : undefined
            let migratedInBatch: number
            if (indexedStore !== undefined) {
              indexedHandle = await indexedStore.ensureRecordIndexes(
                name,
                Object.values(config.indexes).map((index) => index.definition),
                context
              )
              const readiness = await indexedStore.getRecordIndexReadiness(indexedHandle, context)
              if (readiness.status !== 'complete') indexedHandle = undefined
            }
            if (indexedStore !== undefined && indexedHandle !== undefined) {
              migratedInBatch = await indexedStore.transactionIndexed(
                indexedHandle,
                async (tx) => {
                  let count = 0
                  for (const entry of batch) {
                    const currentRaw = await tx.get(entry.physicalKey)
                    if (currentRaw === undefined) continue
                    if (entry.legacy) {
                      const existingTarget = await tx.get(composeRepositoryKey(name, entry.id))
                      if (existingTarget !== undefined) {
                        await tx.delete(entry.physicalKey)
                        continue
                      }
                      const currentEnvelope = await decodeEnvelope(currentRaw, context, runtime)
                      const currentValue = await materialize(currentEnvelope, context, runtime)
                      if (currentValue === undefined) continue
                      const prepared = await toEnvelope(currentValue, context, runtime)
                      const raw = await encodeEnvelope(prepared.envelope, context, runtime)
                      await tx.put(
                        raw,
                        composeRepositoryKey(name, entry.id),
                        projectEntityIndexes(config.indexes, prepared.domain, store.backend)
                      )
                      await tx.delete(entry.physicalKey)
                      if (entry.migrationRequired) count += 1
                      continue
                    }
                    const prepared = await toEnvelope(entry.value, context, runtime)
                    const raw = await encodeEnvelope(prepared.envelope, context, runtime)
                    await tx.put(
                      raw,
                      composeRepositoryKey(name, entry.id),
                      projectEntityIndexes(config.indexes, prepared.domain, store.backend)
                    )
                    if (entry.migrationRequired) count += 1
                  }
                  return count
                },
                context
              )
            } else
              migratedInBatch = await recordStore.transaction(async (tx) => {
                let count = 0
                for (const entry of batch) {
                  const currentRaw = await tx.get(entry.physicalKey)
                  if (currentRaw === undefined) continue
                  if (entry.legacy) {
                    const existingTarget = await tx.get(composeRepositoryKey(name, entry.id))
                    if (existingTarget !== undefined) {
                      await tx.delete(entry.physicalKey)
                      continue
                    }
                    const currentEnvelope = await decodeEnvelope(currentRaw, context, runtime)
                    const currentValue = await materialize(currentEnvelope, context, runtime)
                    if (currentValue === undefined) continue
                    const prepared = await toEnvelope(currentValue, context, runtime)
                    const raw = await encodeEnvelope(prepared.envelope, context, runtime)
                    await tx.put(raw, composeRepositoryKey(name, entry.id))
                    await tx.delete(entry.physicalKey)
                    if (entry.migrationRequired) count += 1
                    continue
                  }
                  const prepared = await toEnvelope(entry.value, context, runtime)
                  const raw = await encodeEnvelope(prepared.envelope, context, runtime)
                  await tx.put(raw, composeRepositoryKey(name, entry.id))
                  if (entry.migrationRequired) count += 1
                }
                return count
              }, context)
            migrated += migratedInBatch
          } catch (cause) {
            if (
              isStorageErrorFamily(cause) &&
              cause.code === StorageErrorCode.transactionConflict
            ) {
              for (const entry of batch) {
                try {
                  const retryRun = async (tx: IEntityRetryTransactionScope) => {
                    const targetRaw = await tx.get(composeRepositoryKey(name, entry.id))
                    if (targetRaw !== undefined) {
                      const targetEnvelope = await decodeEnvelope(targetRaw, context, runtime)
                      if (targetEnvelope.__v >= version) {
                        if (entry.legacy) await tx.delete(entry.physicalKey)
                        return 'alreadyCurrent' as const
                      }
                    }
                    const currentRaw = await tx.get(entry.physicalKey)
                    if (currentRaw === undefined) return 'missing' as const
                    const currentEnvelope = await decodeEnvelope(currentRaw, context, runtime)
                    const currentValue = await materialize(currentEnvelope, context, runtime)
                    if (currentValue === undefined) return 'missing' as const
                    if (currentEnvelope.__v >= version) return 'alreadyCurrent' as const
                    const prepared = await toEnvelope(currentValue, context, runtime)
                    const nextRaw = await encodeEnvelope(prepared.envelope, context, runtime)
                    if (indexedStore !== undefined && indexedHandle !== undefined)
                      await tx.put(
                        nextRaw,
                        composeRepositoryKey(name, entry.id),
                        projectEntityIndexes(config.indexes, prepared.domain, store.backend)
                      )
                    else await tx.put(nextRaw, composeRepositoryKey(name, entry.id))
                    if (entry.legacy) await tx.delete(entry.physicalKey)
                    return 'migrated' as const
                  }
                  const retryOutcome =
                    indexedStore !== undefined && indexedHandle !== undefined
                      ? await indexedStore.transactionIndexed(indexedHandle, retryRun, context)
                      : await recordStore.transaction(retryRun, context)
                  if (retryOutcome === 'migrated') migrated += 1
                  if (retryOutcome === 'alreadyCurrent') alreadyCurrent += 1
                } catch (retryCause) {
                  if (
                    isStorageErrorFamily(retryCause) &&
                    retryCause.code === StorageErrorCode.transactionConflict
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
              const value = await materialize(envelope, context, runtime)
              if (value === undefined) continue
              if (envelope.__v >= version) {
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
        const keys = (await store.keys(context))
          .filter((rawKey) => rawKey.startsWith(prefix))
          .map((rawKey) => ({ rawKey, id: decodeFlatStorageKey(rawKey.slice(prefix.length)) }))
          .filter((entry): entry is { rawKey: string; id: IStorageKey } => entry.id !== undefined)
          .sort((left, right) => compareStorageKeys(left.id, right.id))
        for (const { rawKey, id } of keys) {
          const raw = await store.get(rawKey, context)
          if (raw === null) continue
          scanned += 1
          try {
            const envelope = await decodeEnvelope(raw, context, runtime)
            const value = await materialize(envelope, context, runtime)
            if (value === undefined) continue
            if (envelope.__v >= version) {
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

    batch: async (run, ctx) => {
      const context = snapshotOperationContext(ctx)
      const runtime = createStorageOperationRuntime()
      if (typeof run !== 'function')
        throw new StorageError(StorageErrorCode.invalidConfig, {
          backend: store.backend,
          cause: new TypeError('batch callback must be a function')
        })
      if (!recordStore)
        throw new StorageContractError(StorageContractErrorCode.unsupported, {
          backend: store.backend
        })
      const indexedStore =
        Object.keys(config.indexes).length > 0 && isSecondaryIndexRecordStore(recordStore)
          ? recordStore
          : undefined
      const executeBatch = async (
        tx: {
          get(key: IStorageKey): Promise<unknown | undefined>
          put(value: unknown, key: IStorageKey, projection?: unknown): Promise<IStorageKey>
          delete(key: IStorageKey): Promise<void>
        },
        indexed: boolean
      ): Promise<Awaited<ReturnType<typeof run>>> => {
        const scope: IEntityTransactionScope<TDomain> = {
          get: async (id) => {
            assertStorageKey(id, store.backend, `entity "${name}" id`)
            let raw = await tx.get(composeRepositoryKey(name, id))
            if (raw === undefined) raw = await tx.get(composeStructuredKey(name, id))
            if (raw === undefined) return undefined
            return materializeForRead(
              id,
              await decodeEnvelope(raw, context, runtime),
              context,
              runtime
            )
          },
          put: async (value) => {
            const prepared = await toEnvelope(value, context, runtime)
            const id = idOf(name, keyProp, prepared.domain, store.backend)
            const raw = await encodeEnvelope(prepared.envelope, context, runtime)
            const projection = indexed
              ? projectEntityIndexes(config.indexes, prepared.domain, store.backend)
              : undefined
            await tx.put(raw, composeRepositoryKey(name, id), projection)
            await tx.delete(composeStructuredKey(name, id))
            return id
          },
          remove: async (id) => {
            assertStorageKey(id, store.backend, `entity "${name}" id`)
            await tx.delete(composeRepositoryKey(name, id))
            await tx.delete(composeStructuredKey(name, id))
          }
        }
        return (await run(scope)) as Awaited<ReturnType<typeof run>>
      }
      if (indexedStore !== undefined) {
        const handle = await indexedStore.ensureRecordIndexes(
          name,
          Object.values(config.indexes).map((index) => index.definition),
          context
        )
        const readiness = await indexedStore.getRecordIndexReadiness(handle, context)
        if (readiness.status === 'complete')
          return indexedStore.transactionIndexed(
            handle,
            (tx) =>
              executeBatch(
                {
                  get: tx.get,
                  put: (value, key, projection) => tx.put(value, key, projection as never),
                  delete: tx.delete
                },
                true
              ),
            context
          )
      }
      return recordStore.transaction(
        (tx) =>
          executeBatch(
            { get: tx.get, put: (value, key) => tx.put(value, key), delete: tx.delete },
            false
          ),
        context
      )
    }
  } as IRepository<TDomain, TIndexes>
}
