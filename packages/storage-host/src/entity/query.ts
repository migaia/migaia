import {
  createRecordQuery,
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
    readonly invalidState: (cause?: unknown) => never
    readonly selector: (fn: (value: T) => IStorageKey) => (value: T) => IStorageKey
    readonly predicate: (fn: (value: T) => unknown) => (value: T) => boolean
    readonly mapper: (fn: (value: T) => unknown) => (value: T) => Promise<unknown>
    readonly comparator: (fn: (left: T, right: T) => number) => (left: T, right: T) => number
  },
  selection: IEntityQuerySourceSelection<T> = {},
  sourceAllowed = true
): IEntityQuery<T, TIndexes, TContext, TMethods> {
  /**
   * One descriptor keeps its wrapped default callback identity across original keyset page
   * signatures.
   */
  const defaultComparator =
    input.defaultComparator === undefined ? undefined : input.comparator(input.defaultComparator)
  /** Every read delegates to the original terminal inside the existing entity operation owner. */
  const reads = <R>(
    prepare: (
      first?: true
    ) => IQueryRead<R, TContext> & IQueryStatistics<R, TContext> & IQueryPages<R, TContext>,
    plan: IEntityQueryPlan,
    invalid: IInvalidRecordAction | IInvalidRecordHandler<T> | undefined,
    countQuery = () => prepare()
  ): Omit<IQueryRead<R, TContext>, 'explain'> &
    IQueryStatistics<R, TContext> &
    IQueryPages<R, TContext> => ({
    page: (size, ctx) =>
      input.run(
        () => prepare().page(size, ctx),
        plan,
        { ...selection, onInvalid: invalid },
        (page) => page.items.length
      ),
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
      // Hidden type-state methods reject dynamic JavaScript use before any source is opened.
      index: () => input.invalidState(),
      range: () => input.invalidState(),
      where: () => input.invalidState(),
      select: () => input.invalidState(),
      distinct: () => input.invalidState(),
      skip: () => input.invalidState(),
      after: () => input.invalidState(),
      limit: () => input.invalidState(),
      orderBy: () => input.invalidState(),
      orderByComparator: () => input.invalidState(),
      onInvalid: () => input.invalidState(),
      explain: () => prepareResult().explain(),
      requirePushdown: (): IQueryResult<R, TContext, true, TMethods> =>
        result(query.requirePushdown(), plan, invalid, (first) =>
          prepareResult(first).requirePushdown()
        )
    }) as IQueryResult<R, TContext, true, TMethods>
  /** Bounds are one finite entity fact; the original query applies them after filtering and order. */
  const page = (
    query: IRecordQuery<T, TContext, TMethods>,
    limit: number | undefined,
    skip: number
  ): IRecordQuery<T, TContext, TMethods> => {
    const offset = skip === 0 ? query : query.skip(skip)
    return limit === undefined ? offset : offset.limit(limit)
  }
  /** The original bounded heap receives the page capacity, including the requested offset. */
  const prepare = (
    query: IRecordQuery<T, TContext, TMethods>,
    limit: number | undefined,
    explicit: boolean,
    skip: number,
    compared: ((left: T, right: T) => number) | undefined,
    first?: true
  ): IRecordQueryBase<T, TContext, TMethods> => {
    const bound = first === true ? Math.min(limit ?? 1, 1) : limit
    if (bound === 0) return query.limit(0)
    if (!compared && (explicit || input.defaultComparator === undefined))
      return page(query, bound, skip)
    if (bound === undefined) return input.missingLimit()
    const capacity = skip + bound
    if (!Number.isSafeInteger(capacity)) return input.invalidState()
    const ordered = query.orderByComparator(compared ?? defaultComparator!).limit(capacity)
    return page(ordered as IRecordQuery<T, TContext, TMethods>, bound, skip)
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
    invalid = selection.onInvalid,
    skip = 0,
    compared: ((left: T, right: T) => number) | undefined = undefined,
    sourceOpen = false
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
        invalid,
        skip,
        compared
      )) as IEntityQueryNarrowed<T, TIndexes, TContext, TMethods>['where']
    const select = ((...args: readonly unknown[]) => {
      /** Public projection arguments are validated now; its wrapped mapper is captured once. */
      const captured =
        typeof args[0] === 'function' ? [input.mapper(args[0] as (value: T) => unknown)] : args
      /** Count keeps the current page without introducing the unused default comparator. */
      const unprepared = page(query, limit, skip)
      /** This immutable canonical branch retains the validated fields and original augmentation. */
      const selected = Reflect.apply(unprepared.select, unprepared, captured)
      return result(selected, plan, invalid, (first) => {
        if ((input.defaultComparator === undefined || explicit) && !compared) return selected
        /** Other reads retain the original pre-projection bounded ordering and limit error. */
        const prepared = prepare(query, limit, explicit, skip, compared, first)
        return Reflect.apply(prepared.select, prepared, captured)
      })
    }) as IEntityQueryNarrowed<T, TIndexes, TContext, TMethods>['select']
    return Object.freeze({
      ...query,
      ...reads(
        (first) => prepare(query, limit, explicit, skip, compared, first),
        plan,
        invalid,
        () => page(query, limit, skip)
      ),
      where,
      select,
      ...(typeof Reflect.get(query, 'watch') !== 'function'
        ? {}
        : {
            watch: (ctx?: TContext) => {
              const prepared = prepare(query, limit, explicit, skip, compared)
              const watch = Reflect.get(prepared, 'watch')
              if (typeof watch !== 'function') return input.invalidState()
              return Reflect.apply(watch, prepared, [ctx])
            }
          }),
      explain: () => prepare(query, limit, explicit, skip, compared).explain(),
      delete: (ctx) =>
        input.run(
          () => prepare(query, limit, explicit, skip, compared).delete(ctx),
          plan,
          { ...selection, onInvalid: invalid },
          (count) => count
        ),
      update: (patch, ctx) =>
        input.run(
          () => prepare(query, limit, explicit, skip, compared).update(patch, ctx),
          plan,
          { ...selection, onInvalid: invalid },
          (count) => count
        ),
      /** Source controls remain guarded at runtime even when JavaScript bypasses the type state. */
      index: (name: string, match?: unknown) => {
        if (!sourceOpen) return input.invalidState()
        return createEntityQuery(input, { ...selection, ...input.index(name, match) }, false)
      },
      range: (range: IKeyRange) => {
        if (!sourceOpen) return input.invalidState()
        return createEntityQuery(input, { ...selection, range: input.range(range) }, false)
      },
      limit: (count: number) => {
        try {
          query.limit(count)
        } catch (cause) {
          return input.invalidState(cause)
        }
        return wrap(query, count, explicit, { ...plan, hasLimit: true }, invalid, skip, compared)
      },
      skip: (count: number) => {
        try {
          query.skip(count)
        } catch (cause) {
          return input.invalidState(cause)
        }
        return wrap(query, limit, explicit, plan, invalid, count, compared)
      },
      after: (cursor: Parameters<typeof query.after>[0]) =>
        wrap(query.after(cursor), limit, explicit, plan, invalid, skip, compared),
      distinct: (field: Extract<keyof T, string>) =>
        wrap(query.distinct(field), limit, explicit, plan, invalid, skip, compared),
      orderBy: (selector: (value: T) => IStorageKey, direction?: 'asc' | 'desc') => {
        if (compared || typeof query.orderBy !== 'function') return input.invalidState()
        let ordered: IRecordQuery<T, TContext, TMethods>
        try {
          ordered = query.orderBy(
            typeof selector === 'function' ? input.selector(selector) : selector,
            direction
          ) as IRecordQuery<T, TContext, TMethods>
        } catch (cause) {
          return input.invalidState(cause)
        }
        return wrap(ordered, limit, true, { ...plan, hasOrder: true }, invalid, skip)
      },
      orderByComparator: (
        compare: (left: T, right: T) => number
      ): IEntityQueryNeedsLimit<T, TContext, TMethods> => {
        if (explicit || typeof query.orderByComparator !== 'function') return input.invalidState()
        /**
         * Retain only this callback declaration; the canonical comparator is added at its terminal
         * bound.
         */
        const captured = typeof compare === 'function' ? input.comparator(compare) : compare
        try {
          query.orderByComparator(captured)
        } catch (cause) {
          return input.invalidState(cause)
        }
        return Object.freeze({
          ...input.methods,
          first: (ctx?: TContext) =>
            input.run(
              () => prepare(query, limit, true, skip, captured, true).first(ctx),
              { ...plan, hasOrder: true, hasLimit: true },
              { ...selection, onInvalid: invalid },
              (row) => (row === undefined ? 0 : 1)
            ),
          limit: (count: number) => {
            try {
              query.limit(count)
            } catch (cause) {
              return input.invalidState(cause)
            }
            return wrap(
              query,
              count,
              true,
              { ...plan, hasOrder: true, hasLimit: true },
              invalid,
              skip,
              captured
            )
          }
        })
      },
      onInvalid: (action: IInvalidRecordAction | IInvalidRecordHandler<T>) => {
        input.invalid(action)
        return wrap(query, limit, explicit, plan, action, skip, compared)
      },
      requirePushdown: () =>
        wrap(query.requirePushdown(), limit, explicit, plan, invalid, skip, compared)
    }) as IEntityQueryNarrowed<T, TIndexes, TContext, TMethods>
  }
  /** The root alone can select a source; every later immutable adapter retains its guarded state. */
  return wrap(
    createRecordQuery<T, TContext, TMethods>(input.source(selection), input.methods),
    undefined,
    false,
    undefined,
    selection.onInvalid,
    0,
    undefined,
    sourceAllowed
  ) as IEntityQuery<T, TIndexes, TContext, TMethods>
}
