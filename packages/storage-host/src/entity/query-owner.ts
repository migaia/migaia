import { missingEntityFeature } from './assembly.js'
import { EntityFeatureName } from './constants.js'
import { asyncDisposeKey } from '@migaia/plugin-host'
import { getBackendEntityQueryMethods } from '../core/backend-registry.js'
import {
  type ITransactionScope,
  type IStorageIterator,
  type IRecordQueryBase
} from '@migaia/storage-contract'
import { snapshotStorageKey, encodeOrderedStorageKey } from '../authoring/key.js'
import { createRecordQueryWithoutKeyset } from '../authoring/query.js'
import {
  runTransactionOperation,
  readTransactionOperationContext
} from '../authoring/transaction.js'
import { StorageError, createStorageTypeError } from '../errors.js'
import { StorageHostErrorCode } from '@migaia/storage-contract/error-code'
import { StorageErrorText } from '../error-text.js'
import { decodeRepositoryKey, flatKeyPrefix, repositoryEntityRange } from './key.js'
import { decodeFlatStorageKey, encodeFlatStorageKey, snapshotKeyRange } from '../core/key-domain.js'
import { isStorageKeyInRange } from '../core/query-state.js'
import { createStorageOperationRuntime } from '../core/operation-reporter.js'
import { EntityText } from './text.js'
import {
  createEntityQuery,
  type IEntityQueryPlan,
  type IEntityQuerySourceSelection
} from './query-adapter.js'
import { snapshotOperationContext } from '../authoring/context.js'
import type { IOperationContext, IStorageKey } from '@migaia/storage-contract'
import type {
  IEntityTransactionScope,
  IIndexedListOptions,
  IInvalidRecordHandler,
  IInvalidRecordAction,
  IInvalidRecordIssue,
  IEntityQuery,
  IRepository
} from './types.js'
import { createOrderedRecordIndex } from '../core/ordered-record-index.js'
import {
  EntityState,
  StorageInvalidRecordAction,
  StorageOperation,
  StorageRecordStage
} from './constants.js'
import {
  IEntityOperationRuntime,
  entityRuntime,
  entityIterator,
  IListSnapshot,
  IEnvelope,
  IStageFailure,
  IRepositoryReadView,
  stageFailure,
  validateLimit,
  validateOrderBy,
  validateListOptions,
  idOf,
  IEntityQueryExecution,
  IEntityScanCandidate,
  IEntityScanContext,
  IEntityRepositoryBinding
} from './repository-shared.js'
import type { EntityRepositoryOwner } from './repository.js'
import { EntityQuerySourceOwner } from './query-source.js'

/** Own only the explicitly assembled query operations; the repository retains storage state. */
export class EntityQueryOwner<
  TDomain,
  TStored,
  TIndexes extends Readonly<Record<string, IStorageKey>> = Readonly<Record<never, IStorageKey>>,
  TAugmentMethods extends object = {},
  TChangeFeed extends boolean = false
> {
  /** Borrow the original repository state and operations without another executor. */
  readonly #context: EntityRepositoryOwner<TDomain, TStored, TIndexes, TAugmentMethods, TChangeFeed>
  /** Run scoped, observed and mutating query sources against this same owner. */
  readonly #sources: EntityQuerySourceOwner<
    TDomain,
    TStored,
    TIndexes,
    TAugmentMethods,
    TChangeFeed
  >
  /** Capture the original owner before this feature publishes any methods. */
  constructor(
    context: EntityRepositoryOwner<TDomain, TStored, TIndexes, TAugmentMethods, TChangeFeed>
  ) {
    this.#context = context
    this.#sources = new EntityQuerySourceOwner(context, this)
  }

  /** Select only the explicitly installed keyset constructor while sharing this query owner. */
  createQuery: typeof createRecordQueryWithoutKeyset = (source, methods) => {
    /** Presence selects the real owner; no optional implementation is imported on this path. */
    const query = this.#context.keysetQuery ?? createRecordQueryWithoutKeyset
    return query(source, methods, () => missingEntityFeature(EntityFeatureName.keyset))
  }
  /** Reuse the original repository operation through its explicit owner context. */
  invalidAction = (
    issue: IInvalidRecordIssue<TDomain>,
    option: IListSnapshot<TDomain> | undefined
  ): IInvalidRecordAction => this.invokeInvalidHandler(option?.onInvalid, issue)
  /** Reuse the original repository operation through its explicit owner context. */
  validateInvalidHandler = (handler: unknown): void => this.#context.validateInvalidHandler(handler)
  /** Reuse the original repository operation through its explicit owner context. */
  normalizeListOptions = (
    options:
      | IListSnapshot<TDomain>
      | IIndexedListOptions<TDomain, Readonly<Record<string, IStorageKey>>>
      | undefined
  ): IListSnapshot<TDomain> | undefined => {
    validateListOptions(options, this.#context.store.backend)
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

    const rangeSnapshot = snapshotKeyRange(range, this.#context.store.backend)
    validateLimit(limit, this.#context.store.backend)
    validateOrderBy(orderBy, this.#context.store.backend)
    if (direction !== undefined && direction !== 'next' && direction !== 'prev')
      throw new StorageError(StorageHostErrorCode.invalidConfig, {
        backend: this.#context.store.backend,
        cause: new TypeError(EntityText.listDirectionMustBeNextOrPrev)
      })
    this.validateInvalidHandler(onInvalid)
    return { range: rangeSnapshot, limit, orderBy, direction, onInvalid }
  }
  /** Reuse the original repository operation through its explicit owner context. */
  invokeInvalidHandler = (
    handler: IInvalidRecordAction | IInvalidRecordHandler<TDomain> | undefined,
    issue: IInvalidRecordIssue<TDomain>
  ): IInvalidRecordAction => this.#context.invokeInvalidHandler(handler, issue)
  /** Reuse the original repository operation through its explicit owner context. */
  throwInvalid = (issue: IInvalidRecordIssue<TDomain>): never => this.#context.throwInvalid(issue)
  /** Reuse the original repository operation through its explicit owner context. */
  async *streamImpl(
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
      for await (const row of this.orderedEntityCandidates(scan)) {
        const raw =
          this.#context.recordStore !== undefined
            ? readView?.getRecord === undefined
              ? row.raw
              : await readView.getRecord(row.physical as IStorageKey)
            : readView?.get === undefined
              ? await this.#context.store.get(row.physical as string, ctx)
              : await readView.get(row.physical as string)
        if (raw === undefined || (!this.#context.recordStore && raw === null)) continue
        let value: TDomain | undefined
        try {
          let envelope: IEnvelope
          try {
            envelope = await this.#context.decodeEnvelope(raw, ctx, runtime)
          } catch (cause) {
            throw stageFailure(StorageRecordStage.decode, cause)
          }
          value = await this.#context.materialize(envelope, ctx, runtime)
          if (value !== undefined) project?.(value)
        } catch (cause) {
          value = undefined
          const issue: IInvalidRecordIssue<TDomain> = {
            key: row.id,
            raw,
            stage: (cause as Partial<IStageFailure>).stage ?? StorageRecordStage.validate,
            cause
          }
          if (this.invalidAction(issue, options) === StorageInvalidRecordAction.throw)
            this.throwInvalid(issue)
          this.#context.emitDiagnostic(EntityText.invalidRecord(this.#context.name, row.id))
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
  /** Reuse the original repository operation through its explicit owner context. */
  listQuery = (
    options: IListSnapshot<TDomain> | undefined,
    ctx: IOperationContext | undefined,
    runtime: IEntityOperationRuntime,
    readView?: IRepositoryReadView,
    onRead?: () => void
  ): IRecordQueryBase<TDomain, IOperationContext> => {
    const comparator = options?.orderBy ?? this.#context.defaultOrderBy
    if (comparator !== undefined && options?.limit === undefined)
      throw new StorageError(StorageHostErrorCode.invalidConfig, {
        backend: this.#context.store.backend,
        cause: new TypeError(EntityText.comparatorLimit)
      })
    const source = this.createQuery<TDomain>({
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
            for await (const value of repositoryOwner.streamImpl(
              { ...options, orderBy: undefined, limit: undefined },
              ctx,
              runtime,
              comparator === undefined,
              readView,
              onRead
            ))
              yield [
                idOf(
                  repositoryOwner.name,
                  repositoryOwner.keyProp,
                  value,
                  repositoryOwner.store.backend
                ),
                value
              ] as const
          })(this.#context),
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
                StorageHostErrorCode.extensionFailed,
                StorageErrorText.entityComparatorInvalid
              )
            return options?.direction === 'prev' ? -result : result
          } catch (cause) {
            throw new StorageError(StorageHostErrorCode.extensionFailed, {
              backend: this.#context.store.backend,
              cause,
              operation: StorageOperation.entityOrderBy,
              extensionStage: 'comparator'
            })
          }
        })
        .limit(options!.limit!)
    return options?.limit === undefined ? source : source.limit(options.limit)
  }
  /** Reuse the original repository operation through its explicit owner context. */
  queryFor = <C extends IOperationContext | undefined>(
    scope?: ITransactionScope
  ): IEntityQuery<TDomain, TIndexes, C, TAugmentMethods> => {
    /** Synchronous terminal opening shares these facts with its actual source. */
    const execution: IEntityQueryExecution<TDomain> = { scope }
    return createEntityQuery<TDomain, TIndexes, C, TAugmentMethods>({
      predicate: this.queryPredicate,
      keyset: (invoke) => this.#context.runKeyset(invoke),
      query: this.createQuery,
      selector: this.querySelector,
      mapper: this.queryMapper,
      comparator: this.queryComparator,
      methods: getBackendEntityQueryMethods(this.#context.store) as TAugmentMethods | undefined,
      defaultComparator: this.#context.defaultOrderBy,
      run: (invoke, plan, selection, count) =>
        this.runEntityQuery(execution, invoke, plan, selection, count),
      stream: (open, plan, selection) => this.streamEntityQuery(execution, open, plan, selection),
      missingLimit: this.queryMissingLimit,
      invalidState: this.queryInvalidState,
      invalid: this.queryInvalid,
      range: this.queryRange,
      index: (name, match) => this.#context.queryIndex(name, match),
      source: (selection) => this.#sources.createEntitySource(execution, selection)
    })
  }
  /** Reuse the original repository operation through its explicit owner context. */
  queryPredicate: Parameters<
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
      throw new StorageError(StorageHostErrorCode.extensionFailed, {
        backend: this.#context.store.backend,
        cause,
        operation: StorageOperation.queryWhere,
        extensionStage: 'where'
      })
    }
  }
  /** Reuse the original repository operation through its explicit owner context. */
  querySelector: Parameters<
    typeof createEntityQuery<TDomain, TIndexes, IOperationContext, TAugmentMethods>
  >[0]['selector'] = (fn) => (value) => {
    try {
      const result = fn(value)
      try {
        /** Later callbacks can mutate the returned key while the query retains ordering state. */
        return snapshotStorageKey(result, this.#context.store.backend)
      } catch (cause) {
        void Promise.resolve(result).catch(createStorageOperationRuntime().reporter)
        throw new TypeError(EntityText.querySelectorKey, { cause })
      }
    } catch (cause) {
      throw new StorageError(StorageHostErrorCode.extensionFailed, {
        backend: this.#context.store.backend,
        cause,
        operation: StorageOperation.querySelector,
        extensionStage: 'selector'
      })
    }
  }
  /** Reuse the original repository operation through its explicit owner context. */
  queryMapper: Parameters<
    typeof createEntityQuery<TDomain, TIndexes, IOperationContext, TAugmentMethods>
  >[0]['mapper'] = (fn) => async (value) => {
    try {
      return await fn(value)
    } catch (cause) {
      throw new StorageError(StorageHostErrorCode.extensionFailed, {
        backend: this.#context.store.backend,
        cause,
        operation: StorageOperation.querySelect,
        extensionStage: 'select'
      })
    }
  }
  /** Reuse the original repository operation through its explicit owner context. */
  queryComparator: Parameters<
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
      throw new StorageError(StorageHostErrorCode.extensionFailed, {
        backend: this.#context.store.backend,
        cause,
        operation: StorageOperation.queryComparator,
        extensionStage: 'comparator'
      })
    }
  }
  /** Reuse the original repository operation through its explicit owner context. */
  runEntityQuery = <R>(
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
        return this.#sources.observeQueryRead(
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
  /** Reuse the original repository operation through its explicit owner context. */
  streamEntityQuery = <R>(
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
    return this.#sources.observeQueryStream(iterator, plan, selection, execution.opened)
  }
  /** Reuse the original repository operation through its explicit owner context. */
  queryMissingLimit: Parameters<
    typeof createEntityQuery<TDomain, TIndexes, IOperationContext, TAugmentMethods>
  >[0]['missingLimit'] = () => {
    throw new StorageError(StorageHostErrorCode.invalidConfig, {
      backend: this.#context.store.backend,
      cause: new TypeError(EntityText.comparatorLimit)
    })
  }
  /** Reuse the original repository operation through its explicit owner context. */
  queryInvalidState: Parameters<
    typeof createEntityQuery<TDomain, TIndexes, IOperationContext, TAugmentMethods>
  >[0]['invalidState'] = (cause) => {
    throw new StorageError(StorageHostErrorCode.invalidConfig, {
      backend: this.#context.store.backend,
      cause: cause ?? new TypeError(EntityText.queryState)
    })
  }
  /** Reuse the original repository operation through its explicit owner context. */
  queryInvalid: Parameters<
    typeof createEntityQuery<TDomain, TIndexes, IOperationContext, TAugmentMethods>
  >[0]['invalid'] = (action) => {
    this.normalizeListOptions({ onInvalid: action as IInvalidRecordAction })
  }
  /** Reuse the original repository operation through its explicit owner context. */
  queryRange: Parameters<
    typeof createEntityQuery<TDomain, TIndexes, IOperationContext, TAugmentMethods>
  >[0]['range'] = (range) => snapshotKeyRange(range, this.#context.store.backend)!
  /** Reuse the original repository operation through its explicit owner context. */
  boundQuery = (
    binding: IEntityRepositoryBinding
  ): ReturnType<IEntityTransactionScope<TDomain, TIndexes, TAugmentMethods>['query']> =>
    this.queryFor<undefined>(binding.scope)
  /** Reuse the original repository operation through its explicit owner context. */
  boundList = (
    binding: IEntityRepositoryBinding,
    options?: IListSnapshot<TDomain> | IIndexedListOptions<TDomain, TIndexes>
  ): ReturnType<IEntityTransactionScope<TDomain, TIndexes, TAugmentMethods>['list']> =>
    runTransactionOperation(binding.scope, async (current) => {
      this.#context.backend.assertScope(current)
      const context = readTransactionOperationContext(current)
      /** Metadata probes never build indexes or poison this transaction on a stale generation. */
      const handle =
        this.#context.readyHandle !== undefined &&
        (await current.isRecordIndexReady?.(this.#context.readyHandle))
          ? this.#context.readyHandle
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
      const indexed =
        (options as { readonly index?: string } | undefined)?.index === undefined
          ? undefined
          : this.#context.snapshotIndexedListOptions(options)
      const normalized = indexed?.options ?? this.normalizeListOptions(options)
      const counter = this.#context.queryStages === undefined ? undefined : { readCount: 0 }
      const onRead =
        counter === undefined
          ? undefined
          : () => {
              counter.readCount++
            }
      const query =
        indexed === undefined
          ? this.listQuery(normalized, context, entityRuntime(current), view, onRead)
          : this.#context.createIndexQuery(indexed, context, view, onRead)
      return this.#sources.observeQueryRead(
        () => query.all(context),
        {
          hasWhere: false,
          hasOrder: (normalized?.orderBy ?? this.#context.defaultOrderBy) !== undefined,
          hasLimit: normalized?.limit !== undefined
        },
        { index: indexed?.index },
        current,
        () => counter,
        (values) => values.length
      )
    })
  /** Reuse the original repository operation through its explicit owner context. */
  apiQuery: IRepository<TDomain, TIndexes, TChangeFeed, TAugmentMethods>['query'] = () =>
    this.queryFor<IOperationContext>() as ReturnType<
      IRepository<TDomain, TIndexes, TChangeFeed, TAugmentMethods>['query']
    >
  /** Reuse the original repository operation through its explicit owner context. */
  apiList: IRepository<TDomain, TIndexes, TChangeFeed, TAugmentMethods>['list'] = async (
    options,
    ctx
  ) => {
    const indexed =
      (options as { readonly index?: string } | undefined)?.index === undefined
        ? undefined
        : this.#context.snapshotIndexedListOptions(options)
    const normalized = indexed?.options ?? this.normalizeListOptions(options)
    const context = snapshotOperationContext(ctx)
    const counter = this.#context.queryStages === undefined ? undefined : { readCount: 0 }
    const onRead =
      counter === undefined
        ? undefined
        : () => {
            counter.readCount++
          }
    const query =
      indexed === undefined
        ? this.listQuery(normalized, context, createStorageOperationRuntime(), undefined, onRead)
        : this.#context.createIndexQuery(indexed, context, undefined, onRead)
    return this.#sources.observeQueryRead(
      () => query.all(context),
      {
        hasWhere: false,
        hasOrder: (normalized?.orderBy ?? this.#context.defaultOrderBy) !== undefined,
        hasLimit: normalized?.limit !== undefined
      },
      { index: indexed?.index },
      undefined,
      () => counter,
      (values) => values.length
    )
  }
  /** Reuse the original repository operation through its explicit owner context. */
  apiStream: IRepository<TDomain, TIndexes, TChangeFeed, TAugmentMethods>['stream'] = (
    options,
    ctx
  ) => {
    const indexed =
      (options as { readonly index?: string } | undefined)?.index === undefined
        ? undefined
        : this.#context.snapshotIndexedListOptions(options)
    const normalized = indexed?.options ?? this.normalizeListOptions(options)
    const context = snapshotOperationContext(ctx)
    const counter = this.#context.queryStages === undefined ? undefined : { readCount: 0 }
    const onRead =
      counter === undefined
        ? undefined
        : () => {
            counter.readCount++
          }
    const query =
      indexed === undefined
        ? this.listQuery(normalized, context, createStorageOperationRuntime(), undefined, onRead)
        : this.#context.createIndexQuery(indexed, context, undefined, onRead)
    return this.#sources.observeQueryStream(
      query.stream(context),
      {
        hasWhere: false,
        hasOrder: (normalized?.orderBy ?? this.#context.defaultOrderBy) !== undefined,
        hasLimit: normalized?.limit !== undefined
      },
      { index: indexed?.index },
      counter
    )
  }
  /** Reuse the original repository operation through its explicit owner context. */
  async *scanEntityCandidates(
    scan: IEntityScanContext<TDomain>
  ): AsyncGenerator<IEntityScanCandidate, void, unknown> {
    if (this.#context.recordStore !== undefined) {
      const canonicalIds = new Set<string>()
      const iterate =
        scan.readView?.iterateRecords ??
        ((range) => this.#context.recordStore!.iterateRecords(range, scan.ctx))
      try {
        for (const range of [repositoryEntityRange(this.#context.name), undefined]) {
          for await (const [physical, raw] of iterate(range)) {
            const canonical = decodeRepositoryKey(this.#context.name, physical)
            const legacy =
              Array.isArray(physical) && physical.length === 2 && physical[0] === this.#context.name
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
      this.#context.emitDiagnostic(EntityText.valueScan(this.#context.name))
      const prefix = flatKeyPrefix(this.#context.name)
      for (const physical of scan.readView?.keys === undefined
        ? await this.#context.store.keys(scan.ctx)
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
  /** Reuse the original repository operation through its explicit owner context. */
  async *orderedEntityCandidates(
    scan: IEntityScanContext<TDomain>
  ): AsyncGenerator<IEntityScanCandidate, void, unknown> {
    if (!scan.applyOrdering) {
      yield* this.scanEntityCandidates(scan)
      return
    }
    for await (const candidate of this.scanEntityCandidates(scan))
      scan.candidates.set(
        encodeOrderedStorageKey(candidate.id, this.#context.store.backend),
        candidate
      )
    for (
      let item = scan.options?.direction === 'prev' ? scan.candidates.last : scan.candidates.first;
      item !== undefined;
      item = scan.options?.direction === 'prev' ? item.previous : item.next
    )
      yield item.value
  }
}
