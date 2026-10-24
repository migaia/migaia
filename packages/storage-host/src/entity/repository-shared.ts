import { asyncDisposeKey } from '@migaia/plugin-host'
import {
  getBackendEntityAccess,
  snapshotBackendEntityRecordWatcher,
  type IBackendEntityAccess
} from '../core/backend-registry.js'
import {
  type IVersionedEnvelope,
  type IMigrationPlan,
  assertStorageKey,
  type IRecordQuerySource,
  type ITransactionScope,
  type IStorageIterator,
  isSecondaryIndexRecordStore,
  isStorageContractError,
  type IRecordIndexHandle,
  type IRecordIndexProjection,
  type IRecordIndexProjectionValue,
  type IKeyRange,
  type ISecondaryIndexRecordStore
} from '@migaia/storage-contract'
import { snapshotKeyValueStoreDetailed, snapshotRecordStore } from '../authoring/store.js'
import { compareStorageKeys } from '../authoring/key.js'
import { assertTransactionOwner } from '../authoring/transaction.js'

import { StorageError, StorageErrorCode } from '../errors.js'

import { isStorageKeyInRange } from '../core/query.js'
import { normalizeError as normalizeStorageError } from '../core/error-family.js'
import {
  createStorageOperationRuntime,
  type IStorageOperationRuntime,
  reportCleanupError
} from '../core/operation-reporter.js'
import { EntityText } from './text.js'
import { type IEntityQueryPlan, type IEntityQuerySourceSelection } from './query.js'
import type { IOperationContext, IStorageKey } from '@migaia/storage-contract'
import type { IRecordStore, IKeyValueStore } from '@migaia/storage-contract'
import type { ISchemaAdapter } from '../entity.js'
import type { ICodec } from '../entity.js'
import type { IListOptions, IMigrateOptions, IEntityConnectStore } from './types.js'
import type { ISnapshotEntityIndexes } from './index-projection.js'

import { createOrderedRecordIndex } from '../core/ordered-record-index.js'

import {
  StorageMigrationPhase,
  StorageMigrationStatus,
  type IStorageRecordStage
} from './constants.js'

/** Entity extension observations borrow only the currently accepted canonical operation view. */
export type IEntityOperationRuntime = IStorageOperationRuntime & {
  readonly scope?: ITransactionScope
}
/** Create operation-local diagnostics without retaining a transaction after its actual work. */
export const entityRuntime = (scope: ITransactionScope): IEntityOperationRuntime => ({
  ...createStorageOperationRuntime(),
  scope
})
/** Observer callbacks never intervene, await native work, or replace an operation failure. */
export const observeEntity = (
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
export class EntityIteratorLifetime<T> {
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
export function entityIterator<T>(
  generator: AsyncGenerator<T, void, unknown>,
  runtime: IEntityOperationRuntime
): IStorageIterator<T> {
  return new EntityIteratorLifetime(generator, runtime).attach()
}

/** Runtime snapshots admit related ordering fields once while public callers retain their union. */
export type IListSnapshot<T> = Omit<IListOptions<T>, 'orderBy' | 'limit'> & {
  readonly orderBy?: (left: T, right: T) => number
  readonly limit?: number
}
export type IEnvelope = IVersionedEnvelope
export type IStageFailure = Error & {
  readonly stage: IStorageRecordStage
  readonly cause: unknown
}

export type IWriteTarget = { readonly documentKey?: IStorageKey; readonly flatKey?: string }
/** Select the same minimum index key without invoking projection or changing its error boundary. */
export function minimumProjectedIndexKey(
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
export type IRepositoryReadView = {
  readonly keys?: () => Promise<string[]>
  readonly get?: (key: string) => Promise<string | null>
  readonly getRecord?: (key: IStorageKey) => Promise<unknown | undefined>
  readonly iterateRecords?: IRecordStore['iterateRecords']
  readonly iterateRecordIndex?: ISecondaryIndexRecordStore['iterateRecordIndex']
  readonly readyHandle?: IRecordIndexHandle
  readonly runtime?: IEntityOperationRuntime
}

/** Final logical row state; an absent projection represents a deletion in the draft. */
export type IEntityUniqueMutation = {
  readonly id: IStorageKey
  readonly projection: IRecordIndexProjection | undefined
}

/* c8 ignore start -- defensive stage wrapping is exercised through the public error assertions. */
export const stageFailure = (stage: IStageFailure['stage'], cause: unknown): IStageFailure => {
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

export const validateLimit = (
  limit: number | undefined,
  backend: IKeyValueStore['backend']
): void => {
  if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 0))
    throw new StorageError(StorageErrorCode.invalidConfig, {
      backend,
      cause: new RangeError(EntityText.listLimitMustBeANonNegativeSafeInteger)
    })
}

export const validateOrderBy = (orderBy: unknown, backend: IKeyValueStore['backend']): void => {
  if (orderBy !== undefined && typeof orderBy !== 'function')
    throw new StorageError(StorageErrorCode.invalidConfig, {
      backend,
      cause: new TypeError(EntityText.listOrderByMustBeAFunction)
    })
}

export const validateListOptions = (options: unknown, backend: IKeyValueStore['backend']): void => {
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
export const snapshotEntityStore = (store: IEntityConnectStore): IBackendEntityAccess => {
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
export const normalizeError = (
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
  readonly migrationPlan: IMigrationPlan | undefined
  readonly features: readonly import('./assembly.js').IEntityFeature[]
  readonly validateOnRead: boolean
  readonly onDiagnostic: (message: string) => void
  readonly defaultOrderBy: ((left: TDomain, right: TDomain) => number) | undefined
  readonly indexes: ISnapshotEntityIndexes<TDomain>
}

export const idOf = <TDomain>(
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
export type IIndexedListSnapshot<TDomain> = {
  readonly index: string
  readonly range: IListSnapshot<TDomain>['range']
  readonly options: IListSnapshot<TDomain> | undefined
}

/** Index collection and streaming share native cursors, filtering and the sole bounded heap. */
/** Native and fallback index rows share one materializer and canonical metadata ordering. */
export type IMatch<TDomain> = {
  readonly id: IStorageKey
  readonly key: IStorageKey
  readonly value: TDomain
}
/** One fluent descriptor shares synchronous opening facts without retaining native resources. */
export type IEntityQueryExecution<T> = {
  scope?: ITransactionScope
  opened?: { readCount: number }
  openingPlan?: IEntityQueryPlan
  openingSelection?: IEntityQuerySourceSelection<T>
}
/** One native source keeps selection separate from shared terminal observer facts. */
export type IEntityQuerySourceContext<T> = {
  execution: IEntityQueryExecution<T>
  selection: IEntityQuerySourceSelection<T>
}
/** Existing migration counters and checkpoint facts are owned by one active run. */
export type IEntityMigrationContext<TDomain> = {
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
export type IEntityMigrationCheckpoint = {
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
export type IEntityScanCandidate = {
  readonly id: IStorageKey
  readonly physical: IStorageKey | string
  readonly raw: unknown
}
/** One lazy scan owns ordering storage while borrowing its native read view. */
export type IEntityScanContext<T> = {
  options: IListSnapshot<T> | undefined
  ctx: IOperationContext | undefined
  readView?: IRepositoryReadView
  onRead?: () => void
  applyOrdering: boolean
  candidates: ReturnType<typeof createOrderedRecordIndex<IEntityScanCandidate>>
}
/** Preparation and cleanup state belong to one authentic transaction cursor. */
export type IEntityScopedSourceContext<T> = {
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
export type IEntityQueryObservation<T, R> = {
  iterator: IStorageIterator<R>
  plan: IEntityQueryPlan
  selection: IEntityQuerySourceSelection<T>
  counter: { readCount: number } | undefined
  returnedCount: number
  elapsedMs: number
}
/** One bound repository borrows its native scope and weak finalizer-owned mutation state. */
export type IEntityRepositoryBinding = {
  scope: ITransactionScope
  expectedIdentity?: IStorageKey
  activeChanges: WeakRef<Map<string, IEntityUniqueMutation>> | undefined
}
/** One write terminal owns its source policy and native mutation request. */
export type IEntityQueryMutationContext<T> = {
  source: IEntityQuerySourceContext<T>
  policy: IEntityQuerySourceSelection<T>
  orderedSource: boolean
  onRead: (() => void) | undefined
  request: Parameters<NonNullable<IRecordQuerySource['mutate']>>[0]
  run: Parameters<NonNullable<IRecordQuerySource['mutate']>>[1]
}
/** Own one entity repository, its backend access and versioned materialization route. */
