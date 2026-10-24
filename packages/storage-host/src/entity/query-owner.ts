import { EntityFeatureName } from './constants.js'
import { systemScheduler } from '@migaia/utils/scheduler'
import { asyncDisposeKey } from '@migaia/plugin-host'
import { getBackendEntityQueryMethods } from '../core/change-controller.js'
import {
  StorageContractError,
  StorageContractErrorCode,
  RecordQueryMethod,
  type IRecordQuerySource,
  type ITransactionScope,
  type IStorageIterator,
  type IRecordQueryBase
} from '@migaia/storage-contract'
import { snapshotStorageKey, encodeOrderedStorageKey } from '../authoring/key.js'
import { createRecordQuery, compileStorageQueryCondition } from '../authoring/query.js'
import {
  deriveTransactionIterator,
  nextTransactionIterator,
  runTransactionOperation,
  readTransactionOperationContext
} from '../authoring/transaction.js'

import { isStorageErrorFamily } from '../core/error-family.js'
import { StorageError, StorageErrorCode, createStorageTypeError } from '../errors.js'
import { StorageErrorText } from '../error-text.js'
import { readStorageHookFailureCode } from '../hooks.js'

import {
  composeRepositoryKey,
  composeStructuredKey,
  decodeRepositoryKey,
  flatKeyPrefix,
  repositoryEntityRange
} from './key.js'
import { decodeFlatStorageKey, encodeFlatStorageKey, snapshotKeyRange } from '../core/key-domain.js'
import { isStorageKeyInRange } from '../core/query.js'

import { createStorageOperationRuntime } from '../core/operation-reporter.js'
import { EntityText } from './text.js'
import {
  createEntityQuery,
  type IEntityQueryPlan,
  type IEntityQuerySourceSelection
} from './query.js'
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
  observeEntity,
  entityIterator,
  IListSnapshot,
  IEnvelope,
  IStageFailure,
  minimumProjectedIndexKey,
  IRepositoryReadView,
  stageFailure,
  validateLimit,
  validateOrderBy,
  validateListOptions,
  idOf,
  IEntityQueryExecution,
  IEntityQuerySourceContext,
  IEntityScanCandidate,
  IEntityScanContext,
  IEntityScopedSourceContext,
  IEntityQueryObservation,
  IEntityRepositoryBinding,
  IEntityQueryMutationContext
} from './repository-shared.js'

import type { EntityRepositoryOwner } from './repository.js'

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
  /** Capture the original owner before this feature publishes any methods. */
  constructor(
    context: EntityRepositoryOwner<TDomain, TStored, TIndexes, TAugmentMethods, TChangeFeed>
  ) {
    this.#context = context
  }

  /** Reuse the original repository operation through its explicit owner context. */
  invalidAction = (
    issue: IInvalidRecordIssue<TDomain>,
    option: IListSnapshot<TDomain> | undefined
  ): IInvalidRecordAction => this.#context.invokeInvalidHandler(option?.onInvalid, issue)
  /** Reuse the original repository operation through its explicit owner context. */
  validateInvalidHandler = (handler: unknown): void => {
    if (
      handler !== undefined &&
      handler !== 'skip' &&
      handler !== 'throw' &&
      typeof handler !== 'function'
    )
      throw new StorageError(StorageErrorCode.invalidConfig, {
        backend: this.#context.store.backend,
        cause: new TypeError(EntityText.oninvalidMustBeSkipThrowOrAHandler)
      })
  }
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
      throw new StorageError(StorageErrorCode.invalidConfig, {
        backend: this.#context.store.backend,
        cause: new TypeError(EntityText.listDirectionMustBeNextOrPrev)
      })
    this.#context.validateInvalidHandler(onInvalid)
    return { range: rangeSnapshot, limit, orderBy, direction, onInvalid }
  }
  /** Reuse the original repository operation through its explicit owner context. */
  invokeInvalidHandler = (
    handler: IInvalidRecordAction | IInvalidRecordHandler<TDomain> | undefined,
    issue: IInvalidRecordIssue<TDomain>
  ): IInvalidRecordAction => {
    if (handler === undefined || handler === 'skip' || handler === 'throw') return handler ?? 'skip'
    if (typeof handler !== 'function')
      throw new StorageError(StorageErrorCode.invalidConfig, {
        backend: this.#context.store.backend,
        key: issue.key,
        cause: new TypeError(EntityText.oninvalidMustBeSkipThrowOrAHandler)
      })
    try {
      const action = handler(issue)
      if (action !== 'skip' && action !== 'throw')
        throw new StorageError(StorageErrorCode.invalidConfig, {
          backend: this.#context.store.backend,
          key: issue.key,
          cause: new TypeError(EntityText.oninvalidHandlerMustReturnSkipOrThrow)
        })
      return action
    } catch (cause) {
      if (isStorageErrorFamily(cause) && cause.code === StorageErrorCode.invalidConfig) throw cause
      throw new StorageError(StorageErrorCode.validationFailed, {
        backend: this.#context.store.backend,
        key: issue.key,
        cause
      })
    }
  }
  /** Reuse the original repository operation through its explicit owner context. */
  throwInvalid = (issue: IInvalidRecordIssue<TDomain>): never => {
    /* c8 ignore start -- all current decode/migrate/validate stages normalize to StorageError. */
    if (isStorageErrorFamily(issue.cause)) throw issue.cause
    const code =
      issue.stage === StorageRecordStage.migrate
        ? StorageErrorCode.migrationFailed
        : issue.stage === StorageRecordStage.decode
          ? StorageErrorCode.deserializeFailed
          : StorageErrorCode.validationFailed
    throw new StorageError(code, {
      backend: this.#context.store.backend,
      key: issue.key,
      cause: issue.cause
    })
    /* c8 ignore stop */
  }
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
      for await (const row of this.#context.orderedEntityCandidates(scan)) {
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
          if (this.#context.invalidAction(issue, options) === StorageInvalidRecordAction.throw)
            this.#context.throwInvalid(issue)
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
      throw new StorageError(StorageErrorCode.invalidConfig, {
        backend: this.#context.store.backend,
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
                StorageErrorCode.extensionFailed,
                StorageErrorText.entityComparatorInvalid
              )
            return options?.direction === 'prev' ? -result : result
          } catch (cause) {
            throw new StorageError(StorageErrorCode.extensionFailed, {
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
  scopedQuerySource = (
    scope: ITransactionScope,
    selection: IEntityQuerySourceSelection<TDomain>,
    onRead?: () => void,
    orderedSource = true,
    physicalIds?: Map<string, IStorageKey>,
    accepts?: (value: TDomain) => boolean
  ): IStorageIterator<readonly [IStorageKey, TDomain]> => {
    this.#context.backend.assertScope(scope)
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
        this.#context.advanceScopedEntitySource(sourceContext, next, current as ITransactionScope),
      () => this.#context.closeScopedEntitySource(sourceContext)
    )
    return derived!
  }
  /** Reuse the original repository operation through its explicit owner context. */
  observeQueryRead = <R>(
    invoke: () => Promise<R>,
    plan: IEntityQueryPlan,
    selection: IEntityQuerySourceSelection<TDomain>,
    current: ITransactionScope | undefined,
    openedCounter: () => { readCount: number } | undefined,
    returnedCount: (value: R) => number
  ): Promise<R> => {
    if (this.#context.queryStages === undefined) return invoke()
    const stages =
      current === undefined
        ? this.#context.queryStages
        : this.#context.queryStages?.forTransaction(current)
    const started = stages === undefined ? 0 : systemScheduler.now()
    if (stages?.beforeQuery !== undefined)
      observeEntity(stages, () => stages.beforeQuery!(this.#context.name, selection.index, plan))
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
            stages.afterQuery!(this.#context.name, selection.index, {
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
              this.#context.name,
              selection.index,
              readStorageHookFailureCode(cause, stages.report)
            )
          )
        throw cause
      }
    )
  }
  /** Reuse the original repository operation through its explicit owner context. */
  observeQueryStream = <R>(
    iterator: IStorageIterator<R>,
    plan: IEntityQueryPlan,
    selection: IEntityQuerySourceSelection<TDomain>,
    counter: { readCount: number } | undefined
  ): IStorageIterator<R> => {
    if (this.#context.queryStages === undefined) return iterator
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
      this.#context.advanceObservedEntityQuery(observation, next, current as ITransactionScope)
    )
    if (derived !== undefined) return derived
    return {
      next: () => this.#context.advanceObservedEntityQuery(observation, () => iterator.next()),
      return: iterator.return === undefined ? undefined : (value) => iterator.return!(value),
      dispose: () => iterator.dispose(),
      [asyncDisposeKey]: () => iterator[asyncDisposeKey](),
      [Symbol.asyncIterator]() {
        return this
      }
    }
  }
  /** Reuse the original repository operation through its explicit owner context. */
  queryFor = <C extends IOperationContext | undefined>(
    scope?: ITransactionScope
  ): IEntityQuery<TDomain, TIndexes, C, TAugmentMethods> => {
    /** Synchronous terminal opening shares these facts with its actual source. */
    const execution: IEntityQueryExecution<TDomain> = { scope }
    return createEntityQuery<TDomain, TIndexes, C, TAugmentMethods>({
      predicate: this.#context.queryPredicate,
      keyset: (invoke) => this.#context.runKeyset(invoke),
      selector: this.#context.querySelector,
      mapper: this.#context.queryMapper,
      comparator: this.#context.queryComparator,
      methods: getBackendEntityQueryMethods(this.#context.store) as TAugmentMethods | undefined,
      defaultComparator: this.#context.defaultOrderBy,
      run: (invoke, plan, selection, count) =>
        this.#context.runEntityQuery(execution, invoke, plan, selection, count),
      stream: (open, plan, selection) =>
        this.#context.streamEntityQuery(execution, open, plan, selection),
      missingLimit: this.#context.queryMissingLimit,
      invalidState: this.#context.queryInvalidState,
      invalid: this.#context.queryInvalid,
      range: this.#context.queryRange,
      index: (name, match) => this.#context.queryIndex(name, match),
      source: (selection) => this.#context.createEntitySource(execution, selection)
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
      throw new StorageError(StorageErrorCode.extensionFailed, {
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
      throw new StorageError(StorageErrorCode.extensionFailed, {
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
      throw new StorageError(StorageErrorCode.extensionFailed, {
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
      throw new StorageError(StorageErrorCode.extensionFailed, {
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
        return this.#context.observeQueryRead(
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
    return this.#context.observeQueryStream(iterator, plan, selection, execution.opened)
  }
  /** Reuse the original repository operation through its explicit owner context. */
  queryMissingLimit: Parameters<
    typeof createEntityQuery<TDomain, TIndexes, IOperationContext, TAugmentMethods>
  >[0]['missingLimit'] = () => {
    throw new StorageError(StorageErrorCode.invalidConfig, {
      backend: this.#context.store.backend,
      cause: new TypeError(EntityText.comparatorLimit)
    })
  }
  /** Reuse the original repository operation through its explicit owner context. */
  queryInvalidState: Parameters<
    typeof createEntityQuery<TDomain, TIndexes, IOperationContext, TAugmentMethods>
  >[0]['invalidState'] = (cause) => {
    throw new StorageError(StorageErrorCode.invalidConfig, {
      backend: this.#context.store.backend,
      cause: cause ?? new TypeError(EntityText.queryState)
    })
  }
  /** Reuse the original repository operation through its explicit owner context. */
  queryInvalid: Parameters<
    typeof createEntityQuery<TDomain, TIndexes, IOperationContext, TAugmentMethods>
  >[0]['invalid'] = (action) => {
    this.#context.normalizeListOptions({ onInvalid: action as IInvalidRecordAction })
  }
  /** Reuse the original repository operation through its explicit owner context. */
  queryRange: Parameters<
    typeof createEntityQuery<TDomain, TIndexes, IOperationContext, TAugmentMethods>
  >[0]['range'] = (range) => snapshotKeyRange(range, this.#context.store.backend)!
  /** Reuse the original repository operation through its explicit owner context. */
  createEntitySource = (
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
      ...(execution.scope !== undefined || this.#context.backend.watchRecords === undefined
        ? {}
        : {
            watch: ({ ctx }: import('@migaia/storage-contract').IRecordQueryInput) =>
              this.#context.backend.watchRecords!(ctx)
          }),
      ...(this.#context.hasFeature(EntityFeatureName.indexes)
        ? {
            plan: (conditions: Parameters<NonNullable<IRecordQuerySource['plan']>>[0]) =>
              this.#context.planEntitySource(sourceContext, conditions)
          }
        : {}),
      mutate: (request, run) => this.#context.mutateEntitySource(sourceContext, request, run),
      execute: (input) => this.#context.executeEntitySource(sourceContext, input)
    }
  }
  /** Reuse the original repository operation through its explicit owner context. */
  mutateEntitySource = (
    sourceContext: IEntityQuerySourceContext<TDomain>,
    request: Parameters<NonNullable<IRecordQuerySource['mutate']>>[0],
    run: Parameters<NonNullable<IRecordQuerySource['mutate']>>[1]
  ): ReturnType<NonNullable<IRecordQuerySource['mutate']>> => {
    if (this.#context.recordStore === undefined)
      throw new StorageContractError(StorageContractErrorCode.unsupported, {
        backend: this.#context.store.backend
      })
    /** Capture the same observer/source facts before the original transaction can suspend. */
    const policy = sourceContext.execution.openingSelection ?? sourceContext.selection
    const orderedSource = sourceContext.execution.openingPlan?.hasOrder !== true
    const counter = this.#context.queryStages === undefined ? undefined : { readCount: 0 }
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
      ? this.#context.recordStore.transaction(
          (target) => this.#context.applyEntityQueryMutation(mutation, target),
          {
            ...request.ctx,
            concurrency: request.concurrency
          }
        )
      : this.#context.applyEntityQueryMutation(mutation, sourceContext.execution.scope)
  }
  /** Reuse the original repository operation through its explicit owner context. */
  executeEntitySource = (
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
    const counter = this.#context.queryStages === undefined ? undefined : { readCount: 0 }
    sourceContext.execution.opened = counter
    const onRead =
      counter === undefined
        ? undefined
        : () => {
            counter.readCount++
          }
    const orderedSource = sourceContext.execution.openingPlan?.hasOrder !== true
    if (sourceContext.execution.scope !== undefined)
      return this.#context.scopedQuerySource(
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
          const snapshot = repositoryOwner.createIndexedListSnapshot(
            selection.index,
            selection.range,
            {
              onInvalid: selection.onInvalid
            }
          )
          for await (const [id, row] of repositoryOwner.indexRows(
            snapshot,
            context,
            undefined,
            orderedSource,
            onRead
          ))
            if (accepts(row.value)) yield [[row.key, id], row.value] as const
        } else {
          for await (const value of repositoryOwner.streamImpl(
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
                    repositoryOwner.name,
                    repositoryOwner.keyProp,
                    value,
                    repositoryOwner.store.backend
                  )
                ],
                value
              ] as const
        }
      })(this.#context),
      runtime
    )
  }
  /** Reuse the original repository operation through its explicit owner context. */
  boundQuery = (
    binding: IEntityRepositoryBinding
  ): ReturnType<IEntityTransactionScope<TDomain, TIndexes, TAugmentMethods>['query']> =>
    this.#context.queryFor<undefined>(binding.scope)
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
      const normalized = indexed?.options ?? this.#context.normalizeListOptions(options)
      const counter = this.#context.queryStages === undefined ? undefined : { readCount: 0 }
      const onRead =
        counter === undefined
          ? undefined
          : () => {
              counter.readCount++
            }
      const query =
        indexed === undefined
          ? this.#context.listQuery(normalized, context, entityRuntime(current), view, onRead)
          : this.#context.createIndexQuery(indexed, context, view, onRead)
      return this.#context.observeQueryRead(
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
    this.#context.queryFor<IOperationContext>() as ReturnType<
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
    const normalized = indexed?.options ?? this.#context.normalizeListOptions(options)
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
        ? this.#context.listQuery(
            normalized,
            context,
            createStorageOperationRuntime(),
            undefined,
            onRead
          )
        : this.#context.createIndexQuery(indexed, context, undefined, onRead)
    return this.#context.observeQueryRead(
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
    const normalized = indexed?.options ?? this.#context.normalizeListOptions(options)
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
        ? this.#context.listQuery(
            normalized,
            context,
            createStorageOperationRuntime(),
            undefined,
            onRead
          )
        : this.#context.createIndexQuery(indexed, context, undefined, onRead)
    return this.#context.observeQueryStream(
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
      yield* this.#context.scanEntityCandidates(scan)
      return
    }
    for await (const candidate of this.#context.scanEntityCandidates(scan))
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
  /** Reuse the original repository operation through its explicit owner context. */
  advanceScopedEntitySource = async (
    sourceContext: IEntityScopedSourceContext<TDomain>,
    next: () => Promise<IteratorResult<[IStorageKey, unknown]>>,
    currentScope: ITransactionScope
  ): Promise<IteratorResult<readonly [IStorageKey, TDomain]>> => {
    const current = currentScope as ITransactionScope
    this.#context.backend.assertScope(current)
    const context = readTransactionOperationContext(current)
    const runtime = entityRuntime(current)
    const index =
      sourceContext.selection.index === undefined
        ? undefined
        : this.#context.config.indexes[sourceContext.selection.index]
    if (!sourceContext.initialized) {
      sourceContext.initialized = true
      const handle =
        this.#context.readyHandle !== undefined &&
        index !== undefined &&
        (await current.isRecordIndexReady?.(this.#context.readyHandle))
          ? this.#context.readyHandle
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
        const canonical = decodeRepositoryKey(this.#context.name, physical)
        const legacy =
          Array.isArray(physical) && physical.length === 2 && physical[0] === this.#context.name
            ? (physical[1] as IStorageKey)
            : undefined
        const physicalId = canonical ?? legacy
        if (physicalId === undefined) continue
        sourceContext.onRead?.()
        if (
          legacy !== undefined &&
          canonical === undefined &&
          (await current.getRecord(composeRepositoryKey(this.#context.name, legacy))) !== undefined
        )
          continue
        let value: TDomain | undefined
        try {
          value = await this.#context.materialize(
            await this.#context.decodeEnvelope(raw, context, runtime),
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
            this.#context.invalidAction(issue, { onInvalid: sourceContext.selection.onInvalid }) ===
            StorageInvalidRecordAction.throw
          )
            this.#context.throwInvalid(issue)
          this.#context.emitDiagnostic(EntityText.invalidRecord(this.#context.name, physicalId))
        }
        if (value === undefined) continue
        const id = idOf(
          this.#context.name,
          this.#context.keyProp,
          value,
          this.#context.store.backend
        )
        const identity = encodeFlatStorageKey(id)
        if (sourceContext.seen.has(identity)) continue
        let ordering: IStorageKey = [id]
        let encodedOrdering: Uint8Array | undefined
        if (index !== undefined) {
          let projection: ReturnType<typeof index.project>
          try {
            projection = index.project(value, this.#context.store.backend)
          } catch (cause) {
            const issue: IInvalidRecordIssue<TDomain> = {
              key: physicalId,
              raw,
              stage: StorageRecordStage.validate,
              cause
            }
            if (
              this.#context.invalidAction(issue, {
                onInvalid: sourceContext.selection.onInvalid
              }) === StorageInvalidRecordAction.throw
            )
              this.#context.throwInvalid(issue)
            this.#context.emitDiagnostic(EntityText.invalidRecord(this.#context.name, physicalId))
            continue
          }
          const first = minimumProjectedIndexKey(projection, sourceContext.selection.range)
          if (first === undefined) continue
          ordering = [first, id]
          if (sourceContext.orderedSource)
            encodedOrdering = this.#context.encodeIndexOrder(first, id)
        } else if (!isStorageKeyInRange(id, sourceContext.selection.range)) continue
        if (sourceContext.seen instanceof Map) sourceContext.seen.set(identity, physicalId)
        else sourceContext.seen.add(identity)
        if (sourceContext.accepts !== undefined && !sourceContext.accepts(value)) continue
        if (!sourceContext.orderedSource) return { done: false, value: [ordering, value] as const }
        sourceContext.rows.set(
          encodedOrdering ?? encodeOrderedStorageKey(id, this.#context.store.backend),
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
  /** Reuse the original repository operation through its explicit owner context. */
  closeScopedEntitySource = async (
    sourceContext: IEntityScopedSourceContext<TDomain>
  ): Promise<void> => {
    try {
      await sourceContext.cursor?.dispose()
    } finally {
      sourceContext.rows.clear()
      if (sourceContext.physicalIds === undefined) sourceContext.seen.clear()
    }
  }
  /** Reuse the original repository operation through its explicit owner context. */
  advanceObservedEntityQuery = async <R>(
    observation: IEntityQueryObservation<TDomain, R>,
    next: () => Promise<IteratorResult<R>>,
    current?: ITransactionScope
  ): Promise<IteratorResult<R>> => {
    const stages =
      current === undefined
        ? this.#context.queryStages
        : this.#context.queryStages?.forTransaction(current)
    const started = stages === undefined ? 0 : systemScheduler.now()
    if (stages?.beforeQuery !== undefined)
      observeEntity(stages, () =>
        stages.beforeQuery!(this.#context.name, observation.selection.index, observation.plan)
      )
    try {
      const value = await next()
      if (!value.done) observation.returnedCount++
      if (stages !== undefined) observation.elapsedMs += systemScheduler.now() - started
      if (stages?.afterQuery !== undefined)
        observeEntity(stages, () =>
          stages.afterQuery!(this.#context.name, observation.selection.index, {
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
            this.#context.name,
            observation.selection.index,
            readStorageHookFailureCode(cause, stages.report)
          )
        )
      throw cause
    }
  }
  /** Reuse the original repository operation through its explicit owner context. */
  executeEntityMutationRows = (
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
    return this.#context.scopedQuerySource(
      current,
      selection,
      mutation.onRead,
      mutation.orderedSource,
      physicalIds,
      (value) => predicates.every((predicate) => predicate(value))
    )
  }
  /** Reuse the original repository operation through its explicit owner context. */
  acceptEntityMutationRow = async (
    mutation: IEntityQueryMutationContext<TDomain>,
    current: ITransactionScope,
    physicalIds: Map<string, IStorageKey>,
    value: unknown
  ): Promise<boolean> => {
    const id = idOf(
      this.#context.name,
      this.#context.keyProp,
      value as TDomain,
      this.#context.store.backend
    )
    const physicalId = physicalIds.get(encodeFlatStorageKey(id))
    if (physicalId === undefined)
      throw new StorageError(StorageErrorCode.invalidConfig, {
        backend: this.#context.store.backend,
        cause: new TypeError(EntityText.queryIdentityChanged)
      })
    /** Count only rows still present in this same draft after selection callbacks. */
    const raw =
      (await current.getRecord(composeRepositoryKey(this.#context.name, physicalId))) ??
      (await current.getRecord(composeStructuredKey(this.#context.name, physicalId)))
    if (raw === undefined) return false
    if (mutation.request.operation === RecordQueryMethod.delete)
      await this.#context.bindRepository(current).remove(physicalId)
    else
      await this.#context.bindRepository(current, physicalId).put({
        ...(value as TDomain),
        ...mutation.request.patch
      })
    return true
  }
  /** Reuse the original repository operation through its explicit owner context. */
  applyEntityQueryMutation = (
    mutation: IEntityQueryMutationContext<TDomain>,
    target: ITransactionScope
  ): Promise<number> =>
    runTransactionOperation(target, async (current) => {
      this.#context.backend.assertScope(current)
      /** This is the source's original seen table, not an index or a retained row cache. */
      const physicalIds = new Map<string, IStorageKey>()
      try {
        return await mutation.run({
          execute: (input) =>
            this.#context.executeEntityMutationRows(mutation, current, physicalIds, input),
          accept: (_key, value) =>
            this.#context.acceptEntityMutationRow(mutation, current, physicalIds, value)
        })
      } finally {
        physicalIds.clear()
      }
    })
}
