import {
  createRecordQuery,
  type IOperationContext,
  type IRecordQuery,
  type IRecordQueryBase,
  type IRecordQueryNeedsLimit,
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
      invoke: () => Promise<R[]>,
      plan: IEntityQueryPlan,
      selection: IEntityQuerySourceSelection<T>
    ) => Promise<R[]>
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
  /** Final projections retain original method references and terminal Promise semantics. */
  const result = <R>(
    query: IQueryResult<R, TContext, true, TMethods>,
    plan: IEntityQueryPlan,
    invalid: IInvalidRecordAction | IInvalidRecordHandler<T> | undefined
  ): IQueryResult<R, TContext, true, TMethods> =>
    Object.freeze({
      ...query,
      all: (ctx?: TContext): Promise<R[]> =>
        input.run(() => query.all(ctx), plan, { ...selection, onInvalid: invalid }),
      stream: (ctx?: TContext): IStorageIterator<R> =>
        input.stream(() => query.stream(ctx), plan, { ...selection, onInvalid: invalid }),
      requirePushdown: () => result(query.requirePushdown(), plan, invalid)
    }) as IQueryResult<R, TContext, true, TMethods>
  /** A default comparator is an entity option; the original query heap performs its actual work. */
  const prepare = (
    query: IRecordQuery<T, TContext, TMethods>,
    limit: number | undefined,
    explicit: boolean
  ): IRecordQueryBase<T, TContext, TMethods> => {
    if (explicit || input.defaultComparator === undefined) return query
    if (limit === undefined) return input.missingLimit()
    return query.orderByComparator(input.comparator(input.defaultComparator)).limit(limit)
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
    const select = ((...args: readonly unknown[]) =>
      (() => {
        const prepared = prepare(query, limit, explicit)
        return result(
          Reflect.apply(
            prepared.select,
            prepared,
            typeof args[0] === 'function' ? [input.mapper(args[0] as (value: T) => unknown)] : args
          ),
          plan,
          invalid
        )
      })()) as IEntityQueryNarrowed<T, TIndexes, TContext, TMethods>['select']
    return Object.freeze({
      ...query,
      where,
      select,
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
      all: (ctx?: TContext): Promise<T[]> =>
        input.run(() => prepare(query, limit, explicit).all(ctx), plan, {
          ...selection,
          onInvalid: invalid
        }),
      stream: (ctx?: TContext): IStorageIterator<T> =>
        input.stream(() => prepare(query, limit, explicit).stream(ctx), plan, {
          ...selection,
          onInvalid: invalid
        }),
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
