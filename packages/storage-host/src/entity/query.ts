import {
  createRecordQuery,
  type IOperationContext,
  type IRecordQuery,
  type IRecordQueryBase,
  type IRecordQueryNeedsLimit,
  type IQueryRead,
  type IQueryStatistics,
  type IQueryResult,
  type IRecordQuerySource,
  type IStorageKey,
  type IStorageIterator,
  type IKeyRange
} from '@migaia/storage-contract'
import type {
  IEntityQuery,
  IEntityQueryNarrowed,
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
export function createEntityQuery<
  T,
  TIndexes extends Readonly<Record<string, IStorageKey>>,
  TContext extends IOperationContext | undefined,
  TMethods extends object
>(
  input: {
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
    readonly predicate: (fn: (value: T) => unknown) => (value: T) => boolean
    readonly mapper: (fn: (value: T) => unknown) => (value: T) => Promise<unknown>
    readonly comparator: (fn: (left: T, right: T) => number) => (left: T, right: T) => number
  },
  selection: IEntityQuerySourceSelection<T> = {}
): IEntityQuery<T, TIndexes, TContext, TMethods> {
  /** Every read delegates to the original terminal inside the existing entity operation owner. */
  const reads = <R>(
    prepare: (first?: true) => IQueryRead<R, TContext> & IQueryStatistics<R, TContext>,
    plan: IEntityQueryPlan,
    invalid: IInvalidRecordAction | IInvalidRecordHandler<T> | undefined,
    countQuery = () => prepare()
  ): Omit<IQueryRead<R, TContext>, 'explain'> & IQueryStatistics<R, TContext> => ({
    all: (ctx) =>
      input.run(
        () => prepare().all(ctx),
        plan,
        { ...selection, onInvalid: invalid },
        (rows) => rows.length
      ),
    first: (ctx) =>
      input.run(
        () => prepare(true).first(ctx),
        { ...plan, hasLimit: true },
        { ...selection, onInvalid: invalid },
        (row) => (row === undefined ? 0 : 1)
      ),
    maybe: (ctx) =>
      input.run(
        () => prepare().maybe(ctx),
        plan,
        { ...selection, onInvalid: invalid },
        (value) => (value.some ? 1 : 0)
      ),
    firstOrThrow: (ctx) =>
      input.run(
        () => prepare().firstOrThrow(ctx),
        plan,
        { ...selection, onInvalid: invalid },
        () => 1
      ),
    pluck: (field, ctx) =>
      input.run(
        () => prepare().pluck(field, ctx),
        plan,
        { ...selection, onInvalid: invalid },
        (values) => values.length
      ),
    exists: (ctx) =>
      input.run(
        () => prepare().exists(ctx),
        plan,
        { ...selection, onInvalid: invalid },
        (value) => (value ? 1 : 0)
      ),
    count: (ctx) =>
      input.run(
        () => countQuery().count(ctx),
        { ...plan, hasOrder: false },
        { ...selection, onInvalid: invalid },
        (count) => count
      ),
    each: (fn, ctx) =>
      input.run(
        () => prepare().each(fn, ctx),
        plan,
        { ...selection, onInvalid: invalid },
        (count) => count
      ),
    chunk: (size, fn, ctx) =>
      input.run(
        () => prepare().chunk(size, fn, ctx),
        plan,
        { ...selection, onInvalid: invalid },
        (count) => count
      ),
    min: (field, ctx) =>
      input.run(
        () => prepare().min(field, ctx),
        plan,
        { ...selection, onInvalid: invalid },
        (value) => (value.some ? 1 : 0)
      ),
    max: (field, ctx) =>
      input.run(
        () => prepare().max(field, ctx),
        plan,
        { ...selection, onInvalid: invalid },
        (value) => (value.some ? 1 : 0)
      ),
    sum: (field, ctx) =>
      input.run(
        () => prepare().sum(field, ctx),
        plan,
        { ...selection, onInvalid: invalid },
        () => 1
      ),
    avg: (field, ctx) =>
      input.run(
        () => prepare().avg(field, ctx),
        plan,
        { ...selection, onInvalid: invalid },
        (value) => (value.some ? 1 : 0)
      ),
    stream: (ctx) =>
      input.stream(() => prepare().stream(ctx), plan, { ...selection, onInvalid: invalid })
  })
  /** Final projections retain original method references and terminal Promise semantics. */
  const result = <R>(
    query: IQueryResult<R, TContext, true, TMethods>,
    plan: IEntityQueryPlan,
    invalid: IInvalidRecordAction | IInvalidRecordHandler<T> | undefined,
    prepareResult: (first?: true) => IQueryResult<R, TContext, true, TMethods> = () => query
  ): IQueryResult<R, TContext, true, TMethods> =>
    Object.freeze({
      ...query,
      ...reads(prepareResult, plan, invalid, () => query),
      explain: () => prepareResult().explain(),
      requirePushdown: (): IQueryResult<R, TContext, true, TMethods> =>
        result(query.requirePushdown(), plan, invalid, (first) =>
          prepareResult(first).requirePushdown()
        )
    }) as IQueryResult<R, TContext, true, TMethods>
  /** A default comparator is an entity option; the original query heap performs its actual work. */
  const prepare = (
    query: IRecordQuery<T, TContext, TMethods>,
    limit: number | undefined,
    explicit: boolean,
    first?: true
  ): IRecordQueryBase<T, TContext, TMethods> => {
    if (explicit || input.defaultComparator === undefined) return query
    if (limit === undefined && first !== true) return input.missingLimit()
    return query.orderByComparator(input.comparator(input.defaultComparator)).limit(limit ?? 1)
  }
  /** Each branch retains the actual immutable core query rather than replaying its configuration. */
  const wrap = (
    query: IRecordQuery<T, TContext, TMethods>,
    limit?: number,
    explicit = false,
    plan: IEntityQueryPlan = {
      hasWhere: false,
      hasOrder: input.defaultComparator !== undefined,
      hasLimit: false
    },
    invalid = selection.onInvalid
  ): IEntityQueryNarrowed<T, TIndexes, TContext, TMethods> => {
    /** Preserve the original overloads and their canonical argument snapshots. */
    const where = ((...args: readonly unknown[]) =>
      wrap(
        Reflect.apply(
          query.where,
          query,
          typeof args[0] === 'function' ? [input.predicate(args[0] as (value: T) => unknown)] : args
        ),
        limit,
        explicit,
        { ...plan, hasWhere: true },
        invalid
      )) as IEntityQueryNarrowed<T, TIndexes, TContext, TMethods>['where']
    const select = ((...args: readonly unknown[]) => {
      /** Public projection arguments are validated now; its wrapped mapper is captured once. */
      const captured =
        typeof args[0] === 'function' ? [input.mapper(args[0] as (value: T) => unknown)] : args
      /** Count keeps the current page without introducing the unused default comparator. */
      const unprepared =
        input.defaultComparator !== undefined && !explicit && limit !== undefined
          ? query.limit(limit)
          : query
      /** This immutable canonical branch retains the validated fields and original augmentation. */
      const selected = Reflect.apply(unprepared.select, unprepared, captured)
      return result(selected, plan, invalid, (first) => {
        if (input.defaultComparator === undefined || explicit) return selected
        /** Other reads retain the original pre-projection bounded ordering and limit error. */
        const prepared = prepare(query, limit, explicit, first)
        return Reflect.apply(prepared.select, prepared, captured)
      })
    }) as IEntityQueryNarrowed<T, TIndexes, TContext, TMethods>['select']
    return Object.freeze({
      ...query,
      ...reads(
        (first) => prepare(query, limit, explicit, first),
        plan,
        invalid,
        () => (limit === undefined ? query : query.limit(limit))
      ),
      where,
      select,
      delete: (ctx) =>
        input.run(
          () => prepare(query, limit, explicit).delete(ctx),
          plan,
          { ...selection, onInvalid: invalid },
          (count) => count
        ),
      update: (patch, ctx) =>
        input.run(
          () => prepare(query, limit, explicit).update(patch, ctx),
          plan,
          { ...selection, onInvalid: invalid },
          (count) => count
        ),
      limit: (count: number) => {
        const bounded = query.limit(count)
        return wrap(
          input.defaultComparator !== undefined && !explicit ? query : bounded,
          count,
          explicit,
          { ...plan, hasLimit: true },
          invalid
        )
      },
      orderByComparator: (
        compare: (left: T, right: T) => number
      ): IRecordQueryNeedsLimit<T, TContext, TMethods> => {
        const pending = query.orderByComparator(
          typeof compare === 'function' ? input.comparator(compare) : compare
        )
        return {
          first: (ctx?: TContext) =>
            input.run(
              () => pending.first(ctx),
              { ...plan, hasOrder: true, hasLimit: true },
              { ...selection, onInvalid: invalid },
              (row) => (row === undefined ? 0 : 1)
            ),
          limit: (count: number) =>
            wrap(
              pending.limit(count) as IRecordQuery<T, TContext, TMethods>,
              count,
              true,
              {
                ...plan,
                hasOrder: true,
                hasLimit: true
              },
              invalid
            )
        }
      },
      onInvalid: (action: IInvalidRecordAction | IInvalidRecordHandler<T>) => {
        input.invalid(action)
        return wrap(query, limit, explicit, plan, action)
      },
      requirePushdown: () => wrap(query.requirePushdown(), limit, explicit, plan, invalid)
    }) as IEntityQueryNarrowed<T, TIndexes, TContext, TMethods>
  }
  /** Source selection precedes conditions; selecting it allocates no native cursor or I/O. */
  const query = wrap(
    createRecordQuery<T, TContext, TMethods>(input.source(selection), input.methods)
  )
  return Object.freeze({
    ...query,
    index: (name: string, match?: unknown) =>
      createEntityQuery(input, { ...selection, ...input.index(name, match) }),
    range: (range: IKeyRange) =>
      createEntityQuery(input, { ...selection, range: input.range(range) }),
    onInvalid: query.onInvalid
  }) as IEntityQuery<T, TIndexes, TContext, TMethods>
}
