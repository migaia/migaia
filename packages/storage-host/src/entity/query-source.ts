// Scoped, observed and mutating entity query sources for the entity query owner (see ./query-owner.ts).
import { EntityFeatureName } from './constants.ts'
import { systemScheduler } from '@migaia/utils/scheduler'
import { asyncDisposeKey } from '@migaia/plugin-host'
import {
  StorageContractError,
  StorageContractErrorCode,
  RecordQueryMethod,
  type IRecordQuerySource,
  type ITransactionScope,
  type IStorageIterator
} from '@migaia/storage-contract'
import { encodeOrderedStorageKey } from '../authoring/key.ts'
import { compileStorageQueryCondition } from '../authoring/query.ts'
import {
  deriveTransactionIterator,
  nextTransactionIterator,
  runTransactionOperation,
  readTransactionOperationContext
} from '../authoring/transaction.ts'
import { StorageError } from '../errors.ts'
import { StorageHostErrorCode } from '@migaia/storage-contract/error-code'
import { readStorageHookFailureCode } from '../hooks.ts'
import { composeRepositoryKey, composeStructuredKey, decodeRepositoryKey } from './key.ts'
import { encodeFlatStorageKey } from '../core/key-domain.ts'
import { isStorageKeyInRange } from '../core/query-state.ts'
import { createStorageOperationRuntime } from '../core/operation-reporter.ts'
import { EntityText } from './text.ts'
import { type IEntityQueryPlan, type IEntityQuerySourceSelection } from './query-adapter.ts'
import { snapshotOperationContext } from '../authoring/context.ts'
import type { IStorageKey } from '@migaia/storage-contract'
import type { IInvalidRecordIssue } from './types.ts'
import { createOrderedRecordIndex } from '../core/ordered-record-index.ts'
import { EntityState, StorageInvalidRecordAction, StorageRecordStage } from './constants.ts'
import {
  entityRuntime,
  observeEntity,
  entityIterator,
  IStageFailure,
  minimumProjectedIndexKey,
  idOf,
  IEntityQueryExecution,
  IEntityQuerySourceContext,
  IEntityScopedSourceContext,
  IEntityQueryObservation,
  IEntityQueryMutationContext
} from './repository-shared.ts'
import type { EntityRepositoryOwner } from './repository.ts'
import type { EntityQueryOwner } from './query-owner.ts'

/** Own source creation, scoped cursors, observation and mutation for one entity query owner. */
export class EntityQuerySourceOwner<
  TDomain,
  TStored,
  TIndexes extends Readonly<Record<string, IStorageKey>> = Readonly<Record<never, IStorageKey>>,
  TAugmentMethods extends object = {},
  TChangeFeed extends boolean = false
> {
  /** Borrow the original repository state and operations without another executor. */
  readonly #context: EntityRepositoryOwner<TDomain, TStored, TIndexes, TAugmentMethods, TChangeFeed>
  /** Reuse list normalization, scanning and query shaping from the owning query feature. */
  readonly #query: EntityQueryOwner<TDomain, TStored, TIndexes, TAugmentMethods, TChangeFeed>
  /** Capture the repository and the query owner that publishes these sources. */
  constructor(
    context: EntityRepositoryOwner<TDomain, TStored, TIndexes, TAugmentMethods, TChangeFeed>,
    query: EntityQueryOwner<TDomain, TStored, TIndexes, TAugmentMethods, TChangeFeed>
  ) {
    this.#context = context
    this.#query = query
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
        this.advanceScopedEntitySource(sourceContext, next, current as ITransactionScope),
      () => this.closeScopedEntitySource(sourceContext)
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
      this.advanceObservedEntityQuery(observation, next, current as ITransactionScope)
    )
    if (derived !== undefined) return derived
    return {
      next: () => this.advanceObservedEntityQuery(observation, () => iterator.next()),
      return: iterator.return === undefined ? undefined : (value) => iterator.return!(value),
      dispose: () => iterator.dispose(),
      [asyncDisposeKey]: () => iterator[asyncDisposeKey](),
      [Symbol.asyncIterator]() {
        return this
      }
    }
  }

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
      mutate: (request, run) => this.mutateEntitySource(sourceContext, request, run),
      execute: (input) => this.executeEntitySource(sourceContext, input)
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
    const policy = {
      ...(sourceContext.execution.openingSelection ?? sourceContext.selection),
      requireNative:
        sourceContext.execution.openingPlan?.requirePushdown === true &&
        sourceContext.selection.index !== undefined
    }
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
          (target) => this.applyEntityQueryMutation(mutation, target),
          {
            ...request.ctx,
            concurrency: request.concurrency
          }
        )
      : this.applyEntityQueryMutation(mutation, sourceContext.execution.scope)
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
      onInvalid: (sourceContext.execution.openingSelection ?? sourceContext.selection).onInvalid,
      requireNative:
        sourceContext.execution.openingPlan?.requirePushdown === true &&
        sourceContext.selection.index !== undefined
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
      return this.scopedQuerySource(
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
            onRead,
            selection.requireNative
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
      else if (index !== undefined && sourceContext.selection.requireNative === true)
        throw new StorageContractError(StorageContractErrorCode.queryNotPushable)
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
            this.#query.invalidAction(issue, { onInvalid: sourceContext.selection.onInvalid }) ===
            StorageInvalidRecordAction.throw
          )
            this.#query.throwInvalid(issue)
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
              this.#query.invalidAction(issue, {
                onInvalid: sourceContext.selection.onInvalid
              }) === StorageInvalidRecordAction.throw
            )
              this.#query.throwInvalid(issue)
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
      onInvalid: mutation.policy.onInvalid,
      requireNative: mutation.policy.requireNative
    }
    const predicates = conditions.map((condition) =>
      compileStorageQueryCondition<TDomain>(condition)
    )
    return this.scopedQuerySource(
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
      throw new StorageError(StorageHostErrorCode.invalidConfig, {
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
          execute: (input) => this.executeEntityMutationRows(mutation, current, physicalIds, input),
          accept: (_key, value) =>
            this.acceptEntityMutationRow(mutation, current, physicalIds, value)
        })
      } finally {
        physicalIds.clear()
      }
    })
}
