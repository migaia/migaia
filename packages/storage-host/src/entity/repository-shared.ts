import { asyncDisposeKey } from '@migaia/plugin-host'
import {
  getBackendEntityAccess,
  snapshotBackendEntityRecordWatcher,
  type IBackendEntityAccess
} from '../core/backend-registry.ts'
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
import { snapshotKeyValueStoreDetailed, snapshotRecordStore } from '../authoring/store.ts'
import { compareStorageKeys } from '../authoring/key.ts'
import { assertTransactionOwner } from '../authoring/transaction.ts'
import { guardTransactionIterator } from '../authoring/transaction-registration.ts'

import { StorageError } from '../errors.ts'
import { StorageHostErrorCode } from '@migaia/storage-contract/error-code'

import { isStorageKeyInRange } from '../core/query-state.ts'
import { normalizeError as normalizeStorageError } from '../core/error-family.ts'
import {
  createStorageOperationRuntime,
  type IStorageOperationRuntime,
  reportCleanupError
} from '../core/operation-reporter.ts'
import { EntityText } from './text.ts'
import { type IEntityQueryPlan, type IEntityQuerySourceSelection } from './query-adapter.ts'
import type { IOperationContext, IStorageKey } from '@migaia/storage-contract'
import type { IRecordStore, IKeyValueStore } from '@migaia/storage-contract'
import type { ISchemaAdapter } from '../entity.ts'
import type { ICodec } from '../entity.ts'
import type { IListOptions, IMigrateOptions, IEntityConnectStore } from './types.ts'
import type { ISnapshotEntityIndexes } from './index-projection.ts'

import { createOrderedRecordIndex } from '../core/ordered-record-index.ts'
import { throwIfAborted } from '../core/operation.ts'
import type { INativeAbortSignal } from '@migaia/utils/promise'

import {
  StorageMigrationPhase,
  StorageMigrationStatus,
  type IStorageRecordStage
} from './constants.ts'

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
  dispose = (): Promise<void> => (this.#closing ??= this.#close())
  /** Existing resource iterators retain their own cleanup authority and cached completion. */
  #close(): Promise<void> {
    return this.#generator.return!(undefined).then(() => undefined)
  }
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

/** Public entity resources borrow native cleanup and check revocation only at next admission. */
class EntityIteratorGuard<T> {
  /** The original resource remains the only cleanup and accepted-operation owner. */
  readonly #iterator: IStorageIterator<T>
  /** This registration signal revokes public work without adding a resource lifecycle. */
  readonly #signal: INativeAbortSignal
  /** Observe revocation cleanup once while retaining the original resource's cached Promise. */
  #cleanupObserved = false

  /** Borrow the original resource and the entity installation's existing signal. */
  constructor(iterator: IStorageIterator<T>, signal: INativeAbortSignal) {
    this.#iterator = iterator
    this.#signal = signal
  }

  /** Reject before backend admission and release the original resource after revocation. */
  assertCurrent(): void {
    try {
      throwIfAborted(this.#signal)
    } catch (cause) {
      this.#closeRevoked()
      throw cause
    }
  }

  /** A cleanup failure uses the existing diagnostic channel only when an actual failure occurs. */
  #reportCleanup(cause: unknown): void {
    reportCleanupError(createStorageOperationRuntime().reporter, cause)
  }

  /** Cleanup authority stays on the native resource; only its rejected result is observed here. */
  #closeRevoked(): void {
    if (this.#cleanupObserved) return
    this.#cleanupObserved = true
    try {
      void this.#iterator.dispose().catch((cause) => this.#reportCleanup(cause))
    } catch (cause) {
      this.#reportCleanup(cause)
    }
  }

  /** An unregistered root resource keeps its original receiver and native next Promise. */
  next(...args: [] | [unknown]): Promise<IteratorResult<T>> {
    try {
      this.assertCurrent()
    } catch (cause) {
      /** Preserve the caller's rejection while avoiding a secondary unhandled next rejection. */
      const rejected = Promise.reject<IteratorResult<T>>(cause)
      void rejected.then(undefined, () => undefined)
      return rejected
    }
    return this.#iterator.next(...args)
  }

  /** Forward return without allocating or caching a different cleanup Promise. */
  returned(value?: unknown): Promise<IteratorResult<T>> {
    return this.#iterator.return!(value)
  }

  /** Forward explicit disposal to the original resource's cached main Promise. */
  dispose(): Promise<void> {
    return this.#iterator.dispose()
  }

  /** Forward symbolic disposal to its existing separately cached native Promise. */
  symbolicDispose(): Promise<void> {
    return this.#iterator[asyncDisposeKey]()
  }

  /** Unregistered roots need one stable-shaped public boundary without mutating their next method. */
  boundary(): IStorageIterator<T> {
    return {
      next: (...args) => this.next(...args),
      return: this.#iterator.return === undefined ? undefined : (value) => this.returned(value),
      dispose: () => this.dispose(),
      [asyncDisposeKey]: () => this.symbolicDispose(),
      [Symbol.asyncIterator]() {
        return this
      }
    }
  }
}

/** Preserve registered iterator identity; guard only the final public resource boundary. */
export function guardEntityIterator<T>(
  iterator: IStorageIterator<T>,
  signal: INativeAbortSignal
): IStorageIterator<T> {
  /** This owner adds admission only; it borrows every native resource and cleanup method. */
  const guard = new EntityIteratorGuard(iterator, signal)
  return guardTransactionIterator(iterator, () => guard.assertCurrent())
    ? iterator
    : guard.boundary()
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
    StorageHostErrorCode.extensionFailed,
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
    throw new StorageError(StorageHostErrorCode.invalidConfig, {
      backend,
      cause: new RangeError(EntityText.listLimitMustBeANonNegativeSafeInteger)
    })
}

export const validateOrderBy = (orderBy: unknown, backend: IKeyValueStore['backend']): void => {
  if (orderBy !== undefined && typeof orderBy !== 'function')
    throw new StorageError(StorageHostErrorCode.invalidConfig, {
      backend,
      cause: new TypeError(EntityText.listOrderByMustBeAFunction)
    })
}

export const validateListOptions = (options: unknown, backend: IKeyValueStore['backend']): void => {
  if (
    options !== undefined &&
    (typeof options !== 'object' || options === null || Array.isArray(options))
  )
    throw new StorageError(StorageHostErrorCode.invalidConfig, {
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
    throw new StorageError(StorageHostErrorCode.invalidConfig, { cause: snapshot.cause })
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
  /** Exact native outputs retain declaration order without per-repository Map entry allocation. */
  readonly units: readonly import('./assembly.ts').IInstalledRepositoryUnit[]
  /** The existing native registration signal revokes every repository obtained from this entity. */
  readonly signal: import('@migaia/utils/promise').INativeAbortSignal
  readonly validateOnRead: boolean
  readonly onDiagnostic: (message: string) => void
  readonly defaultOrderBy: ((left: TDomain, right: TDomain) => number) | undefined
  readonly indexes: ISnapshotEntityIndexes<TDomain>
  /** Installation-owned pure subsets share the admitted selectors and definition identities. */
  readonly uniqueIndexes: ISnapshotEntityIndexes<TDomain>
  /** Every repository's native and fallback commits borrow this readonly declaration projection. */
  readonly uniqueDefinitions: readonly ISnapshotEntityIndexes<TDomain>[string]['definition'][]
}

export const idOf = <TDomain>(
  entityName: string,
  keyProp: string,
  value: TDomain,
  backend: IKeyValueStore['backend']
): IStorageKey => {
  const id = (value as Record<string, unknown>)[keyProp]
  if (id === undefined || id === null)
    throw new StorageError(StorageHostErrorCode.invalidConfig, {
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
  /** Root observation advances the original receiver through one captured forwarding callback. */
  readonly advance: () => Promise<IteratorResult<R>>
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
