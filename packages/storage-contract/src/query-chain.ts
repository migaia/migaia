import { type ICodecValue } from '@migaia/serialize/codec'
import { type IMaybe } from '@migaia/utils'
import { type INativeAbortSignal } from '@migaia/utils/promise'
import { type IObjectPath, type IObjectPathValue } from '@migaia/utils/object-path'
import { type IOperationContext, type IStorageKey } from './context.ts'
import { type IStorageChange } from './change-feed.ts'
import { type IStorageIterator } from './resource.ts'
import { type IConcurrencyPolicy, type IWriteConcurrencyOptions } from './concurrency.ts'
import { type IQuad, type IRdfNamedNode } from './capabilities/rdf.ts'

/** Declarative field operators are shared by condition admission, native plans and client execution. */
export const QueryOperator = Object.freeze({
  eq: 'eq',
  ne: 'ne',
  in: 'in',
  exists: 'exists',
  gt: 'gt',
  gte: 'gte',
  lt: 'lt',
  lte: 'lte',
  between: 'between',
  startsWith: 'startsWith',
  contains: 'contains',
  has: 'has'
} as const)

/** Names and values intentionally share one operator namespace. */
export type QueryOperator = keyof typeof QueryOperator

/** Operator types follow the actual field domain rather than widening every operand to unknown. */
export type IFieldOps<V> = {
  readonly eq?: V
  readonly ne?: V
  readonly in?: readonly V[]
  readonly exists?: boolean
} & ([NonNullable<V>] extends [number | bigint | Date | string]
  ? {
      readonly gt?: V
      readonly gte?: V
      readonly lt?: V
      readonly lte?: V
      readonly between?: readonly [V, V]
    }
  : {}) &
  ([NonNullable<V>] extends [string]
    ? { readonly startsWith?: string; readonly contains?: string }
    : {}) &
  ([NonNullable<V>] extends [readonly (infer E)[]] ? { readonly has?: E } : {})

/** Arrays and Dates are operands, while ordinary records may express nested field conditions. */
type INestedWhere<V> =
  NonNullable<V> extends readonly unknown[] | Date
    ? never
    : NonNullable<V> extends object
      ? IWhere<NonNullable<V>>
      : never

/** A declarative condition contains typed fields plus recursive boolean composition. */
export type IWhere<T> = {
  readonly [K in keyof T]?: T[K] | IFieldOps<T[K]> | INestedWhere<T[K]>
} & {
  readonly and?: readonly IWhere<T>[]
  readonly or?: readonly IWhere<T>[]
  readonly not?: IWhere<T>
}

/** Exact condition operands extend the portable codec carrier only for declared field comparisons. */
export type IQueryOperandValue = ICodecValue | undefined | bigint | Date | object

/**
 * The sole backend-neutral condition tree; operand lists include declared Date/bigint/undefined
 * fields.
 */
export type IQueryCondition =
  | {
      readonly kind: 'field'
      readonly path: readonly string[]
      readonly operator: QueryOperator
      readonly value: IQueryOperandValue | readonly IQueryOperandValue[]
    }
  | { readonly kind: 'and' | 'or'; readonly conditions: readonly IQueryCondition[] }
  | { readonly kind: 'not'; readonly condition: IQueryCondition }

/** Operation names are the shared planner vocabulary; each backend declares its actual subset. */
export const QueryOperation = Object.freeze({
  where: 'where',
  predicate: 'predicate',
  select: 'select',
  mapper: 'mapper',
  order: 'order',
  comparator: 'comparator',
  skip: 'skip',
  after: 'after',
  limit: 'limit',
  distinct: 'distinct',
  count: 'count',
  exists: 'exists',
  aggregate: 'aggregate',
  topK: 'topK',
  minScore: 'minScore',
  follow: 'follow',
  inverse: 'inverse',
  groupBy: 'groupBy',
  rerank: 'rerank'
} as const)

/** Operation values and names intentionally share one planner namespace. */
export type QueryOperation = keyof typeof QueryOperation

/** One immutable plan step describes native execution or an explicit client reason. */
export type IQueryPlanStep = {
  readonly operation: QueryOperation
  readonly reason?: string
  readonly index?: string
}

/** An explain result describes the complete prefix decision without opening a source. */
export type IQueryPlan = {
  readonly pushed: readonly IQueryPlanStep[]
  readonly client: readonly IQueryPlanStep[]
  readonly fullScan: boolean
  readonly source: string
  readonly index?: string
  /** Pure source-choice rule and rejected alternatives contain no selection authority. */
  readonly sourceReason?: string
  readonly sourceCandidates?: readonly { readonly index: string; readonly reason: string }[]
}

/** Backend authors declare native support once; they do not provide another fluent executor. */
export type IQueryPushdown = {
  readonly operators: readonly QueryOperator[]
  readonly operations: readonly QueryOperation[]
  readonly source: string
  readonly index?: string
  /** Optional exact native-domain check after the original operator and identity rules. */
  readonly canPushCondition?: (condition: IQueryCondition) => boolean
}

/** Operand types follow the selected path and operator without widening the public input. */
type IQueryOperand<V, O> = O extends 'eq' | 'ne'
  ? V
  : O extends 'in'
    ? readonly V[]
    : O extends 'exists'
      ? boolean
      : O extends 'between'
        ? readonly [V, V]
        : O extends 'has'
          ? NonNullable<V> extends readonly (infer E)[]
            ? E
            : never
          : O extends 'startsWith' | 'contains'
            ? string
            : V

/** Entity/source adapters keep an exact fluent state while reusing the original condition domains. */
export type IQueryConditions<T, TSelf> = {
  where(condition: IWhere<T>): TSelf
  where<P extends IObjectPath<T>, O extends keyof IFieldOps<IObjectPathValue<T, P>>>(
    path: P,
    operator: O,
    value: IQueryOperand<IObjectPathValue<T, P>, NoInfer<O>>
  ): TSelf
  where(predicate: (row: T) => boolean): TSelf
}

/** Implemented read terminals share the same source and client executor. */
export type IQueryRead<R, TContext extends IOperationContext | undefined = IOperationContext> = {
  all(ctx?: TContext): Promise<R[]>
  first(ctx?: TContext): Promise<R | undefined>
  maybe(ctx?: TContext): Promise<IMaybe<R>>
  firstOrThrow(ctx?: TContext): Promise<R>
  pluck<K extends Extract<keyof R, string>>(field: K, ctx?: TContext): Promise<R[K][]>
  exists(ctx?: TContext): Promise<boolean>
  count(ctx?: TContext): Promise<number>
  each(fn: (row: R, index: number) => void | PromiseLike<void>, ctx?: TContext): Promise<number>
  chunk(
    size: number,
    fn: (rows: readonly R[]) => void | PromiseLike<void>,
    ctx?: TContext
  ): Promise<number>
  stream(ctx?: TContext): IStorageIterator<R>
  explain(): IQueryPlan
}

/** Transaction queries borrow original write intent and accept no per-call operation context. */
export type IQueryWriteContext<TContext> = TContext extends undefined
  ? undefined
  : IOperationContext & IWriteConcurrencyOptions

/** Optional numeric fields remain valid selectors; absence contributes no aggregate sample. */
export type INumericKeys<R> = Extract<
  { [K in keyof R]-?: [NonNullable<R[K]>] extends [number] ? K : never }[keyof R],
  string
>

/** Numeric aggregates retain constant state over the original query reader rather than rows. */
export type IQueryStatistics<R, TContext extends IOperationContext | undefined> = {
  min<K extends INumericKeys<R>>(field: K, ctx?: TContext): Promise<IMaybe<NonNullable<R[K]>>>
  max<K extends INumericKeys<R>>(field: K, ctx?: TContext): Promise<IMaybe<NonNullable<R[K]>>>
  sum<K extends INumericKeys<R>>(field: K, ctx?: TContext): Promise<number>
  avg<K extends INumericKeys<R>>(field: K, ctx?: TContext): Promise<IMaybe<number>>
}

/** Type-only cursor brand; runtime authenticity belongs to the host cursor owner. */
declare const queryCursorBrand: unique symbol

/** A cursor is produced only by page; its private ordering facts cannot be mutated by page items. */
export type IQueryCursor = { readonly [queryCursorBrand]: true }

/** A page owns only its actual items and an optional next keyset anchor. */
export type IQueryPages<R, TContext extends IOperationContext | undefined> = {
  page(size: number, ctx?: TContext): Promise<{ readonly items: R[]; readonly next?: IQueryCursor }>
}

/** A minimal structural terminal shape preserves complete result types in generic consumers. */
export type IQueryShape<TValue = unknown> = { all(ctx?: never): Promise<TValue> }

/** Extracts the complete all result without erasing its row or augmentation inference. */
export type IQueryResultOf<TQuery extends IQueryShape> =
  TQuery extends IQueryShape<infer TValue> ? TValue : never

/** Only a complete query shape can request its original native change-feed iterator. */
export type IQueryWatch<TContext extends IOperationContext | undefined = IOperationContext> = {
  watch<TQuery extends IQueryShape>(this: TQuery, ctx?: TContext): IStorageIterator<IStorageChange>
}

/** A selected result cannot select again or apply conditions to an already projected shape. */
export type IQueryResult<
  R,
  TContext extends IOperationContext | undefined = IOperationContext,
  TStatistics extends boolean = true,
  TAugmentMethods extends object = Record<never, never>
> = IQueryRead<R, TContext> &
  TAugmentMethods & {
    requirePushdown(): IQueryResult<R, TContext, TStatistics, TAugmentMethods>
  } & (TStatistics extends true
    ? IQueryStatistics<R, TContext> & IQueryPages<R, TContext>
    : Record<never, never>)

/** Interface semantics retain the real record or Feature extension after a common condition step. */
export interface IQueryChain<
  T,
  TContext extends IOperationContext | undefined = IOperationContext,
  TWhere = T,
  TStatistics extends boolean = true,
  TAugmentMethods extends object = Record<never, never>
> extends IQueryRead<T, TContext> {
  where(condition: IWhere<TWhere>): this
  where<P extends IObjectPath<TWhere>, O extends keyof IFieldOps<IObjectPathValue<TWhere, P>>>(
    path: P,
    operator: O,
    value: IQueryOperand<IObjectPathValue<TWhere, P>, NoInfer<O>>
  ): this
  where(predicate: (row: TWhere) => boolean): this
  select<const K extends Extract<keyof T, string>>(
    ...fields: readonly [K, ...K[]]
  ): IQueryResult<Pick<T, K>, TContext, TStatistics, TAugmentMethods>
  select<N>(mapper: (row: T) => N): IQueryResult<Awaited<N>, TContext, TStatistics, TAugmentMethods>
  distinct<K extends Extract<keyof T, string>>(field: K): this
  requirePushdown(): this
}

/** Interface semantics preserve the current record state and Feature methods after limit. */
export interface IRecordQueryBaseCore<
  T,
  TContext extends IOperationContext | undefined = IOperationContext,
  TAugmentMethods extends object = Record<never, never>
>
  extends
    IQueryChain<T, TContext, T, true, TAugmentMethods>,
    IQueryStatistics<T, TContext>,
    IQueryPages<T, TContext> {
  limit(count: number): this
  skip(count: number): this
  after(cursor: IQueryCursor): this
  delete(ctx?: IQueryWriteContext<TContext>): Promise<number>
  update(patch: Partial<T>, ctx?: IQueryWriteContext<TContext>): Promise<number>
}

/** The comparator transition requires an explicit finite limit before any read terminal exists. */
export interface IRecordQueryCore<
  T,
  TContext extends IOperationContext | undefined = IOperationContext,
  TAugmentMethods extends object = Record<never, never>
> extends IRecordQueryBaseCore<T, TContext, TAugmentMethods> {
  orderBy(
    selector: (row: T) => IStorageKey,
    direction?: 'asc' | 'desc'
  ): IRecordOrderedQuery<T, TContext, TAugmentMethods>
  orderByComparator(
    compare: (left: T, right: T) => number
  ): IRecordQueryNeedsLimit<T, TContext, TAugmentMethods>
}

/** Comparator queries expose only the bound declaration until their retained heap size is known. */
export type IRecordQueryNeedsLimit<
  T,
  TContext extends IOperationContext | undefined,
  TAugmentMethods extends object = Record<never, never>
> = {
  limit(count: number): IRecordQueryBase<T, TContext, TAugmentMethods>
  first(ctx?: TContext): Promise<T | undefined>
}

/** A bounded comparator cannot introduce another ordering mode. */
export type IRecordQueryBase<
  T,
  TContext extends IOperationContext | undefined = IOperationContext,
  TAugmentMethods extends object = Record<never, never>
> = IRecordQueryBaseCore<T, TContext, TAugmentMethods> & TAugmentMethods

/** The original record query includes only implemented ordering and read controls. */
export type IRecordQuery<
  T,
  TContext extends IOperationContext | undefined = IOperationContext,
  TAugmentMethods extends object = Record<never, never>
> = IRecordQueryCore<T, TContext, TAugmentMethods> & TAugmentMethods

/** Selector refinements stay in the canonical key domain and cannot switch to opaque comparison. */
export interface IRecordOrderedQueryCore<
  T,
  TContext extends IOperationContext | undefined = IOperationContext,
  TAugmentMethods extends object = Record<never, never>
> extends IRecordQueryBaseCore<T, TContext, TAugmentMethods> {
  orderBy(selector: (row: T) => IStorageKey, direction?: 'asc' | 'desc'): this
}

/** Feature methods remain available on every selector-ordered record branch. */
export type IRecordOrderedQuery<
  T,
  TContext extends IOperationContext | undefined = IOperationContext,
  TAugmentMethods extends object = Record<never, never>
> = IRecordOrderedQueryCore<T, TContext, TAugmentMethods> & TAugmentMethods

/** Ranked hits omit their potentially large vector until the chain explicitly requests it. */
export type IVectorHit<TPayload, TWithVector extends boolean = false> = {
  readonly id: string
  readonly score: number
  readonly payload?: TPayload
} & (TWithVector extends true ? { readonly vector: readonly number[] } : Record<never, never>)

/** Origins describe the original user request, independently of backend sample resolution. */
export const VectorQueryOriginKind = Object.freeze({
  near: 'near',
  similarTo: 'similarTo',
  recommend: 'recommend'
} as const)

/** Canonical origin names share the same runtime/type namespace. */
export type VectorQueryOriginKind = keyof typeof VectorQueryOriginKind

/** Backend authors supply the already captured request without exposing a store or client. */
export type IVectorQueryOrigin =
  | { readonly kind: typeof VectorQueryOriginKind.near; readonly vector: readonly number[] }
  | { readonly kind: typeof VectorQueryOriginKind.similarTo; readonly id: string }
  | {
      readonly kind: typeof VectorQueryOriginKind.recommend
      readonly positive: readonly string[]
      readonly negative: readonly string[]
    }

/** Only explicit withVector state grants vector access to a scorer. */
export type IVectorRerankInput<TPayload, TWithVector extends boolean> = {
  readonly origin: IVectorQueryOrigin
  readonly hits: readonly IVectorHit<TPayload, TWithVector>[]
}

/** The scorer borrows the original caller signal; it owns no independent operation budget. */
export type IVectorRerankContext = { readonly signal: INativeAbortSignal }

/** Exactly one score corresponds to each hit in its original engine order. */
export type IVectorReranker<TPayload, TWithVector extends boolean> = (
  input: IVectorRerankInput<TPayload, TWithVector>,
  ctx: IVectorRerankContext
) => readonly number[] | Promise<readonly number[]>

/** The original query remains the only owner of result truncation. */
export type IVectorRerankOptions = { readonly topN?: number }

/** Engine relevance remains intact alongside the independent client reranking score. */
export type IVectorRerankedHit<TPayload, TWithVector extends boolean = false> = IVectorHit<
  TPayload,
  TWithVector
> & { readonly rerankScore: number }

/** Read-only stages do not regain write, subscription or strict-native methods via augmentation. */
type IVectorReadonlyMethods<TMethods> = Omit<TMethods, 'delete' | 'watch' | 'requirePushdown'>

/** Projection after a read-only vector stage retains only the original read terminals. */
type IVectorReadonlyResult<R, TMethods> = IQueryRead<R> & IVectorReadonlyMethods<TMethods>

/** Only sources that declare grouping grant a group terminal on the retained hit set. */
type IVectorReadonlyGroups<
  TPayload,
  THit,
  TGroupable extends boolean,
  TMethods
> = TGroupable extends true
  ? {
      groupBy<K extends Extract<keyof TPayload, string>>(
        field: K,
        options: { readonly perGroup: number }
      ): IVectorReadonlyResult<
        { readonly group: TPayload[K]; readonly hits: readonly THit[] },
        TMethods
      >
    }
  : Record<never, never>

/** Reranking is a final read-only ordering; optional grouping observes only its topN. */
export type IVectorRerankedQuery<
  TPayload,
  TGroupable extends boolean = false,
  TWithVector extends boolean = false,
  TMethods extends object = Record<never, never>
> = IVectorReadonlyResult<IVectorRerankedHit<TPayload, TWithVector>, TMethods> &
  IVectorReadonlyGroups<
    TPayload,
    IVectorRerankedHit<TPayload, TWithVector>,
    TGroupable,
    TMethods
  > & {
    select<const K extends Extract<keyof IVectorRerankedHit<TPayload, TWithVector>, string>>(
      ...fields: readonly [K, ...K[]]
    ): IVectorReadonlyResult<Pick<IVectorRerankedHit<TPayload, TWithVector>, K>, TMethods>
    select<N>(
      mapper: (hit: IVectorRerankedHit<TPayload, TWithVector>) => N
    ): IVectorReadonlyResult<Awaited<N>, TMethods>
  }

/** Native Features capture their own validated opaque request, never a client or source handle. */
export type IVectorQueryRefinement = { readonly native: unknown; readonly topN: number }

/** A source-ranked native Feature result remains eligible for one portable reranking stage. */
export type IVectorNativeQuery<
  TPayload,
  TGroupable extends boolean = false,
  TWithVector extends boolean = false,
  TMethods extends object = Record<never, never>
> = IVectorReadonlyResult<IVectorHit<TPayload, TWithVector>, TMethods> &
  IVectorReadonlyGroups<TPayload, IVectorHit<TPayload, TWithVector>, TGroupable, TMethods> & {
    withVector(): IVectorNativeQuery<TPayload, TGroupable, true, TMethods>
    rerank(
      scorer: IVectorReranker<TPayload, TWithVector>,
      options?: IVectorRerankOptions
    ): IVectorRerankedQuery<TPayload, TGroupable, TWithVector, TMethods>
    select<const K extends Extract<keyof IVectorHit<TPayload, TWithVector>, string>>(
      ...fields: readonly [K, ...K[]]
    ): IVectorReadonlyResult<Pick<IVectorHit<TPayload, TWithVector>, K>, TMethods>
    select<N>(
      mapper: (hit: IVectorHit<TPayload, TWithVector>) => N
    ): IVectorReadonlyResult<Awaited<N>, TMethods>
  }

/** Vector builders expose no read terminal until a finite topK has been declared. */
export interface IVectorQueryBuilderCore<
  TPayload,
  TGroupable extends boolean = false,
  TWithVector extends boolean = false,
  TAugmentMethods extends object = Record<never, never>
> {
  where(condition: IWhere<TPayload>): this
  where<P extends IObjectPath<TPayload>, O extends keyof IFieldOps<IObjectPathValue<TPayload, P>>>(
    path: P,
    operator: O,
    value: IQueryOperand<IObjectPathValue<TPayload, P>, NoInfer<O>>
  ): this
  where(predicate: (payload: TPayload) => boolean): this
  minScore(score: number): this
  withVector(): IVectorQueryBuilder<TPayload, TGroupable, true, TAugmentMethods>
  requirePushdown(): this
  topK(count: number): IVectorQuery<TPayload, TGroupable, TWithVector, TAugmentMethods>
}

/** A bounded vector query retains score ordering and deliberately has no record statistics. */
export interface IVectorQueryBase<
  TPayload,
  TGroupable extends boolean,
  TWithVector extends boolean,
  TAugmentMethods extends object = Record<never, never>
> extends IQueryChain<
  IVectorHit<TPayload, TWithVector>,
  IOperationContext,
  TPayload,
  false,
  TAugmentMethods
> {
  topK(count: number): this
  minScore(score: number): this
  withVector(): IVectorQuery<TPayload, TGroupable, true, TAugmentMethods>
  rerank(
    scorer: IVectorReranker<TPayload, TWithVector>,
    options?: IVectorRerankOptions
  ): IVectorRerankedQuery<TPayload, TGroupable, TWithVector, TAugmentMethods>
  delete(ctx?: IOperationContext & IWriteConcurrencyOptions): Promise<number>
}

/** Backend augmentation remains available during the pre-topK type state. */
export type IVectorQueryBuilder<
  TPayload,
  TGroupable extends boolean = false,
  TWithVector extends boolean = false,
  TAugmentMethods extends object = Record<never, never>
> = IVectorQueryBuilderCore<TPayload, TGroupable, TWithVector, TAugmentMethods> & TAugmentMethods

/** Grouping is available only when the source explicitly declares the standard grouping contract. */
export type IVectorQuery<
  TPayload,
  TGroupable extends boolean = false,
  TWithVector extends boolean = false,
  TAugmentMethods extends object = Record<never, never>
> = IVectorQueryBase<TPayload, TGroupable, TWithVector, TAugmentMethods> &
  TAugmentMethods &
  (TGroupable extends true
    ? {
        groupBy<K extends Extract<keyof TPayload, string>>(
          field: K,
          options: { readonly perGroup: number }
        ): IQueryResult<
          {
            readonly group: TPayload[K]
            readonly hits: readonly IVectorHit<TPayload, TWithVector>[]
          },
          IOperationContext,
          false,
          TAugmentMethods
        >
      }
    : Record<never, never>)

/** Ground RDF traversals keep quad bindings and reuse the ordinary projection/read terminals. */
export interface IRdfQueryCore<
  TContext extends IOperationContext | undefined = IOperationContext,
  TAugmentMethods extends object = Record<never, never>
>
  extends
    IQueryChain<IQuad, TContext, IQuad, true, TAugmentMethods>,
    IQueryStatistics<IQuad, TContext>,
    IQueryPages<IQuad, TContext> {
  limit(count: number): this
  skip(count: number): this
  after(cursor: IQueryCursor): this
  orderBy(selector: (quad: IQuad) => IStorageKey, direction?: 'asc' | 'desc'): this
  follow(predicate: IRdfNamedNode, target?: IRdfNamedNode): this
  inverse(predicate: IRdfNamedNode): this
  delete(ctx?: IQueryWriteContext<TContext>): Promise<number>
  replace(oldQuad: IQuad, newQuad: IQuad, ctx?: IQueryWriteContext<TContext>): Promise<number>
}

/** RDF Feature extensions preserve their original function identity across every branch. */
export type IRdfQuery<
  TContext extends IOperationContext | undefined = IOperationContext,
  TAugmentMethods extends object = Record<never, never>
> = IRdfQueryCore<TContext, TAugmentMethods> & TAugmentMethods

/** Implemented record methods are reserved by the original owner before Feature admission. */
export const RecordQueryMethod = Object.freeze({
  where: 'where',
  select: 'select',
  all: 'all',
  first: 'first',
  maybe: 'maybe',
  firstOrThrow: 'firstOrThrow',
  pluck: 'pluck',
  exists: 'exists',
  count: 'count',
  each: 'each',
  chunk: 'chunk',
  min: 'min',
  max: 'max',
  sum: 'sum',
  avg: 'avg',
  explain: 'explain',
  requirePushdown: 'requirePushdown',
  stream: 'stream',
  limit: 'limit',
  orderByComparator: 'orderByComparator',
  orderBy: 'orderBy',
  distinct: 'distinct',
  skip: 'skip',
  after: 'after',
  page: 'page',
  delete: 'delete',
  update: 'update',
  watch: 'watch'
} as const)

/** Vector Feature admission reserves the same shared terminals plus its family refinements. */
export const VectorQueryMethod = Object.freeze({
  ...RecordQueryMethod,
  topK: 'topK',
  minScore: 'minScore',
  withVector: 'withVector',
  rerank: 'rerank',
  groupBy: 'groupBy'
} as const)

/** RDF Feature admission reserves traversal methods before returning any native source. */
export const RdfQueryMethod = Object.freeze({
  ...RecordQueryMethod,
  follow: 'follow',
  inverse: 'inverse',
  replace: 'replace'
} as const)

/** Native execution consumes only the shared AST and optional top-level projection from its plan. */
export type IRecordQuerySource = {
  readonly pushdown: IQueryPushdown
  /**
   * Receives only the leading canonical where prefix; no callback, ordering or page barrier is
   * crossed.
   */
  readonly plan?: (conditions: readonly IQueryCondition[]) => IRecordQuerySourcePlan | undefined
  /** The original source resource key is borrowed from its host without creating a fallback. */
  readonly asyncDisposeKey?: typeof Symbol.asyncDispose
  /** Optional source-key tail order; parts marks an author container of independently valid keys. */
  readonly tieBreakByKey?: Readonly<{ direction: 'next' | 'prev'; parts?: true }>
  /** Explicit opt-in retains legacy execute argument shapes until the native source accepts steps. */
  readonly nativeSteps?: true
  /** Optional stable identity for the same backend collection, organization and physical index. */
  readonly cursorSource?: object
  /** A real native scalar cursor uses the original resource lifetime and declared terminal support. */
  readonly reduce?: IQueryReducer<IRecordQueryInput>
  /** The original write pipeline/transaction provides a scoped source and accepts actual rows. */
  readonly mutate?: IQueryMutator<IRecordQueryInput, unknown, IRecordQueryMutation>
  readonly watch?: IQueryWatcher<IRecordQueryInput>
  readonly execute: (input: IRecordQueryInput) => IStorageIterator<readonly [IStorageKey, unknown]>
}

/** One pure source choice augments this execution plan without creating another query runner. */
export type IRecordQuerySourcePlan = {
  readonly pushdown: IQueryPushdown
  /** A native index fallback may conservatively report scanning; false cannot invent evidence. */
  readonly fullScan?: true
  /** Immutable author-owned facts travel only back to that author's native callbacks. */
  readonly selection?: unknown
  readonly sourceReason?: string
  readonly sourceCandidates?: readonly { readonly index: string; readonly reason: string }[]
}

/** The existing record execute shape is also used verbatim by its native reduction port. */
export type IRecordQueryInput = {
  /** Present only when the pure source plan supplies an immutable native selection fact. */
  readonly selection?: unknown
  readonly conditions: readonly IQueryCondition[]
  readonly fields: readonly string[] | undefined
  readonly ctx: IOperationContext | undefined
  readonly steps?: readonly IQueryNativeStep[]
}

/** Common deletion request; concurrency remains with the original backend operation owner. */
export type IQueryDelete = {
  readonly operation: 'delete'
  readonly ctx: IOperationContext | undefined
  readonly concurrency?: IConcurrencyPolicy
}

/** Records keep one detached patch for the actual selected records, never projected output rows. */
export type IRecordQueryMutation =
  | IQueryDelete
  | {
      readonly operation: 'update'
      readonly patch: Readonly<Partial<Record<string, unknown>>>
      readonly ctx: IOperationContext | undefined
      readonly concurrency?: IConcurrencyPolicy
    }

/** Ground replacement applies only when the original query actually selects oldQuad. */
export type IRdfQueryMutation =
  | IQueryDelete
  | {
      readonly operation: 'replace'
      readonly oldQuad: IQuad
      readonly newQuad: IQuad
      readonly ctx: IOperationContext | undefined
      readonly concurrency?: IConcurrencyPolicy
    }

/** A mutation borrows only the native transaction's existing reader and draft write callback. */
export type IQueryMutationPort<TInput, TValue> = {
  readonly execute: (input: TInput) => IStorageIterator<readonly [IStorageKey, unknown]>
  readonly accept: (key: IStorageKey, value: TValue) => boolean | PromiseLike<boolean>
}

/** Root owners settle only after actual commit; transaction owners return accepted draft counts. */
export type IQueryMutator<
  TInput,
  TValue,
  TMutation extends IQueryDelete | IRecordQueryMutation | IRdfQueryMutation
> = (
  request: TMutation,
  run: (port: IQueryMutationPort<TInput, TValue>) => Promise<number>
) => Promise<number>

/** Native subscriptions retain their original iterator and complete lifetime without a new queue. */
export type IQueryWatcher<TInput> = (input: TInput) => IStorageIterator<IStorageChange>

/** Native scalar requests contain no JavaScript callbacks or secondary execution state. */
export type IQueryReduction =
  | { readonly operation: typeof QueryOperation.count }
  | { readonly operation: typeof QueryOperation.exists }
  | {
      readonly operation: typeof QueryOperation.aggregate
      readonly aggregate:
        | typeof RecordQueryMethod.min
        | typeof RecordQueryMethod.max
        | typeof RecordQueryMethod.sum
        | typeof RecordQueryMethod.avg
      readonly field: string
    }

/** Each native reduction returns exactly one scalar row in its original backend cursor. */
export type IQueryReductionResult = number | boolean | IMaybe<number>

/** A finite optional author callback retains the family's precise original query input. */
export type IQueryReducer<TInput> = (
  input: TInput & { readonly reduction: IQueryReduction }
) => IStorageIterator<readonly [IStorageKey, IQueryReductionResult]>

/** Serializable safe native steps never contain or attempt to translate JavaScript functions. */
export type IQueryNativeStep =
  | { readonly operation: typeof QueryOperation.where; readonly condition: IQueryCondition }
  | { readonly operation: typeof QueryOperation.select; readonly fields: readonly string[] }
  | {
      readonly operation: typeof QueryOperation.limit | typeof QueryOperation.skip
      readonly count: number
    }
  | { readonly operation: typeof QueryOperation.distinct; readonly field: string }
  | {
      readonly operation: typeof QueryOperation.order
      readonly by: 'key'
      readonly direction: 'asc' | 'desc'
    }
  | {
      readonly operation: typeof QueryOperation.after
      readonly key: IStorageKey
      readonly direction: 'next' | 'prev'
    }

/** Native vector ranking receives declarative payload filters before it chooses its bounded hits. */
export type IVectorQueryInput = {
  readonly conditions: readonly IQueryCondition[]
  readonly topK: number
  readonly minScore: number | undefined
  readonly withVector: boolean
  readonly native?: unknown
  readonly ctx: IOperationContext | undefined
}

/** Backend vector engines own scoring, organization/TTL filtering and score/id ranking. */
export type IVectorQuerySource<TPayload, TGroupable extends boolean = false> = {
  /** Borrow the original provider lease only while a new reranked operation is actually accepted. */
  readonly beginOperation?: () => () => void
  readonly origin?: IVectorQueryOrigin
  readonly native?: true
  readonly pushdown: IQueryPushdown
  readonly asyncDisposeKey?: typeof Symbol.asyncDispose
  readonly exact?: boolean
  readonly groupBy?: TGroupable
  /** Native scalar terminals keep the same native query and original cursor owner. */
  readonly reduce?: IQueryReducer<IVectorQueryInput>
  readonly mutate?: IQueryMutator<IVectorQueryInput, IVectorHit<TPayload, boolean>, IQueryDelete>
  readonly watch?: IQueryWatcher<IVectorQueryInput>
  readonly execute: (
    input: IVectorQueryInput
  ) => IStorageIterator<readonly [IStorageKey, IVectorHit<TPayload, boolean>]>
}

/**
 * A forward step matches the current named object to the next subject in the same graph, then
 * applies its predicate and optional named object target. An inverse step matches the current
 * subject to the preceding object's identity in the same graph. Literal objects have no forward
 * step. Each step returns the matching ground quads and retains its ordered safe-prefix position.
 */
export type IRdfQueryTraversal = {
  readonly operation: typeof QueryOperation.follow | typeof QueryOperation.inverse
  readonly predicate: IRdfNamedNode
  readonly target?: IRdfNamedNode
}

/** Native RDF execution receives only the same safe prefix that explain reports. */
export type IRdfQueryInput<TOperationScope extends object = object> = {
  readonly pattern: Readonly<Partial<IQuad>>
  readonly steps: readonly (IRdfQueryTraversal | IQueryNativeStep)[]
  readonly ctx: IOperationContext | undefined
  /** A nested match borrows the exact original accepted view, never the expired user callback scope. */
  readonly operationScope?: Readonly<TOperationScope>
}

/** RDF sources retain their native cursor and actual projected row shape, owned by the plan. */
export type IRdfQuerySource<TOperationScope extends object = object> = {
  readonly pushdown: IQueryPushdown
  readonly asyncDisposeKey?: typeof Symbol.asyncDispose
  readonly nativeSteps?: true
  readonly cursorSource?: object
  /** Native scalar terminals keep the same native query and original cursor owner. */
  readonly reduce?: IQueryReducer<IRdfQueryInput<TOperationScope>>
  readonly mutate?: IQueryMutator<IRdfQueryInput<TOperationScope>, IQuad, IRdfQueryMutation>
  readonly watch?: IQueryWatcher<IRdfQueryInput<TOperationScope>>
  readonly execute: (
    input: IRdfQueryInput<TOperationScope>
  ) => IStorageIterator<readonly [IStorageKey, unknown]>
}
