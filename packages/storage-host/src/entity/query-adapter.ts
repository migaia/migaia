import type { createRecordQueryWithoutKeyset } from '../authoring/query.js'
import {
  type IOperationContext,
  type IRecordQuery,
  type IRecordQueryBase,
  type IQueryRead,
  type IQueryStatistics,
  type IQueryPages,
  type IQueryResult,
  type IRecordQuerySource,
  type IStorageKey,
  type IStorageIterator,
  type IKeyRange
} from '@migaia/storage-contract'
import type {
  IEntityQuery,
  IEntityQueryNarrowed,
  IEntityQueryNeedsLimit,
  IInvalidRecordHandler,
  IInvalidRecordAction
} from './types.js'

/** Entity source choices are immutable and contain no native cursor or transaction authority. */
export type IEntityQuerySourceSelection<T> = Readonly<{
  index?: string
  range?: IKeyRange
  onInvalid?: IInvalidRecordAction | IInvalidRecordHandler<T>
}>

/** These three observer flags describe only the current immutable shared-core branch. */
export type IEntityQueryPlan = Readonly<{ hasWhere: boolean; hasOrder: boolean; hasLimit: boolean }>

/** Adapt source selection to the original record-query creator; all AST and execution stay there. */
/** Shared entity adapter ports; the canonical query owner retains AST and resource execution. */
type IEntityQueryInput<
  T,
  _TIndexes extends Readonly<Record<string, IStorageKey>>,
  _TContext extends IOperationContext | undefined,
  TMethods extends object
> = {
  /** Keyset methods require their independent explicit assembly before preparing a source. */
  readonly keyset: <R>(invoke: () => R) => R
  /** Query-only construction omits the actual keyset owner; its unit supplies the full creator. */
  readonly query: typeof createRecordQueryWithoutKeyset
  readonly source: (selection: IEntityQuerySourceSelection<T>) => IRecordQuerySource
  readonly index: (name: string, match: unknown) => IEntityQuerySourceSelection<T>
  readonly range: (range: IKeyRange) => IKeyRange
  readonly invalid: (action: unknown) => void
  readonly methods: TMethods | undefined
  readonly run: <R>(
    invoke: () => Promise<R>,
    plan: IEntityQueryPlan,
    selection: IEntityQuerySourceSelection<T>,
    returnedCount: (value: R) => number
  ) => Promise<R>
  readonly stream: <R>(
    open: () => IStorageIterator<R>,
    plan: IEntityQueryPlan,
    selection: IEntityQuerySourceSelection<T>
  ) => IStorageIterator<R>
  readonly defaultComparator?: (left: T, right: T) => number
  readonly missingLimit: () => never
  readonly invalidState: (cause?: unknown) => never
  readonly selector: (fn: (value: T) => IStorageKey) => (value: T) => IStorageKey
  readonly predicate: (fn: (value: T) => unknown) => (value: T) => boolean
  readonly mapper: (fn: (value: T) => unknown) => (value: T) => Promise<unknown>
  readonly comparator: (fn: (left: T, right: T) => number) => (left: T, right: T) => number
}
/** A source choice and wrapped default comparator belong to one entity adapter declaration. */
type IEntityQueryContext<
  T,
  TIndexes extends Readonly<Record<string, IStorageKey>>,
  TContext extends IOperationContext | undefined,
  TMethods extends object
> = {
  readonly input: IEntityQueryInput<T, TIndexes, TContext, TMethods>
  readonly selection: IEntityQuerySourceSelection<T>
  readonly defaultComparator: ((left: T, right: T) => number) | undefined
}
/** Branch facts retain the original persistent core query, never replayed configuration. */
type IEntityQueryBranchState<
  T,
  TContext extends IOperationContext | undefined,
  TMethods extends object
> = {
  readonly query: IRecordQuery<T, TContext, TMethods>
  readonly limit: number | undefined
  readonly explicit: boolean
  readonly plan: IEntityQueryPlan
  readonly invalid: IInvalidRecordAction | IInvalidRecordHandler<T> | undefined
  readonly skip: number
  readonly compared: ((left: T, right: T) => number) | undefined
  readonly sourceOpen: boolean
}
/** The original terminal contracts provide contextual overloads for own class arrow methods. */
type IEntityQueryReadMethods<R, TContext extends IOperationContext | undefined> = Omit<
  IQueryRead<R, TContext>,
  'explain'
> &
  IQueryStatistics<R, TContext> &
  IQueryPages<R, TContext>
/** Original query preparation remains finite and stateless between actual terminal invocations. */
type IEntityQueryReadPreparation<R, TContext extends IOperationContext | undefined> = (
  first?: true
) => IQueryRead<R, TContext> & IQueryStatistics<R, TContext> & IQueryPages<R, TContext>
/** One terminal adapter holds explicit declaration/plan ports while the original operation runs. */
class EntityQueryReads<
  T,
  TIndexes extends Readonly<Record<string, IStorageKey>>,
  TContext extends IOperationContext | undefined,
  TMethods extends object,
  R
> {
  /** The entity input owns run/stream; this adapter never introduces a lifecycle or source. */
  readonly #context: IEntityQueryContext<T, TIndexes, TContext, TMethods>
  /** Original preparation opens the same canonical branch only when a terminal asks. */
  readonly #prepare: IEntityQueryReadPreparation<R, TContext>
  /** Count preserves the original page without introducing unused comparator work. */
  readonly #countQuery: IEntityQueryReadPreparation<R, TContext>
  /** Observer flags describe only this branch's actual operations. */
  readonly #plan: IEntityQueryPlan
  /** Invalid-record behavior belongs to this branch and is forwarded unchanged. */
  readonly #invalid: IInvalidRecordAction | IInvalidRecordHandler<T> | undefined
  /** Retain only the original operation ports and immutable branch choices. */
  constructor(
    context: IEntityQueryContext<T, TIndexes, TContext, TMethods>,
    prepare: IEntityQueryReadPreparation<R, TContext>,
    plan: IEntityQueryPlan,
    invalid: IInvalidRecordAction | IInvalidRecordHandler<T> | undefined,
    countQuery: IEntityQueryReadPreparation<R, TContext> = prepare
  ) {
    this.#context = context
    this.#prepare = prepare
    this.#countQuery = countQuery
    this.#plan = plan
    this.#invalid = invalid
  }
  /** Delegate page to the original query through the entity operation observer. */
  readonly page: IEntityQueryReadMethods<R, TContext>['page'] = async (size, ctx) =>
    this.#context.input.run(
      () => this.#context.input.keyset(() => this.#prepare().page(size, ctx)),
      this.#plan,
      { ...this.#context.selection, onInvalid: this.#invalid },
      (page) => page.items.length
    )
  /** Delegate all to the original query through the entity operation observer. */
  readonly all: IEntityQueryReadMethods<R, TContext>['all'] = (ctx) =>
    this.#context.input.run(
      () => this.#prepare().all(ctx),
      this.#plan,
      { ...this.#context.selection, onInvalid: this.#invalid },
      (rows) => rows.length
    )
  /** Delegate first to the original query through the entity operation observer. */
  readonly first: IEntityQueryReadMethods<R, TContext>['first'] = (ctx) =>
    this.#context.input.run(
      () => this.#prepare(true).first(ctx),
      { ...this.#plan, hasLimit: true },
      { ...this.#context.selection, onInvalid: this.#invalid },
      (row) => (row === undefined ? 0 : 1)
    )
  /** Delegate maybe to the original query through the entity operation observer. */
  readonly maybe: IEntityQueryReadMethods<R, TContext>['maybe'] = (ctx) =>
    this.#context.input.run(
      () => this.#prepare().maybe(ctx),
      this.#plan,
      { ...this.#context.selection, onInvalid: this.#invalid },
      (value) => (value.some ? 1 : 0)
    )
  /** Delegate firstOrThrow to the original query through the entity operation observer. */
  readonly firstOrThrow: IEntityQueryReadMethods<R, TContext>['firstOrThrow'] = (ctx) =>
    this.#context.input.run(
      () => this.#prepare().firstOrThrow(ctx),
      this.#plan,
      { ...this.#context.selection, onInvalid: this.#invalid },
      () => 1
    )
  /** Delegate pluck to the original query through the entity operation observer. */
  readonly pluck: IEntityQueryReadMethods<R, TContext>['pluck'] = (field, ctx) =>
    this.#context.input.run(
      () => this.#prepare().pluck(field, ctx),
      this.#plan,
      { ...this.#context.selection, onInvalid: this.#invalid },
      (values) => values.length
    )
  /** Delegate exists to the original query through the entity operation observer. */
  readonly exists: IEntityQueryReadMethods<R, TContext>['exists'] = (ctx) =>
    this.#context.input.run(
      () => this.#prepare().exists(ctx),
      this.#plan,
      { ...this.#context.selection, onInvalid: this.#invalid },
      (value) => (value ? 1 : 0)
    )
  /** Delegate count to the original query through the entity operation observer. */
  readonly count: IEntityQueryReadMethods<R, TContext>['count'] = (ctx) =>
    this.#context.input.run(
      () => this.#countQuery().count(ctx),
      { ...this.#plan, hasOrder: false },
      { ...this.#context.selection, onInvalid: this.#invalid },
      (count) => count
    )
  /** Delegate each to the original query through the entity operation observer. */
  readonly each: IEntityQueryReadMethods<R, TContext>['each'] = (fn, ctx) =>
    this.#context.input.run(
      () => this.#prepare().each(fn, ctx),
      this.#plan,
      { ...this.#context.selection, onInvalid: this.#invalid },
      (count) => count
    )
  /** Delegate chunk to the original query through the entity operation observer. */
  readonly chunk: IEntityQueryReadMethods<R, TContext>['chunk'] = (size, fn, ctx) =>
    this.#context.input.run(
      () => this.#prepare().chunk(size, fn, ctx),
      this.#plan,
      { ...this.#context.selection, onInvalid: this.#invalid },
      (count) => count
    )
  /** Delegate min to the original query through the entity operation observer. */
  readonly min: IEntityQueryReadMethods<R, TContext>['min'] = (field, ctx) =>
    this.#context.input.run(
      () => this.#prepare().min(field, ctx),
      this.#plan,
      { ...this.#context.selection, onInvalid: this.#invalid },
      (value) => (value.some ? 1 : 0)
    )
  /** Delegate max to the original query through the entity operation observer. */
  readonly max: IEntityQueryReadMethods<R, TContext>['max'] = (field, ctx) =>
    this.#context.input.run(
      () => this.#prepare().max(field, ctx),
      this.#plan,
      { ...this.#context.selection, onInvalid: this.#invalid },
      (value) => (value.some ? 1 : 0)
    )
  /** Delegate sum to the original query through the entity operation observer. */
  readonly sum: IEntityQueryReadMethods<R, TContext>['sum'] = (field, ctx) =>
    this.#context.input.run(
      () => this.#prepare().sum(field, ctx),
      this.#plan,
      { ...this.#context.selection, onInvalid: this.#invalid },
      () => 1
    )
  /** Delegate avg to the original query through the entity operation observer. */
  readonly avg: IEntityQueryReadMethods<R, TContext>['avg'] = (field, ctx) =>
    this.#context.input.run(
      () => this.#prepare().avg(field, ctx),
      this.#plan,
      { ...this.#context.selection, onInvalid: this.#invalid },
      (value) => (value.some ? 1 : 0)
    )
  /** Delegate stream to the original query through the entity operation observer. */
  readonly stream: IEntityQueryReadMethods<R, TContext>['stream'] = (ctx) =>
    this.#context.input.stream(() => this.#prepare().stream(ctx), this.#plan, {
      ...this.#context.selection,
      onInvalid: this.#invalid
    })
}
/** Apply existing page bounds after source filtering and ordering. */
function pageEntityQuery<
  T,
  TContext extends IOperationContext | undefined,
  TMethods extends object
>(
  query: IRecordQuery<T, TContext, TMethods>,
  limit: number | undefined,
  skip: number
): IRecordQuery<T, TContext, TMethods> {
  const offset = skip === 0 ? query : query.skip(skip)
  return limit === undefined ? offset : offset.limit(limit)
}
/** Bound only comparator work; native filter/order/page execution remains canonical. */
function prepareEntityQuery<
  T,
  TIndexes extends Readonly<Record<string, IStorageKey>>,
  TContext extends IOperationContext | undefined,
  TMethods extends object
>(
  context: IEntityQueryContext<T, TIndexes, TContext, TMethods>,
  query: IRecordQuery<T, TContext, TMethods>,
  limit: number | undefined,
  explicit: boolean,
  skip: number,
  compared: ((left: T, right: T) => number) | undefined,
  first?: true
): IRecordQueryBase<T, TContext, TMethods> {
  const bound = first === true ? Math.min(limit ?? 1, 1) : limit
  if (bound === 0) return query.limit(0)
  if (!compared && (explicit || context.input.defaultComparator === undefined))
    return pageEntityQuery(query, bound, skip)
  if (bound === undefined) return context.input.missingLimit()
  const capacity = skip + bound
  if (!Number.isSafeInteger(capacity)) return context.input.invalidState()
  const ordered = query.orderByComparator(compared ?? context.defaultComparator!).limit(capacity)
  return pageEntityQuery(ordered as IRecordQuery<T, TContext, TMethods>, bound, skip)
}
/** A projected branch retains its prepared view and the same terminal Promise behavior. */
class EntityQueryResult<
  T,
  TIndexes extends Readonly<Record<string, IStorageKey>>,
  TContext extends IOperationContext | undefined,
  TMethods extends object,
  R
> {
  /** The original entity owner supplies all run/stream/error ports. */
  readonly #context: IEntityQueryContext<T, TIndexes, TContext, TMethods>
  /** Original canonical projection preserves augmentation and count semantics. */
  readonly #query: IQueryResult<R, TContext, true, TMethods>
  /** The original plan records exactly the projected branch's observer flags. */
  readonly #plan: IEntityQueryPlan
  /** Projection retains the declared invalid-record behavior. */
  readonly #invalid: IInvalidRecordAction | IInvalidRecordHandler<T> | undefined
  /** Preparation applies existing default-comparator bounds only when a read requires them. */
  readonly #prepareResult: (first?: true) => IQueryResult<R, TContext, true, TMethods>
  /** Bind the original projection without freezing or copying its runtime owner. */
  constructor(
    context: IEntityQueryContext<T, TIndexes, TContext, TMethods>,
    query: IQueryResult<R, TContext, true, TMethods>,
    plan: IEntityQueryPlan,
    invalid: IInvalidRecordAction | IInvalidRecordHandler<T> | undefined,
    prepareResult: (first?: true) => IQueryResult<R, TContext, true, TMethods> = () => query
  ) {
    this.#context = context
    this.#query = query
    this.#plan = plan
    this.#invalid = invalid
    this.#prepareResult = prepareResult
  }
  /** Publish only the original facade fields and finite entity guards. */
  view(): IQueryResult<R, TContext, true, TMethods> {
    return {
      ...this.#query,
      ...new EntityQueryReads(
        this.#context,
        this.#prepareResult,
        this.#plan,
        this.#invalid,
        () => this.#query
      ),
      // Hidden type-state methods reject dynamic JavaScript use before any source is opened.
      index: () => this.#context.input.invalidState(),
      range: () => this.#context.input.invalidState(),
      where: () => this.#context.input.invalidState(),
      select: () => this.#context.input.invalidState(),
      distinct: () => this.#context.input.invalidState(),
      skip: () => this.#context.input.invalidState(),
      after: () => this.#context.input.invalidState(),
      limit: () => this.#context.input.invalidState(),
      orderBy: () => this.#context.input.invalidState(),
      orderByComparator: () => this.#context.input.invalidState(),
      onInvalid: () => this.#context.input.invalidState(),
      explain: () => this.#prepareResult().explain(),
      requirePushdown: (): IQueryResult<R, TContext, true, TMethods> =>
        wrapEntityQueryResult(
          this.#context,
          this.#query.requirePushdown(),
          this.#plan,
          this.#invalid,
          (first) => this.#prepareResult(first).requirePushdown()
        )
    } as IQueryResult<R, TContext, true, TMethods>
  }
}
/** Construct one finite projection adapter; no query/source/resource owner is duplicated. */
function wrapEntityQueryResult<
  T,
  TIndexes extends Readonly<Record<string, IStorageKey>>,
  TContext extends IOperationContext | undefined,
  TMethods extends object,
  R
>(
  context: IEntityQueryContext<T, TIndexes, TContext, TMethods>,
  query: IQueryResult<R, TContext, true, TMethods>,
  plan: IEntityQueryPlan,
  invalid: IInvalidRecordAction | IInvalidRecordHandler<T> | undefined,
  prepareResult: (first?: true) => IQueryResult<R, TContext, true, TMethods> = () => query
): IQueryResult<R, TContext, true, TMethods> {
  return new EntityQueryResult(context, query, plan, invalid, prepareResult).view()
}
/** Comparator admission retains one original callback until its required finite bound is supplied. */
class EntityQueryComparator<
  T,
  TIndexes extends Readonly<Record<string, IStorageKey>>,
  TContext extends IOperationContext | undefined,
  TMethods extends object
> {
  /** Entity operation and callback error semantics remain on the existing input ports. */
  readonly #context: IEntityQueryContext<T, TIndexes, TContext, TMethods>
  /** Canonical query and paging facts are the same persistent branch selected by the caller. */
  readonly #state: IEntityQueryBranchState<T, TContext, TMethods>
  /** The original validated comparator identity is reused by first/limit. */
  readonly #captured: (left: T, right: T) => number
  /** Retain only the branch declaration, not a cursor or operation lifetime. */
  constructor(
    context: IEntityQueryContext<T, TIndexes, TContext, TMethods>,
    state: IEntityQueryBranchState<T, TContext, TMethods>,
    captured: (left: T, right: T) => number
  ) {
    this.#context = context
    this.#state = state
    this.#captured = captured
  }
  /** Delegate the original bounded comparator first path. */
  readonly first: IEntityQueryNeedsLimit<T, TContext, TMethods>['first'] = (ctx?: TContext) =>
    this.#context.input.run(
      () =>
        prepareEntityQuery(
          this.#context,
          this.#state.query,
          this.#state.limit,
          true,
          this.#state.skip,
          this.#captured,
          true
        ).first(ctx),
      { ...this.#state.plan, hasOrder: true, hasLimit: true },
      { ...this.#context.selection, onInvalid: this.#state.invalid },
      (row) => (row === undefined ? 0 : 1)
    )
  /** Delegate the original bounded comparator limit path. */
  readonly limit: IEntityQueryNeedsLimit<T, TContext, TMethods>['limit'] = (count: number) => {
    try {
      this.#state.query.limit(count)
    } catch (cause) {
      return this.#context.input.invalidState(cause)
    }
    return wrapEntityQuery(
      this.#context,
      this.#state.query,
      count,
      true,
      { ...this.#state.plan, hasOrder: true, hasLimit: true },
      this.#state.invalid,
      this.#state.skip,
      this.#captured
    )
  }
  /** Preserve custom methods while exposing only the original bounded-state terminals. */
  view(): IEntityQueryNeedsLimit<T, TContext, TMethods> {
    return { ...this.#context.input.methods, first: this.first, limit: this.limit }
  }
}
/** Every branch owns explicit facts; canonical queries continue to own actual execution. */
class EntityQueryBranch<
  T,
  TIndexes extends Readonly<Record<string, IStorageKey>>,
  TContext extends IOperationContext | undefined,
  TMethods extends object
> {
  /** Entity source and operation ports are shared across this adapter's persistent branches. */
  readonly #context: IEntityQueryContext<T, TIndexes, TContext, TMethods>
  /** Branch choices are replaced by new branches rather than mutated or replayed. */
  readonly #state: IEntityQueryBranchState<T, TContext, TMethods>
  /** Bind one original canonical query to its declared entity state. */
  constructor(
    context: IEntityQueryContext<T, TIndexes, TContext, TMethods>,
    state: IEntityQueryBranchState<T, TContext, TMethods>
  ) {
    this.#context = context
    this.#state = state
  }
  /** Preserve original where overloads and canonical input admission. */
  readonly where = ((...args: readonly unknown[]) =>
    wrapEntityQuery(
      this.#context,
      (
        this.#state.query as unknown as {
          where(...args: readonly unknown[]): IRecordQuery<T, TContext, TMethods>
        }
      ).where(
        ...(typeof args[0] === 'function'
          ? [this.#context.input.predicate(args[0] as (value: T) => unknown)]
          : args)
      ),
      this.#state.limit,
      this.#state.explicit,
      { ...this.#state.plan, hasWhere: true },
      this.#state.invalid,
      this.#state.skip,
      this.#state.compared
    )) as IEntityQueryNarrowed<T, TIndexes, TContext, TMethods>['where']
  /** Preserve original select overloads and canonical input admission. */
  readonly select = ((...args: readonly unknown[]) => {
    /** Public projection arguments are validated now; its wrapped mapper is captured once. */
    const captured =
      typeof args[0] === 'function'
        ? [this.#context.input.mapper(args[0] as (value: T) => unknown)]
        : args
    /** Count keeps the current page without introducing the unused default comparator. */
    const unprepared = pageEntityQuery(this.#state.query, this.#state.limit, this.#state.skip)
    /** This immutable canonical branch retains the validated fields and original augmentation. */
    const selected = (
      unprepared as unknown as {
        select(...args: readonly unknown[]): IQueryResult<unknown, TContext, true, TMethods>
      }
    ).select(...captured)
    return wrapEntityQueryResult(
      this.#context,
      selected,
      this.#state.plan,
      this.#state.invalid,
      (first) => {
        if (
          (this.#context.input.defaultComparator === undefined || this.#state.explicit) &&
          !this.#state.compared
        )
          return selected
        /**
         * Other reads retain the original pre-projection bounded ordering and this.#state.limit
         * error.
         */
        const prepared = prepareEntityQuery(
          this.#context,
          this.#state.query,
          this.#state.limit,
          this.#state.explicit,
          this.#state.skip,
          this.#state.compared,
          first
        )
        return (
          prepared as unknown as {
            select(...args: readonly unknown[]): IQueryResult<unknown, TContext, true, TMethods>
          }
        ).select(...captured)
      }
    )
  }) as IEntityQueryNarrowed<T, TIndexes, TContext, TMethods>['select']
  /** Delegate explain through the original branch admission and operation ports. */
  readonly explain: IEntityQueryNarrowed<T, TIndexes, TContext, {}>['explain'] = () =>
    prepareEntityQuery(
      this.#context,
      this.#state.query,
      this.#state.limit,
      this.#state.explicit,
      this.#state.skip,
      this.#state.compared
    ).explain()
  /** Delegate delete through the original branch admission and operation ports. */
  readonly delete: IEntityQueryNarrowed<T, TIndexes, TContext, {}>['delete'] = (ctx) =>
    this.#context.input.run(
      () =>
        prepareEntityQuery(
          this.#context,
          this.#state.query,
          this.#state.limit,
          this.#state.explicit,
          this.#state.skip,
          this.#state.compared
        ).delete(ctx),
      this.#state.plan,
      { ...this.#context.selection, onInvalid: this.#state.invalid },
      (count) => count
    )
  /** Delegate update through the original branch admission and operation ports. */
  readonly update: IEntityQueryNarrowed<T, TIndexes, TContext, {}>['update'] = (patch, ctx) =>
    this.#context.input.run(
      () =>
        prepareEntityQuery(
          this.#context,
          this.#state.query,
          this.#state.limit,
          this.#state.explicit,
          this.#state.skip,
          this.#state.compared
        ).update(patch, ctx),
      this.#state.plan,
      { ...this.#context.selection, onInvalid: this.#state.invalid },
      (count) => count
    )
  /** Delegate index through the original branch admission and operation ports. */
  readonly index = (name: string, match?: unknown) => {
    if (!this.#state.sourceOpen) return this.#context.input.invalidState()
    return createEntityQuery(
      this.#context.input,
      { ...this.#context.selection, ...this.#context.input.index(name, match) },
      false
    )
  }
  /** Delegate range through the original branch admission and operation ports. */
  readonly range = (range: IKeyRange) => {
    if (!this.#state.sourceOpen) return this.#context.input.invalidState()
    return createEntityQuery(
      this.#context.input,
      { ...this.#context.selection, range: this.#context.input.range(range) },
      false
    )
  }
  /** Delegate limit through the original branch admission and operation ports. */
  readonly limit: IEntityQueryNarrowed<T, TIndexes, TContext, {}>['limit'] = (count: number) => {
    try {
      this.#state.query.limit(count)
    } catch (cause) {
      return this.#context.input.invalidState(cause)
    }
    return wrapEntityQuery(
      this.#context,
      this.#state.query,
      count,
      this.#state.explicit,
      { ...this.#state.plan, hasLimit: true },
      this.#state.invalid,
      this.#state.skip,
      this.#state.compared
    )
  }
  /** Delegate skip through the original branch admission and operation ports. */
  readonly skip: IEntityQueryNarrowed<T, TIndexes, TContext, {}>['skip'] = (count: number) => {
    try {
      this.#state.query.skip(count)
    } catch (cause) {
      return this.#context.input.invalidState(cause)
    }
    return wrapEntityQuery(
      this.#context,
      this.#state.query,
      this.#state.limit,
      this.#state.explicit,
      this.#state.plan,
      this.#state.invalid,
      count,
      this.#state.compared
    )
  }
  /** Delegate after through the original branch admission and operation ports. */
  readonly after: IEntityQueryNarrowed<T, TIndexes, TContext, {}>['after'] = (
    cursor: Parameters<IRecordQuery<T, TContext, TMethods>['after']>[0]
  ) =>
    wrapEntityQuery(
      this.#context,
      this.#context.input.keyset(() => this.#state.query.after(cursor)),
      this.#state.limit,
      this.#state.explicit,
      this.#state.plan,
      this.#state.invalid,
      this.#state.skip,
      this.#state.compared
    )
  /** Delegate distinct through the original branch admission and operation ports. */
  readonly distinct: IEntityQueryNarrowed<T, TIndexes, TContext, {}>['distinct'] = (
    field: Extract<keyof T, string>
  ) =>
    wrapEntityQuery(
      this.#context,
      this.#state.query.distinct(field),
      this.#state.limit,
      this.#state.explicit,
      this.#state.plan,
      this.#state.invalid,
      this.#state.skip,
      this.#state.compared
    )
  /** Delegate orderBy through the original branch admission and operation ports. */
  readonly orderBy: IEntityQueryNarrowed<T, TIndexes, TContext, {}>['orderBy'] = (
    selector: (value: T) => IStorageKey,
    direction?: 'asc' | 'desc'
  ) => {
    if (this.#state.compared || typeof this.#state.query.orderBy !== 'function')
      return this.#context.input.invalidState()
    let ordered: IRecordQuery<T, TContext, TMethods>
    try {
      ordered = this.#state.query.orderBy(
        typeof selector === 'function' ? this.#context.input.selector(selector) : selector,
        direction
      ) as IRecordQuery<T, TContext, TMethods>
    } catch (cause) {
      return this.#context.input.invalidState(cause)
    }
    return wrapEntityQuery(
      this.#context,
      ordered,
      this.#state.limit,
      true,
      { ...this.#state.plan, hasOrder: true },
      this.#state.invalid,
      this.#state.skip
    )
  }
  /** Delegate orderByComparator through the original branch admission and operation ports. */
  readonly orderByComparator: IEntityQueryNarrowed<T, TIndexes, TContext, {}>['orderByComparator'] =
    (compare: (left: T, right: T) => number): IEntityQueryNeedsLimit<T, TContext, TMethods> => {
      if (this.#state.explicit || typeof this.#state.query.orderByComparator !== 'function')
        return this.#context.input.invalidState()
      /**
       * Retain only this callback declaration; the canonical comparator is added at its terminal
       * bound.
       */
      const captured =
        typeof compare === 'function' ? this.#context.input.comparator(compare) : compare
      try {
        this.#state.query.orderByComparator(captured)
      } catch (cause) {
        return this.#context.input.invalidState(cause)
      }
      return new EntityQueryComparator(this.#context, this.#state, captured).view()
    }
  /** Delegate onInvalid through the original branch admission and operation ports. */
  readonly onInvalid: IEntityQueryNarrowed<T, TIndexes, TContext, {}>['onInvalid'] = (
    action: IInvalidRecordAction | IInvalidRecordHandler<T>
  ) => {
    this.#context.input.invalid(action)
    return wrapEntityQuery(
      this.#context,
      this.#state.query,
      this.#state.limit,
      this.#state.explicit,
      this.#state.plan,
      action,
      this.#state.skip,
      this.#state.compared
    )
  }
  /** Delegate requirePushdown through the original branch admission and operation ports. */
  readonly requirePushdown: IEntityQueryNarrowed<T, TIndexes, TContext, {}>['requirePushdown'] =
    () =>
      wrapEntityQuery(
        this.#context,
        this.#state.query.requirePushdown(),
        this.#state.limit,
        this.#state.explicit,
        this.#state.plan,
        this.#state.invalid,
        this.#state.skip,
        this.#state.compared
      )
  /** Native watch remains absent unless the original canonical query declares it. */
  readonly watch = (ctx?: TContext) => {
    const prepared = prepareEntityQuery(
      this.#context,
      this.#state.query,
      this.#state.limit,
      this.#state.explicit,
      this.#state.skip,
      this.#state.compared
    )
    const native = prepared as unknown as { watch?: (ctx?: TContext) => IStorageIterator<unknown> }
    if (typeof native.watch !== 'function') return this.#context.input.invalidState()
    return native.watch(ctx)
  }
  /** Compose the same public facade without freezing ordinary query records. */
  view(): IEntityQueryNarrowed<T, TIndexes, TContext, TMethods> {
    return {
      ...this.#state.query,
      ...new EntityQueryReads(
        this.#context,
        (first) =>
          prepareEntityQuery(
            this.#context,
            this.#state.query,
            this.#state.limit,
            this.#state.explicit,
            this.#state.skip,
            this.#state.compared,
            first
          ),
        this.#state.plan,
        this.#state.invalid,
        () => pageEntityQuery(this.#state.query, this.#state.limit, this.#state.skip)
      ),
      where: this.where,
      select: this.select,
      ...(typeof (this.#state.query as { watch?: unknown }).watch !== 'function'
        ? {}
        : { watch: this.watch }),
      explain: this.explain,
      delete: this.delete,
      update: this.update,
      index: this.index,
      range: this.range,
      limit: this.limit,
      skip: this.skip,
      after: this.after,
      distinct: this.distinct,
      orderBy: this.orderBy,
      orderByComparator: this.orderByComparator,
      onInvalid: this.onInvalid,
      requirePushdown: this.requirePushdown
    } as IEntityQueryNarrowed<T, TIndexes, TContext, TMethods>
  }
}
/** Construct one persistent branch from explicit entity facts; no factory closure owns state. */
function wrapEntityQuery<
  T,
  TIndexes extends Readonly<Record<string, IStorageKey>>,
  TContext extends IOperationContext | undefined,
  TMethods extends object
>(
  context: IEntityQueryContext<T, TIndexes, TContext, TMethods>,
  query: IRecordQuery<T, TContext, TMethods>,
  limit?: number,
  explicit = false,
  plan: IEntityQueryPlan = {
    hasWhere: false,
    hasOrder: context.input.defaultComparator !== undefined,
    hasLimit: false
  },
  invalid = context.selection.onInvalid,
  skip = 0,
  compared: ((left: T, right: T) => number) | undefined = undefined,
  sourceOpen = false
): IEntityQueryNarrowed<T, TIndexes, TContext, TMethods> {
  return new EntityQueryBranch(context, {
    query,
    limit,
    explicit,
    plan,
    invalid,
    skip,
    compared,
    sourceOpen
  }).view()
}
/** Adapt source selection to the canonical query owner using one explicit declaration context. */
export function createEntityQuery<
  T,
  TIndexes extends Readonly<Record<string, IStorageKey>>,
  TContext extends IOperationContext | undefined,
  TMethods extends object
>(
  input: IEntityQueryInput<T, TIndexes, TContext, TMethods>,
  selection: IEntityQuerySourceSelection<T> = {},
  sourceAllowed = true
): IEntityQuery<T, TIndexes, TContext, TMethods> {
  /** The wrapped default callback identity remains stable across this adapter's keyset signatures. */
  const context: IEntityQueryContext<T, TIndexes, TContext, TMethods> = {
    input,
    selection,
    defaultComparator:
      input.defaultComparator === undefined ? undefined : input.comparator(input.defaultComparator)
  }
  return wrapEntityQuery(
    context,
    input.query<T, TContext, TMethods>(input.source(selection), input.methods),
    undefined,
    false,
    undefined,
    selection.onInvalid,
    0,
    undefined,
    sourceAllowed
  ) as IEntityQuery<T, TIndexes, TContext, TMethods>
}
