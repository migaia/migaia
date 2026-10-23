import { asCodecValue, type ICodecValue } from '@migaia/serialize/codec'
import type { IMaybe } from '@migaia/utils'
import {
  parseObjectPath,
  probeObjectPathSegments,
  type IObjectPathTupleFor,
  type IObjectPath,
  type IObjectPathValue
} from '@migaia/utils/object-path'
import {
  attachErrorIdentity,
  attachSecondaryErrors,
  IdentifyError,
  toError
} from '@migaia/utils/error'
import {
  StorageContractError,
  StorageContractErrorCode,
  STORAGE_CONTRACT_SOURCE
} from './errors.js'
import { StorageContractErrorText } from './error-text.js'
import type { IOperationContext, IStorageKey } from './context.js'
import { createStorageIteratorLifetime, type IStorageIterator } from './resource.js'
import { snapshotOperationContext } from './operation-context.js'
import { runTransactionIteratorOperation, deriveTransactionIterator } from './transaction.js'
import { compareStorageKeys, snapshotStorageKey } from './key.js'
import { snapshotStorageRdfPattern, type IQuad, type IRdfNamedNode } from './capabilities/rdf.js'

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
type IQueryOperandValue = ICodecValue | undefined | bigint | Date | object
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
/** Boolean node tags never require another query state or expression platform. */
const QueryConditionKind = { field: 'field', and: 'and', or: 'or', not: 'not' } as const
/** Range comparisons accept only one shared ordered field domain per comparison. */
type IQueryComparable = number | bigint | string | Date

/** Produces the original admission boundary with its captured message and exact native cause. */
function invalidQueryCondition(
  cause?: unknown,
  message: string = StorageContractErrorText.queryCondition
): StorageContractError {
  return new StorageContractError(StorageContractErrorCode.invalidArgument, { cause }, message)
}
/** Captures opaque portable identity operands and independently owns mutable Date comparison time. */
function snapshotQueryOperand(value: unknown): IQueryOperandValue {
  if (value === undefined || typeof value === 'bigint') return value
  if (value instanceof Date) {
    /** Date comparison is by captured time, never mutable object identity. */
    const time = value.getTime()
    if (!Number.isFinite(time)) throw new TypeError(StorageContractErrorText.queryCondition)
    return new Date(time)
  }
  if (typeof value === 'object' && value !== null) return value
  return asCodecValue(value)
}
/**
 * Copies only real list positions; sparse or cyclic condition containers reject before candidate
 * reads.
 */
function snapshotQueryList(value: unknown): readonly IQueryOperandValue[] {
  if (!Array.isArray(value)) throw new TypeError(StorageContractErrorText.queryCondition)
  /** Length is borrowed once before each dense source position is read once. */
  const length = value.length
  /**
   * Each list element retains its declared comparison semantics without re-reading the source
   * later.
   */
  const captured: IQueryOperandValue[] = []
  for (let index = 0; index < length; index++) {
    if (!Object.hasOwn(value, index)) throw new TypeError(StorageContractErrorText.queryCondition)
    captured.push(snapshotQueryOperand(value[index]))
  }
  return Object.freeze(captured)
}
/** Returns a comparable point only for valid values in one declared ordered field domain. */
function queryComparable(value: unknown): IQueryComparable | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value === 'bigint' || typeof value === 'string') return value
  if (value instanceof Date && Number.isFinite(value.getTime())) return value
  return undefined
}
/** SameValueZero agrees with Set membership; Date values additionally compare their time points. */
function queryEqual(left: unknown, right: unknown): boolean {
  if (left instanceof Date || right instanceof Date)
    return left instanceof Date && right instanceof Date && left.getTime() === right.getTime()
  return (
    left === right ||
    (typeof left === 'number' &&
      typeof right === 'number' &&
      Number.isNaN(left) &&
      Number.isNaN(right))
  )
}
/** Ordered comparisons never coerce a string, bigint, number or Date into a different domain. */
function compareQueryValues(left: unknown, right: unknown): number | undefined {
  /** Both points must be comparable and from the same domain. */
  const a = queryComparable(left)
  /** The captured bound is checked independently so a type mismatch simply does not match. */
  const b = queryComparable(right)
  if (
    a === undefined ||
    b === undefined ||
    typeof a !== typeof b ||
    a instanceof Date !== b instanceof Date
  )
    return undefined
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime()
  if (typeof a === 'number' && typeof b === 'number') return a - b
  if (typeof a === 'bigint' && typeof b === 'bigint') return a < b ? -1 : a > b ? 1 : 0
  if (typeof a === 'string' && typeof b === 'string') return a < b ? -1 : a > b ? 1 : 0
  return undefined
}
/** Captures an operator's specific shape once before it can reach either planner or predicate. */
function snapshotQueryField(
  path: readonly string[],
  operator: QueryOperator,
  value: unknown
): IQueryCondition {
  /**
   * A list is copied for membership/between, while scalar and opaque identity operands keep their
   * domain.
   */
  const captured =
    operator === QueryOperator.in || operator === QueryOperator.between
      ? snapshotQueryList(value)
      : snapshotQueryOperand(value)
  if (operator === QueryOperator.exists && typeof captured !== 'boolean')
    throw new TypeError(StorageContractErrorText.queryCondition)
  if (
    (operator === QueryOperator.startsWith || operator === QueryOperator.contains) &&
    typeof captured !== 'string'
  )
    throw new TypeError(StorageContractErrorText.queryCondition)
  if (
    operator === QueryOperator.gt ||
    operator === QueryOperator.gte ||
    operator === QueryOperator.lt ||
    operator === QueryOperator.lte
  )
    if (queryComparable(captured) === undefined)
      throw new TypeError(StorageContractErrorText.queryCondition)
  if (
    operator === QueryOperator.between &&
    (!Array.isArray(captured) ||
      captured.length !== 2 ||
      compareQueryValues(captured[0], captured[1]) === undefined)
  )
    throw new TypeError(StorageContractErrorText.queryCondition)
  return Object.freeze({ kind: QueryConditionKind.field, path, operator, value: captured })
}
/** Captures the single canonical AST, distinguishing field operators from recursive nested records. */
function snapshotStorageWhere(where: unknown): IQueryCondition {
  /**
   * Only currently active container ancestors reject cycles; independent shared siblings remain
   * legal.
   */
  const active = new WeakSet<object>()
  /** Nested paths share the same validated object-path owner rather than a second path parser. */
  function visit(value: unknown, prefix: readonly string[]): IQueryCondition {
    if (
      typeof value !== 'object' ||
      value === null ||
      Array.isArray(value) ||
      value instanceof Date ||
      active.has(value)
    )
      throw new TypeError(StorageContractErrorText.queryCondition)
    active.add(value)
    try {
      /** A record's own fields are enumerated once, then each field getter is captured once. */
      const fields = Object.keys(value)
      /** Implicit AND retains source declaration order and avoids copying parent expression history. */
      const conditions: IQueryCondition[] = []
      for (const field of fields) {
        /** The only borrowed value read for this condition field. */
        const entry = Reflect.get(value, field)
        if (field === QueryConditionKind.and || field === QueryConditionKind.or) {
          if (!Array.isArray(entry)) throw new TypeError(StorageContractErrorText.queryCondition)
          /** Boolean lists contain conditions, not comparison operands. */
          const nested: IQueryCondition[] = []
          /** Capture list length once and reject sparse entries before planning/execution. */
          const length = entry.length
          for (let index = 0; index < length; index++) {
            if (!Object.hasOwn(entry, index))
              throw new TypeError(StorageContractErrorText.queryCondition)
            nested.push(visit(entry[index], prefix))
          }
          conditions.push(Object.freeze({ kind: field, conditions: Object.freeze(nested) }))
        } else if (field === QueryConditionKind.not)
          conditions.push(Object.freeze({ kind: field, condition: visit(entry, prefix) }))
        else {
          /**
           * The validated public path uses strings even for an array index's ordinary property
           * name.
           */
          const path = Object.freeze([...prefix, ...parseObjectPath(field).map(String)])
          parseObjectPath(path)
          if (
            typeof entry === 'object' &&
            entry !== null &&
            !Array.isArray(entry) &&
            !(entry instanceof Date)
          ) {
            /** Operator names are reserved only inside a field's explicit operator record. */
            const operators = Object.keys(entry)
            if (operators.some((operator) => Object.hasOwn(QueryOperator, operator))) {
              for (const operator of operators) {
                if (!Object.hasOwn(QueryOperator, operator))
                  throw new TypeError(StorageContractErrorText.queryCondition)
                conditions.push(
                  snapshotQueryField(path, operator as QueryOperator, Reflect.get(entry, operator))
                )
              }
            } else conditions.push(visit(entry, path))
          } else conditions.push(snapshotQueryField(path, QueryOperator.eq, entry))
        }
      }
      return Object.freeze({ kind: QueryConditionKind.and, conditions: Object.freeze(conditions) })
    } finally {
      active.delete(value)
    }
  }
  try {
    return visit(where, [])
  } catch (cause) {
    throw invalidQueryCondition(cause)
  }
}
/** Compiles the already captured AST once; in lists become Sets before any candidate is read. */
function compileQueryCondition<T>(condition: IQueryCondition): (value: T) => boolean {
  if (condition.kind === QueryConditionKind.not) {
    /** Boolean children are compiled once and reused by every candidate. */
    const child = compileQueryCondition<T>(condition.condition)
    return (value) => !child(value)
  }
  if (condition.kind !== QueryConditionKind.field) {
    /** The immutable child predicate list preserves short-circuit declaration order. */
    const children = condition.conditions.map((child) => compileQueryCondition<T>(child))
    return condition.kind === QueryConditionKind.and
      ? (value) => children.every((child) => child(value))
      : (value) => children.some((child) => child(value))
  }
  /** This leaf retains one validated path and one captured operand rather than caller objects. */
  const { path, operator, value: operand } = condition
  /** Ordinary identity membership and Date time membership stay distinct without custom hashing. */
  const members =
    operator === QueryOperator.in
      ? new Set(Array.isArray(operand) ? operand.filter((value) => !(value instanceof Date)) : [])
      : undefined
  /** Date list values are compiled to time points once rather than re-reading mutable objects. */
  const dateMembers =
    operator === QueryOperator.in
      ? new Set(
          Array.isArray(operand)
            ? operand.filter((value) => value instanceof Date).map((value) => value.getTime())
            : []
        )
      : undefined
  return (value) => {
    try {
      /**
       * The canonical path probe preserves missing versus present undefined and catches getter
       * failures.
       */
      const probe = probeObjectPathSegments(value, path as IObjectPathTupleFor<T>)
      if (probe.kind === 'failed') throw probe.error
      /** Missing or blocked paths have no value, while exists still retains their explicit presence. */
      const actual = probe.kind === 'value' ? probe.value : undefined
      if (operator === QueryOperator.exists) return (probe.kind === 'value') === operand
      if (operator === QueryOperator.eq) return queryEqual(actual, operand)
      if (operator === QueryOperator.ne) return !queryEqual(actual, operand)
      if (operator === QueryOperator.in)
        return actual instanceof Date ? dateMembers!.has(actual.getTime()) : members!.has(actual)
      if (operator === QueryOperator.startsWith)
        return (
          typeof actual === 'string' && typeof operand === 'string' && actual.startsWith(operand)
        )
      if (operator === QueryOperator.contains)
        return typeof actual === 'string' && typeof operand === 'string' && actual.includes(operand)
      if (operator === QueryOperator.has)
        return Array.isArray(actual) && actual.some((value) => queryEqual(value, operand))
      if (operator === QueryOperator.between)
        return (
          Array.isArray(operand) &&
          (compareQueryValues(actual, operand[0]) ?? -1) >= 0 &&
          (compareQueryValues(actual, operand[1]) ?? 1) <= 0
        )
      /** Undefined comparison means incompatible field domains, never a coercive match. */
      const comparison = compareQueryValues(actual, operand)
      if (comparison === undefined) return false
      if (operator === QueryOperator.gt) return comparison > 0
      if (operator === QueryOperator.gte) return comparison >= 0
      if (operator === QueryOperator.lt) return comparison < 0
      return comparison <= 0
    } catch (cause) {
      throw invalidQueryCondition(cause)
    }
  }
}
/**
 * Compiles one declarative condition to a stateless predicate. Operator getters and membership
 * lists are captured once; ordinary object equality is identity-based, Date equality is by captured
 * time and ranges never coerce domains. The compiler creates no owner, query, I/O or side effect.
 * Invalid conditions/paths fail with INVALID_ARGUMENT before a source can be opened.
 */
export function compileStorageWhere<T>(where: IWhere<T>): (value: T) => boolean {
  return compileQueryCondition<T>(snapshotStorageWhere(where))
}

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
  groupBy: 'groupBy'
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
}
/** Backend authors declare native support once; they do not provide another fluent executor. */
export type IQueryPushdown = {
  readonly operators: readonly QueryOperator[]
  readonly operations: readonly QueryOperation[]
  readonly source: string
  readonly index?: string
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
/** A minimal structural terminal shape preserves complete result types in generic consumers. */
export type IQueryShape<TValue = unknown> = { all(ctx?: never): Promise<TValue> }
/** Extracts the complete all result without erasing its row or augmentation inference. */
export type IQueryResultOf<TQuery extends IQueryShape> =
  TQuery extends IQueryShape<infer TValue> ? TValue : never
/** A selected result cannot select again or apply conditions to an already projected shape. */
export type IQueryResult<
  R,
  TContext extends IOperationContext | undefined = IOperationContext,
  TStatistics extends boolean = true,
  TAugmentMethods extends object = Record<never, never>
> = IQueryRead<R, TContext> &
  TAugmentMethods & {
    requirePushdown(): IQueryResult<R, TContext, TStatistics, TAugmentMethods>
  } & (TStatistics extends true ? IQueryStatistics<R, TContext> : Record<never, never>)
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
  requirePushdown(): this
}
/** Interface semantics preserve the current record state and Feature methods after limit. */
export interface IRecordQueryBaseCore<
  T,
  TContext extends IOperationContext | undefined = IOperationContext,
  TAugmentMethods extends object = Record<never, never>
>
  extends IQueryChain<T, TContext, T, true, TAugmentMethods>, IQueryStatistics<T, TContext> {
  limit(count: number): this
}
/** The comparator transition requires an explicit finite limit before any read terminal exists. */
export interface IRecordQueryCore<
  T,
  TContext extends IOperationContext | undefined = IOperationContext,
  TAugmentMethods extends object = Record<never, never>
> extends IRecordQueryBaseCore<T, TContext, TAugmentMethods> {
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
/** Ranked hits omit their potentially large vector until the chain explicitly requests it. */
export type IVectorHit<TPayload, TWithVector extends boolean = false> = {
  readonly id: string
  readonly score: number
  readonly payload?: TPayload
} & (TWithVector extends true ? { readonly vector: readonly number[] } : Record<never, never>)
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
    IQueryStatistics<IQuad, TContext> {
  limit(count: number): this
  follow(predicate: IRdfNamedNode, target?: IRdfNamedNode): this
  inverse(predicate: IRdfNamedNode): this
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
  orderByComparator: 'orderByComparator'
} as const)
/** Vector Feature admission reserves the same shared terminals plus its family refinements. */
export const VectorQueryMethod = Object.freeze({
  ...RecordQueryMethod,
  topK: 'topK',
  minScore: 'minScore',
  withVector: 'withVector',
  groupBy: 'groupBy'
} as const)
/** RDF Feature admission reserves traversal methods before returning any native source. */
export const RdfQueryMethod = Object.freeze({
  ...RecordQueryMethod,
  follow: 'follow',
  inverse: 'inverse'
} as const)
/** Captures only pure Feature methods and rejects collisions before source or cursor admission. */
function snapshotRecordQueryMethods<T extends object>(
  methods: T | undefined,
  reserved: object = RecordQueryMethod
): T | undefined {
  if (methods === undefined) return undefined
  try {
    if (
      methods !== undefined &&
      (typeof methods !== 'object' || methods === null || Array.isArray(methods))
    )
      throw new TypeError(StorageContractErrorText.queryArgument)
    /** One copy evaluates each enumerable getter once while retaining function identity. */
    const captured = { ...methods } as T
    for (const key of Reflect.ownKeys(captured))
      if (
        (typeof key === 'string' && Object.hasOwn(reserved, key)) ||
        typeof Reflect.get(captured, key) !== 'function'
      )
        throw new TypeError(StorageContractErrorText.queryArgument)
    return Object.freeze(captured)
  } catch (cause) {
    throw invalidQueryCondition(cause, StorageContractErrorText.queryArgument)
  }
}
/** Native execution consumes only the shared AST and optional top-level projection from its plan. */
export type IRecordQuerySource = {
  readonly pushdown: IQueryPushdown
  /** The original source resource key is borrowed from its host without creating a fallback. */
  readonly asyncDisposeKey?: typeof Symbol.asyncDispose
  /** Optional source-key tail order; parts marks an author container of independently valid keys. */
  readonly tieBreakByKey?: Readonly<{ direction: 'next' | 'prev'; parts?: true }>
  readonly execute: (input: {
    readonly conditions: readonly IQueryCondition[]
    readonly fields: readonly string[] | undefined
    readonly ctx: IOperationContext | undefined
  }) => IStorageIterator<readonly [IStorageKey, unknown]>
}
/** Native vector ranking receives declarative payload filters before it chooses its bounded hits. */
export type IVectorQueryInput = {
  readonly conditions: readonly IQueryCondition[]
  readonly topK: number
  readonly minScore: number | undefined
  readonly withVector: boolean
  readonly ctx: IOperationContext | undefined
}
/** Backend vector engines own scoring, organization/TTL filtering and score/id ranking. */
export type IVectorQuerySource<TPayload, TGroupable extends boolean = false> = {
  readonly pushdown: IQueryPushdown
  readonly asyncDisposeKey?: typeof Symbol.asyncDispose
  readonly exact?: boolean
  readonly groupBy?: TGroupable
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
export type IRdfQueryInput = {
  readonly pattern: Readonly<Partial<IQuad>>
  readonly steps: readonly (
    | IRdfQueryTraversal
    | {
        readonly operation: typeof QueryOperation.where
        readonly condition: IQueryCondition
      }
    | {
        readonly operation: typeof QueryOperation.select
        readonly fields: readonly string[]
      }
  )[]
  readonly ctx: IOperationContext | undefined
}
/** RDF sources keep their original indexed/remote cursor and original operation lifetime. */
export type IRdfQuerySource = {
  readonly pushdown: IQueryPushdown
  readonly asyncDisposeKey?: typeof Symbol.asyncDispose
  readonly execute: (input: IRdfQueryInput) => IStorageIterator<readonly [IStorageKey, IQuad]>
}
/** Nodes retain only their immediate predecessor, so deriving a branch never copies its history. */
type IQueryNode = {
  readonly previous: IQueryNode | undefined
  readonly step:
    | { readonly operation: typeof QueryOperation.limit; readonly count: number }
    | {
        readonly operation: typeof QueryOperation.comparator
        readonly compare: (left: unknown, right: unknown) => number
      }
    | { readonly operation: typeof QueryOperation.where; readonly condition: IQueryCondition }
    | {
        readonly operation: typeof QueryOperation.predicate
        readonly predicate: (row: unknown) => boolean
      }
    | { readonly operation: typeof QueryOperation.select; readonly fields: readonly string[] }
    | {
        readonly operation: typeof QueryOperation.mapper
        readonly mapper: (row: unknown) => unknown
      }
    | { readonly operation: typeof QueryOperation.topK; readonly count: number }
    | { readonly operation: typeof QueryOperation.minScore; readonly score: number }
    | IRdfQueryTraversal
    | {
        readonly operation: typeof QueryOperation.groupBy
        readonly field: string
        readonly perGroup: number
      }
}
/** Captured author facts and methods remain independent of later source getter mutation. */
type IQuerySourceSnapshot = {
  readonly pushdown: IQueryPushdown
  readonly asyncDisposeKey: typeof Symbol.asyncDispose | undefined
  readonly tieBreakByKey: IRecordQuerySource['tieBreakByKey']
  readonly execute: IRecordQuerySource['execute']
  readonly receiver: IRecordQuerySource
  readonly vector?: {
    readonly withVector: boolean
    readonly exact: boolean
    readonly groupBy: boolean
  }
  readonly rdf?: { readonly pattern: Readonly<Partial<IQuad>> }
}
/** Canonical key directions apply only to explicit comparator tie resolution. */
const QueryKeyDirection = { next: 'next', prev: 'prev' } as const
/** Planning retains the actual nodes so native and client execution cannot diverge from explain. */
type IRecordExecutionPlan = {
  readonly explanation: IQueryPlan
  readonly pushed: readonly IQueryNode['step'][]
  readonly client: readonly IQueryNode['step'][]
}

/** Attaches query identity without replacing a mutable native failure or an already coded error. */
function queryExecutionFailure(cause: unknown): Error {
  /** Existing package identity remains authoritative, including native source cursor failures. */
  const failure = toError(cause)
  if (IdentifyError.identityOf(failure)) return failure
  /** The already registered argument boundary owns callback contract failures. */
  const identity = {
    source: STORAGE_CONTRACT_SOURCE,
    code: StorageContractErrorCode.invalidArgument
  }
  return attachErrorIdentity(failure, identity, {
    onConflict: ({ target }) =>
      attachErrorIdentity(
        new Error(StorageContractErrorText.queryExecution, { cause: target }),
        identity
      ),
    onFailure: ({ target, cause: attachmentFailure }) =>
      attachErrorIdentity(
        new AggregateError([target, attachmentFailure], StorageContractErrorText.queryExecution),
        identity
      )
  })
}
/** A top-level native support declaration is snapshotted once before any chain is returned. */
function snapshotQuerySource(source: IRecordQuerySource): IQuerySourceSnapshot {
  try {
    if (typeof source !== 'object' || source === null)
      throw new TypeError(StorageContractErrorText.queryArgument)
    /** Every borrowed descriptor field is captured once, never consulted during later execution. */
    const { pushdown, execute } = source
    /** Support arrays become independent immutable planner facts. */
    const { operators, operations, source: sourceName, index } = pushdown
    if (
      !Array.isArray(operators) ||
      !Array.isArray(operations) ||
      typeof sourceName !== 'string' ||
      sourceName.length === 0 ||
      (index !== undefined && typeof index !== 'string') ||
      typeof execute !== 'function'
    )
      throw new TypeError(StorageContractErrorText.queryArgument)
    /** Dense declaration arrays reject an omitted operator rather than silently widening support. */
    const capture = <T extends string>(values: readonly T[], table: object): readonly T[] => {
      /** The owning snapshot checks and copies each actual declaration once. */
      const result: T[] = []
      /** Borrowed arrays, including proxies, have their length read once during admission. */
      const length = values.length
      for (let position = 0; position < length; position++) {
        /** A missing slot never runs its getter; a present value must name a declared operation. */
        let value: T | undefined
        if (
          !Object.hasOwn(values, position) ||
          typeof (value = values[position]) !== 'string' ||
          !Object.hasOwn(table, value)
        )
          throw new TypeError(StorageContractErrorText.queryArgument)
        result.push(value)
      }
      return Object.freeze(result)
    }
    /** Existing source admission finishes before reading the new optional key-order fact. */
    const capturedPushdown = Object.freeze({
      operators: capture(operators, QueryOperator),
      operations: capture(operations, QueryOperation),
      source: sourceName,
      ...(index === undefined ? {} : { index })
    })
    /** One read keeps a mutable author descriptor from changing later comparison semantics. */
    const keyOrder = source.tieBreakByKey
    /** The captured declaration cannot change direction or key-budget interpretation later. */
    let tieBreakByKey: IRecordQuerySource['tieBreakByKey']
    if (keyOrder !== undefined) {
      if (typeof keyOrder !== 'object' || keyOrder === null || Array.isArray(keyOrder))
        throw new TypeError(StorageContractErrorText.queryArgument)
      /** Each descriptor field is borrowed once under the original source-admission boundary. */
      const { direction, parts } = keyOrder
      if (
        (direction !== QueryKeyDirection.next && direction !== QueryKeyDirection.prev) ||
        (parts !== undefined && parts !== true)
      )
        throw new TypeError(StorageContractErrorText.queryArgument)
      tieBreakByKey = Object.freeze({ direction, ...(parts === undefined ? {} : { parts }) })
    }
    /** The source key is captured once; omission retains the native symbol's existing semantics. */
    const configuredAsyncDisposeKey = source.asyncDisposeKey
    if (configuredAsyncDisposeKey !== undefined && typeof configuredAsyncDisposeKey !== 'symbol')
      throw new TypeError(StorageContractErrorText.queryArgument)
    return {
      receiver: source,
      execute,
      pushdown: capturedPushdown,
      tieBreakByKey,
      asyncDisposeKey: configuredAsyncDisposeKey ?? Symbol.asyncDispose
    }
  } catch (cause) {
    throw invalidQueryCondition(cause, StorageContractErrorText.queryArgument)
  }
}
/** Object identity must stay client-side even when a backend can compare native structured values. */
function queryConditionReason(
  condition: IQueryCondition,
  operators: ReadonlySet<QueryOperator>
): string | undefined {
  if (condition.kind === QueryConditionKind.not)
    return queryConditionReason(condition.condition, operators)
  if (condition.kind !== QueryConditionKind.field) {
    for (const child of condition.conditions) {
      /** The first actual reason explains why the complete boolean node cannot be pushed. */
      const reason = queryConditionReason(child, operators)
      if (reason !== undefined) return reason
    }
    return undefined
  }
  if (!operators.has(condition.operator)) return StorageContractErrorText.queryUnsupported
  /** Dates have native time semantics; other non-null objects have JavaScript identity semantics. */
  const identity = (value: unknown): boolean =>
    typeof value === 'object' && value !== null && !(value instanceof Date)
  if (
    (condition.operator === QueryOperator.in &&
      Array.isArray(condition.value) &&
      condition.value.some(identity)) ||
    ((condition.operator === QueryOperator.eq ||
      condition.operator === QueryOperator.ne ||
      condition.operator === QueryOperator.has) &&
      identity(condition.value))
  )
    return StorageContractErrorText.queryIdentity
  return undefined
}
/** Flattens history once and keeps the longest semantically safe native record prefix. */
function planRecordQuery(
  source: IQuerySourceSnapshot,
  node: IQueryNode | undefined,
  countOnly = false
): IRecordExecutionPlan {
  /** One reverse traversal avoids repeated prefix allocation during fluent construction. */
  const steps: IQueryNode['step'][] = []
  for (let current = node; current !== undefined; current = current.previous)
    steps.push(current.step)
  steps.reverse()
  for (let index = 0; index < steps.length; index++)
    if (
      steps[index]!.operation === QueryOperation.comparator &&
      steps[index + 1]?.operation !== QueryOperation.limit
    )
      throw invalidQueryCondition(undefined, StorageContractErrorText.queryComparatorLimit)
  /** Membership lookups are compiled once per plan, never once per row. */
  const operations = new Set(source.pushdown.operations)
  /** Field support has the same lifetime as this single execution plan. */
  const operators = new Set(source.pushdown.operators)
  /** Actual pushed nodes are handed unchanged to the source execution callback. */
  const pushed: IQueryNode['step'][] = []
  /** Client nodes preserve declaration order after the first non-pushable operation. */
  const client: IQueryNode['step'][] = []
  /** Explain exposes independent immutable facts without callbacks or data reads. */
  const pushedSteps: IQueryPlanStep[] = []
  /** A reason is attached to each client step, including later safe-prefix boundaries. */
  const clientSteps: IQueryPlanStep[] = []
  for (const step of steps) {
    /** Cardinality keeps conditions and page controls without evaluating output-only callbacks. */
    if (
      countOnly &&
      (step.operation === QueryOperation.comparator ||
        step.operation === QueryOperation.select ||
        step.operation === QueryOperation.mapper)
    )
      continue
    /** Vector filters/ranking cross payload callbacks; record/RDF retain their safe prefix. */
    const vectorNative =
      source.vector !== undefined &&
      (step.operation === QueryOperation.where ||
        step.operation === QueryOperation.topK ||
        step.operation === QueryOperation.minScore)
    /** A prior client node is a barrier for every subsequent record/RDF operation. */
    const reason =
      client.length > 0 && !vectorNative
        ? StorageContractErrorText.queryPrefix
        : step.operation === QueryOperation.predicate ||
            step.operation === QueryOperation.mapper ||
            step.operation === QueryOperation.comparator ||
            step.operation === QueryOperation.groupBy
          ? source.vector !== undefined && step.operation === QueryOperation.predicate
            ? StorageContractErrorText.queryVectorFunction
            : StorageContractErrorText.queryFunction
          : step.operation === QueryOperation.limit ||
              (source.vector !== undefined && step.operation === QueryOperation.select) ||
              !operations.has(step.operation)
            ? StorageContractErrorText.queryUnsupported
            : step.operation === QueryOperation.where
              ? queryConditionReason(step.condition, operators)
              : undefined
    if (reason === undefined) {
      pushed.push(step)
      pushedSteps.push(
        Object.freeze({
          operation: step.operation,
          ...(source.pushdown.index === undefined ? {} : { index: source.pushdown.index })
        })
      )
    } else {
      client.push(step)
      clientSteps.push(Object.freeze({ operation: step.operation, reason }))
    }
  }
  return {
    pushed,
    client,
    explanation: Object.freeze({
      pushed: Object.freeze(pushedSteps),
      client: Object.freeze(clientSteps),
      fullScan:
        source.vector !== undefined
          ? source.vector.exact || source.pushdown.index === undefined
          : source.pushdown.index === undefined ||
            ((source.rdf === undefined || Object.keys(source.rdf.pattern).length === 0) &&
              !pushed.some((step) => step.operation === QueryOperation.where)),
      source: source.pushdown.source,
      ...(source.pushdown.index === undefined ? {} : { index: source.pushdown.index })
    })
  }
}
/** External cancellation is observed around accepted work without abandoning a native cursor. */
function assertQueryActive(ctx: IOperationContext | undefined): void {
  if (ctx?.signal?.aborted)
    throw new StorageContractError(StorageContractErrorCode.aborted, { cause: ctx.signal.reason })
}
/** One pull stays inside the original source operation view supplied for this accepted read. */
type IQueryAdvance = () => Promise<IteratorResult<readonly [IStorageKey, unknown]>>
/** Each compiled node transforms one upstream pull without owning another cursor or queue. */
type IQueryReader = (
  advance: IQueryAdvance
) => Promise<IteratorResult<unknown> & { readonly key?: IStorageKey }>
/** Stable candidate order resolves comparator ties without retaining discarded source rows. */
type IQueryHeapEntry = {
  readonly value: unknown
  readonly position: number
  readonly key?: IStorageKey
}
/** An author-only composite adds no logical-key depth or node cost to its valid components. */
function snapshotQuerySourceKey(
  key: IStorageKey,
  order: NonNullable<IRecordQuerySource['tieBreakByKey']>
): IStorageKey {
  if (order.parts !== true) return snapshotStorageKey(key, undefined)
  if (!Array.isArray(key)) throw new TypeError(StorageContractErrorText.queryArgument)
  /** Only the metadata container is borrowed here; every component uses the canonical key owner. */
  const length = key.length
  if (length === 0) throw new TypeError(StorageContractErrorText.queryArgument)
  /** Component snapshots retain the same comparison representation without re-encoding keys. */
  const parts: IStorageKey[] = []
  for (let index = 0; index < length; index++) parts.push(snapshotStorageKey(key[index], undefined))
  return parts
}
/** The largest retained candidate sits at the root, allowing one bounded replacement per source row. */
function queryHeapSiftDown(
  heap: IQueryHeapEntry[],
  size: number,
  compare: (left: IQueryHeapEntry, right: IQueryHeapEntry) => number
): void {
  /** Only the root can violate heap order after replacement or extraction. */
  let position = 0
  while (position * 2 + 1 < size) {
    /** The larger child belongs above its sibling in this maximum heap. */
    let child = position * 2 + 1
    if (child + 1 < size && compare(heap[child + 1]!, heap[child]!) > 0) child++
    if (compare(heap[position]!, heap[child]!) >= 0) break
    ;[heap[position], heap[child]] = [heap[child]!, heap[position]!]
    position = child
  }
}
/** Compiles the existing client plan once; comparator buffering is bounded by its explicit limit. */
function compileRecordQueryReader(
  steps: readonly IQueryNode['step'][],
  ctx: IOperationContext | undefined,
  tieBreakByKey: IRecordQuerySource['tieBreakByKey'],
  vector = false
): IQueryReader {
  /** The leaf borrows the one original backend cursor; no row array is materialized. */
  let read: IQueryReader = async (advance) => {
    assertQueryActive(ctx)
    /** Native next settles before any client node or cleanup starts. */
    const next = await advance()
    assertQueryActive(ctx)
    if (next.done) return { done: true, value: undefined }
    if (tieBreakByKey === undefined) return { done: false, value: next.value[1] }
    /** Capture the native tuple once; only explicit key ordering owns a detached key snapshot. */
    const row = next.value
    /** Retained keys detach before projected value access can mutate any borrowed source objects. */
    const key = snapshotQuerySourceKey(row[0], tieBreakByKey)
    return { done: false, value: row[1], key }
  }
  for (let index = 0; index < steps.length; index++) {
    /** A node captures its direct upstream reader rather than copying preceding history. */
    const upstream = read
    /** The original planned node determines execution and explain together. */
    const step = steps[index]!
    if (step.operation === QueryOperation.where || step.operation === QueryOperation.predicate) {
      /** Declarative membership Sets are compiled once before any candidate read. */
      const predicate =
        step.operation === QueryOperation.where
          ? compileQueryCondition<unknown>(step.condition)
          : step.predicate
      read = async (advance) => {
        while (true) {
          /** Filtering discards each rejected row immediately. */
          const next = await upstream(advance)
          if (next.done) return next
          if (predicate(vector ? (next.value as IVectorHit<unknown>).payload : next.value)) {
            assertQueryActive(ctx)
            return next
          }
          assertQueryActive(ctx)
        }
      }
    } else if (
      step.operation === QueryOperation.mapper ||
      step.operation === QueryOperation.select
    ) {
      read = async (advance) => {
        /** Projection consumes exactly one accepted upstream row. */
        const next = await upstream(advance)
        if (next.done) return next
        if (step.operation === QueryOperation.mapper) {
          /** Awaited mapping remains part of the original accepted read. */
          const value = await step.mapper(next.value)
          assertQueryActive(ctx)
          return tieBreakByKey === undefined
            ? { done: false, value }
            : { done: false, value, key: next.key }
        }
        /** Own data properties cannot mutate a row prototype, including a selected **proto**. */
        const value: Record<string, unknown> = {}
        for (const field of step.fields)
          Object.defineProperty(value, field, {
            enumerable: true,
            configurable: true,
            writable: true,
            value:
              next.value === null || next.value === undefined
                ? undefined
                : Reflect.get(Object(next.value), field)
          })
        return tieBreakByKey === undefined
          ? { done: false, value }
          : { done: false, value, key: next.key }
      }
    } else if (step.operation === QueryOperation.limit) {
      /** Admission reserves one remaining position before awaiting the upstream read. */
      let remaining = step.count
      read = async (advance) =>
        remaining-- > 0 ? upstream(advance) : { done: true, value: undefined }
    } else if (step.operation === QueryOperation.groupBy) {
      /** At most the already ranked topK hits enter this single grouping pass. */
      let groups:
        | readonly { readonly group: unknown; readonly hits: readonly unknown[] }[]
        | undefined
      /** One initialization belongs to the same original accepted reader operation. */
      let prepared: Promise<void> | undefined
      /** Emission preserves each group's first best-hit position. */
      let emitted = 0
      read = async (advance) => {
        await (prepared ??= (async () => {
          /** Map uses SameValueZero, preserving number/string/boolean domains and equal zeroes. */
          const grouped = new Map<string | number | boolean, unknown[]>()
          while (true) {
            /** No candidate outside the original engine topK is requested or scored. */
            const next = await upstream(advance)
            if (next.done) break
            /** Missing or non-scalar own fields do not create a replacement group. */
            const payload = (next.value as IVectorHit<unknown>).payload
            if (
              typeof payload !== 'object' ||
              payload === null ||
              !Object.hasOwn(payload, step.field)
            )
              continue
            /** The grouping field is read once from this accepted hit. */
            const group = Reflect.get(payload, step.field)
            if (
              !(
                typeof group === 'string' ||
                typeof group === 'boolean' ||
                (typeof group === 'number' && Number.isFinite(group))
              )
            )
              continue
            /** Retain only each group's caller-declared bounded prefix. */
            const hits = grouped.get(group)
            if (hits === undefined) grouped.set(group, [next.value])
            else if (hits.length < step.perGroup) hits.push(next.value)
          }
          groups = [...grouped].map(([group, hits]) => ({ group, hits }))
        })())
        return emitted === groups!.length
          ? { done: true, value: undefined }
          : { done: false, value: groups![emitted++] }
      }
    } else if (step.operation === QueryOperation.comparator) {
      /** Comparator admission already proved the immediately following bound. */
      const bound = steps[++index] as Extract<
        IQueryNode['step'],
        { readonly operation: typeof QueryOperation.limit }
      >
      /** At most bound.count entries survive; source positions preserve stable ties. */
      const heap: IQueryHeapEntry[] = []
      /** One shared initialization prevents concurrent next calls from scanning the source twice. */
      let prepared: Promise<void> | undefined
      /** Emission advances only through the bounded retained result. */
      let emitted = 0
      /** Borrowed callbacks keep their original plain invocation receiver. */
      const compareRows = step.compare
      /** Comparator equality uses an explicit source key tail, otherwise original stable position. */
      const compare = (left: IQueryHeapEntry, right: IQueryHeapEntry): number => {
        /** JavaScript comparator NaN and zero both enter the declared tie path. */
        const order = compareRows(left.value, right.value)
        if (order) return order
        /** Every keyed candidate carries its one captured original source key through all nodes. */
        const keyOrder = tieBreakByKey === undefined ? 0 : compareStorageKeys(left.key!, right.key!)
        return (
          (tieBreakByKey?.direction === QueryKeyDirection.prev ? -keyOrder : keyOrder) ||
          left.position - right.position
        )
      }
      /** Scans each upstream candidate once and sorts only the retained bounded heap. */
      async function prepare(advance: IQueryAdvance): Promise<void> {
        if (bound.count === 0) return
        /** Source order is stable even when equal candidates arrive far apart. */
        let position = 0
        while (true) {
          /** Discarded rows become unreachable after this iteration. */
          const next = await upstream(advance)
          if (next.done) break
          /** Only this candidate and the retained heap are live during selection. */
          const entry: IQueryHeapEntry =
            tieBreakByKey === undefined
              ? { value: next.value, position: position++ }
              : { value: next.value, position: position++, key: next.key }
          if (heap.length < bound.count) {
            heap.push(entry)
            /** Appending can violate only this new leaf's ancestor path. */
            let child = heap.length - 1
            while (child > 0) {
              /** Integer parent indexing keeps each insertion logarithmic in the explicit bound. */
              const parent = Math.floor((child - 1) / 2)
              if (compare(heap[parent]!, heap[child]!) >= 0) break
              ;[heap[parent], heap[child]] = [heap[child]!, heap[parent]!]
              child = parent
            }
          } else if (compare(entry, heap[0]!) < 0) {
            heap[0] = entry
            queryHeapSiftDown(heap, heap.length, compare)
          }
          assertQueryActive(ctx)
        }
        for (let end = heap.length - 1; end > 0; end--) {
          ;[heap[0], heap[end]] = [heap[end]!, heap[0]!]
          queryHeapSiftDown(heap, end, compare)
        }
      }
      read = async (advance) => {
        await (prepared ??= prepare(advance))
        if (emitted >= heap.length) return { done: true, value: undefined }
        /** A bounded winner keeps its key available to later compiled reader nodes. */
        const entry = heap[emitted++]!
        return tieBreakByKey === undefined
          ? { done: false, value: entry.value }
          : { done: false, value: entry.value, key: entry.key }
      }
    } else {
      throw invalidQueryCondition(undefined, StorageContractErrorText.queryArgument)
    }
  }
  /** Every terminal transition observes cancellation, including a final projection or zero limit. */
  return async (advance) => {
    assertQueryActive(ctx)
    /** The compiled node chain retains no operation view beyond this accepted read. */
    const next = await read(advance)
    assertQueryActive(ctx)
    return tieBreakByKey === undefined || next.done ? next : { done: false, value: next.value }
  }
}
/** Plans once and opens only the original native prefix; terminal adapters share this execution. */
function openRecordQuery(
  source: IQuerySourceSnapshot,
  node: IQueryNode | undefined,
  strict: boolean,
  ctx: IOperationContext | undefined,
  countOnly = false
): {
  readonly iterator: IStorageIterator<readonly [IStorageKey, unknown]>
  readonly read: IQueryReader
  readonly ctx: IOperationContext | undefined
} {
  /** Strictness and missing comparator bounds reject before a source can open. */
  const plan = planRecordQuery(source, node, countOnly)
  /** Ranking and traversal cannot be emulated by the ordinary row reader. */
  const requiredNative = plan.client.filter(
    (step) =>
      step.operation === QueryOperation.topK ||
      step.operation === QueryOperation.minScore ||
      step.operation === QueryOperation.follow ||
      step.operation === QueryOperation.inverse
  )
  if ((strict && plan.client.length > 0) || requiredNative.length > 0)
    throw new StorageContractError(
      StorageContractErrorCode.queryNotPushable,
      {},
      StorageContractErrorText.queryNotPushable(plan.explanation.client.map((step) => step.reason!))
    )
  /** Captured intent is shared by the source and every client node. */
  const captured = snapshotOperationContext(ctx)
  assertQueryActive(captured)
  /** Native execution receives exactly the safe prefix represented by explain. */
  const conditions = Object.freeze(
    plan.pushed.flatMap((step) => (step.operation === QueryOperation.where ? [step.condition] : []))
  )
  /** Only a fully native prefix can project source rows. */
  const fields = plan.pushed.find((step) => step.operation === QueryOperation.select)?.fields
  /** Node compilation creates no source I/O and retains no materialized row array. */
  const read = compileRecordQueryReader(
    plan.client,
    captured,
    source.tieBreakByKey,
    source.vector !== undefined
  )
  try {
    /** Each family calls its original native engine inside this same accepted source operation. */
    let input: IVectorQueryInput | IRdfQueryInput | Parameters<IRecordQuerySource['execute']>[0]
    if (source.vector !== undefined) {
      /** The last immutable refinement supplies the one final engine ranking bound/threshold. */
      const bounds = plan.pushed.filter((step) => step.operation === QueryOperation.topK)
      /** Score threshold is also a final query option rather than a second client filter. */
      const scores = plan.pushed.filter((step) => step.operation === QueryOperation.minScore)
      input = {
        conditions,
        topK: bounds.at(-1)!.count,
        minScore: scores.at(-1)?.score,
        withVector: source.vector.withVector,
        ctx: captured
      }
    } else if (source.rdf !== undefined) {
      input = {
        pattern: source.rdf.pattern,
        steps: Object.freeze(plan.pushed as IRdfQueryInput['steps'][number][]),
        ctx: captured
      }
    } else input = { conditions, fields, ctx: captured }
    return {
      iterator: Reflect.apply(source.execute, source.receiver, [input]),
      read,
      ctx: captured
    }
  } catch (cause) {
    throw queryExecutionFailure(cause)
  }
}
/** Records the original primary before awaiting original cursor cleanup on every read failure. */
async function failedRecordQuery(
  iterator: IStorageIterator<unknown>,
  fail: (error: unknown) => unknown,
  cause: unknown
): Promise<never> {
  /** Cleanup cannot replace an earlier predicate, mapper, comparator or native failure. */
  let primary = queryExecutionFailure(fail(queryExecutionFailure(cause)))
  try {
    await iterator.dispose()
  } catch (cleanup) {
    primary = queryExecutionFailure(
      attachSecondaryErrors(primary, [queryExecutionFailure(cleanup)])
    )
  }
  throw primary
}
/** Every read terminal remains accepted through its callbacks and original cursor cleanup. */
async function consumeRecordQuery<R, TResult>(
  source: IQuerySourceSnapshot,
  node: IQueryNode | undefined,
  strict: boolean,
  ctx: IOperationContext | undefined,
  consume: (
    read: () => Promise<IteratorResult<R>>,
    ctx: IOperationContext | undefined
  ) => Promise<TResult>,
  countOnly = false
): Promise<TResult> {
  /** Opening synchronously admits the complete terminal to the original transaction owner. */
  const { iterator, read, ctx: captured } = openRecordQuery(source, node, strict, ctx, countOnly)
  return runTransactionIteratorOperation(iterator, async (advance, fail) => {
    /** The terminal's scalar, bounded chunk or explicit all result stays inside the same operation. */
    let result: TResult
    try {
      result = await consume(async () => (await read(advance)) as IteratorResult<R>, captured)
    } catch (cause) {
      return failedRecordQuery(iterator, fail, cause)
    }
    try {
      await iterator.dispose()
    } catch (cause) {
      throw queryExecutionFailure(fail(queryExecutionFailure(cause)))
    }
    return result
  })
}

/** Terminal field names are captured before a source is opened, without inspecting row shapes. */
function assertQueryField(field: unknown): asserts field is string {
  if (typeof field !== 'string')
    throw invalidQueryCondition(undefined, StorageContractErrorText.queryArgument)
}

/** Common read and numeric terminals borrow only the existing planner, reader and resource owner. */
function recordQueryReads<R, TContext extends IOperationContext | undefined>(
  source: IQuerySourceSnapshot,
  node: IQueryNode | undefined,
  strict: boolean
): IQueryRead<R, TContext> & IQueryStatistics<R, TContext> {
  /** These new terminal reductions have no native author callback in the current source shape. */
  function assertClientTerminal(): void {
    if (strict)
      throw new StorageContractError(
        StorageContractErrorCode.queryNotPushable,
        {},
        StorageContractErrorText.queryNotPushable([StorageContractErrorText.queryUnsupported])
      )
  }
  /** Only comparator.first supplies the documented implicit one-row retained bound. */
  const firstNode: IQueryNode | undefined =
    node?.step.operation === QueryOperation.comparator
      ? { previous: node, step: { operation: QueryOperation.limit, count: 1 } }
      : node
  /** Presence is the original IteratorResult.done bit, including a present undefined value. */
  const first = (ctx?: TContext): Promise<IteratorResult<R>> =>
    consumeRecordQuery<R, IteratorResult<R>>(source, firstNode, strict, ctx, (read) => read())
  /** One scalar accumulator reads each actual numeric field once and never retains source rows. */
  async function aggregate(
    operation:
      | typeof RecordQueryMethod.min
      | typeof RecordQueryMethod.max
      | typeof RecordQueryMethod.sum
      | typeof RecordQueryMethod.avg,
    field: string,
    ctx?: TContext
  ): Promise<number | IMaybe<number>> {
    assertQueryField(field)
    assertClientTerminal()
    return consumeRecordQuery<R, number | IMaybe<number>>(
      source,
      node,
      strict,
      ctx,
      async (read) => {
        /** Missing optional samples do not turn a real zero into an empty result. */
        let count = 0
        /** The same scalar holds a running sum or the current extremum. */
        let value = 0
        while (true) {
          /** The canonical reader applies every condition, projection and bound before aggregation. */
          const next = await read()
          if (next.done) break
          /** A typed numeric field may be absent; real nonnumeric/nonfinite data is invalid. */
          const sample = next.value == null ? undefined : Reflect.get(Object(next.value), field)
          if (sample === undefined || sample === null) continue
          if (typeof sample !== 'number' || !Number.isFinite(sample))
            throw invalidQueryCondition(undefined, StorageContractErrorText.queryNumericField)
          if (operation === RecordQueryMethod.min)
            value = count === 0 || sample < value ? sample : value
          else if (operation === RecordQueryMethod.max)
            value = count === 0 || sample > value ? sample : value
          else value += sample
          count++
        }
        if (operation === RecordQueryMethod.sum) return value
        return count === 0
          ? { some: false }
          : { some: true, value: operation === RecordQueryMethod.avg ? value / count : value }
      }
    )
  }
  return {
    all: (ctx) =>
      consumeRecordQuery<R, R[]>(source, node, strict, ctx, async (read) => {
        /** Only the explicit all terminal retains all accepted rows. */
        const rows: R[] = []
        while (true) {
          /** Rows come from the same lazy reader exposed by stream. */
          const next = await read()
          if (next.done) return rows
          rows.push(next.value)
        }
      }),
    first: async (ctx) => {
      /** A present undefined value intentionally collapses only at this terminal. */
      const next = await first(ctx)
      return next.done ? undefined : next.value
    },
    maybe: async (ctx) => {
      /** The discriminant preserves presence independently of payload value. */
      const next = await first(ctx)
      return next.done ? { some: false } : { some: true, value: next.value }
    },
    firstOrThrow: async (ctx) => {
      /** Cleanup finishes before the empty-result error crosses the package boundary. */
      const next = await first(ctx)
      if (next.done)
        throw new StorageContractError(
          StorageContractErrorCode.queryEmptyResult,
          {},
          StorageContractErrorText.queryEmptyResult
        )
      return next.value
    },
    exists: async (ctx) => !(await first(ctx)).done,
    count: async (ctx) => {
      assertClientTerminal()
      return consumeRecordQuery<R, number>(
        source,
        node,
        strict,
        ctx,
        async (read) => {
          /** Cardinality retains no accepted row and never requests output-only planner nodes. */
          let count = 0
          while (!(await read()).done) count++
          return count
        },
        true
      )
    },
    pluck: async (field, ctx) => {
      assertQueryField(field)
      /** Pluck uses the existing field-projection node, including native projection when declared. */
      const projection: IQueryNode = {
        previous: node,
        step: { operation: QueryOperation.select, fields: Object.freeze([field]) }
      }
      return consumeRecordQuery<R, R[typeof field][]>(
        source,
        projection,
        strict,
        ctx,
        async (read) => {
          /** Pluck explicitly returns only selected field values, without retaining full rows. */
          const values: R[typeof field][] = []
          while (true) {
            /** Missing values remain undefined, matching normal field projection. */
            const next = await read()
            if (next.done) return values
            values.push(
              (next.value == null
                ? undefined
                : Reflect.get(Object(next.value), field)) as R[typeof field]
            )
          }
        }
      )
    },
    each: async (fn, ctx) => {
      if (typeof fn !== 'function')
        throw invalidQueryCondition(undefined, StorageContractErrorText.queryArgument)
      assertClientTerminal()
      return consumeRecordQuery<R, number>(source, node, strict, ctx, async (read, captured) => {
        /** The next original row is requested only after this callback completes. */
        let count = 0
        while (true) {
          /** The callback belongs to the terminal's already accepted transaction operation. */
          const next = await read()
          if (next.done) return count
          await fn(next.value, count++)
          assertQueryActive(captured)
        }
      })
    },
    chunk: async (size, fn, ctx) => {
      if (!Number.isSafeInteger(size) || size <= 0)
        throw invalidQueryCondition(undefined, StorageContractErrorText.queryChunk)
      if (typeof fn !== 'function')
        throw invalidQueryCondition(undefined, StorageContractErrorText.queryArgument)
      assertClientTerminal()
      return consumeRecordQuery<R, number>(source, node, strict, ctx, async (read, captured) => {
        /** One caller-declared bounded batch is live at a time. */
        let rows: R[] = []
        /** The terminal counts accepted rows, including a final partial batch. */
        let count = 0
        while (true) {
          /** Native exhaustion is observed through the same registered reader. */
          const next = await read()
          if (next.done) {
            if (rows.length > 0) {
              await fn(rows)
              assertQueryActive(captured)
            }
            return count
          }
          rows.push(next.value)
          count++
          if (rows.length === size) {
            await fn(rows)
            assertQueryActive(captured)
            rows = []
          }
        }
      })
    },
    min: (field, ctx) =>
      aggregate(RecordQueryMethod.min, field, ctx) as Promise<IMaybe<NonNullable<R[typeof field]>>>,
    max: (field, ctx) =>
      aggregate(RecordQueryMethod.max, field, ctx) as Promise<IMaybe<NonNullable<R[typeof field]>>>,
    sum: (field, ctx) => aggregate(RecordQueryMethod.sum, field, ctx) as Promise<number>,
    avg: (field, ctx) => aggregate(RecordQueryMethod.avg, field, ctx) as Promise<IMaybe<number>>,
    stream: (ctx) => streamRecordQuery<R>(source, node, strict, ctx),
    explain: () => planRecordQuery(source, node).explanation
  }
}

/**
 * Streams the same compiled reader over the original source resource. Each accepted next borrows
 * its original transaction operation. Root and transaction streams share the canonical resource
 * lifetime, so cleanup waits the complete accepted read, including an asynchronous mapper.
 */
function streamRecordQuery<R>(
  source: IQuerySourceSnapshot,
  node: IQueryNode | undefined,
  strict: boolean,
  ctx: IOperationContext | undefined
): IStorageIterator<R> {
  /** The source resource, including both cleanup Promises, remains the sole native cursor owner. */
  const { iterator, read } = openRecordQuery(source, node, strict, ctx)
  /** Registered sources retain full mapped-next and buffered-result scope ownership. */
  const derived = deriveTransactionIterator(iterator, async (advance, fail) => {
    try {
      return (await read(advance)) as IteratorResult<R>
    } catch (cause) {
      return failedRecordQuery(iterator, fail, cause)
    }
  })
  if (derived) return derived
  /** The mapped root and its diagnostic forwarding use the same original source resource key. */
  const asyncDisposeKey: typeof Symbol.asyncDispose = source.asyncDisposeKey!
  /** Root mapped reads share the canonical accepted-advance drain with transaction resources. */
  const lifetime = createStorageIteratorLifetime<R>({
    close: () => iterator.dispose(),
    // The original source owns cleanup diagnostics and its cached report-and-resolve Promise.
    report: () => iterator[asyncDisposeKey]()
  })
  return {
    next: () =>
      lifetime.advance(() =>
        runTransactionIteratorOperation(iterator, async (advance, fail) => {
          if (lifetime.isClosing()) return { done: true, value: undefined }
          try {
            return (await read(advance)) as IteratorResult<R>
          } catch (cause) {
            return failedRecordQuery(iterator, fail, cause)
          }
        })
      ),
    return: lifetime.returned,
    dispose: lifetime.dispose,
    [asyncDisposeKey]: lifetime.symbolic,
    [Symbol.asyncIterator]() {
      return this
    }
  }
}

/** Captures an immutable string projection before creating another chain node. */
function snapshotQueryFields(fields: readonly unknown[]): readonly string[] {
  if (fields.length === 0 || fields.some((field) => typeof field !== 'string'))
    throw invalidQueryCondition(undefined, StorageContractErrorText.queryArgument)
  return Object.freeze(fields as string[])
}
/** Creates selected terminals without falsely advertising another select or unsupported terminals. */
function selectedRecordQuery<
  R,
  TContext extends IOperationContext | undefined,
  TAugmentMethods extends object
>(
  source: IQuerySourceSnapshot,
  node: IQueryNode,
  strict: boolean,
  methods: TAugmentMethods | undefined
): IQueryResult<R, TContext, true, TAugmentMethods> {
  return Object.freeze({
    ...methods,
    ...familyQueryReads<R, TContext>(source, node, strict),
    requirePushdown: () =>
      selectedRecordQuery<R, TContext, TAugmentMethods>(source, node, true, methods)
  }) as IQueryResult<R, TContext, true, TAugmentMethods>
}
/** Vector rows never gain numeric record statistics through a runtime spread or projection. */
function familyQueryReads<R, TContext extends IOperationContext | undefined>(
  source: IQuerySourceSnapshot,
  node: IQueryNode | undefined,
  strict: boolean
): IQueryRead<R, TContext> | (IQueryRead<R, TContext> & IQueryStatistics<R, TContext>) {
  /** The original terminal factory remains the sole terminal execution implementation. */
  const reads = recordQueryReads<R, TContext>(source, node, strict)
  if (source.vector === undefined) return reads
  /** Only the family-inapplicable methods are omitted; every remaining function is the original. */
  const { min: _min, max: _max, sum: _sum, avg: _avg, ...vectorReads } = reads
  return vectorReads
}
/** Captures one condition node for all three families without copying chain history. */
function snapshotQueryWhere(args: readonly unknown[]): IQueryNode['step'] {
  /** Only the added node is captured; previously built condition snapshots are never revisited. */
  let step: IQueryNode['step']
  if (args.length === 1 && typeof args[0] === 'function')
    step = {
      operation: QueryOperation.predicate,
      predicate: args[0] as (row: unknown) => boolean
    }
  else if (args.length === 1)
    step = { operation: QueryOperation.where, condition: snapshotStorageWhere(args[0]) }
  else if (
    args.length === 3 &&
    (typeof args[0] === 'string' || Array.isArray(args[0])) &&
    typeof args[1] === 'string' &&
    Object.hasOwn(QueryOperator, args[1])
  ) {
    try {
      /** Typed paths use the same canonical path validator as object conditions. */
      const path = Object.freeze(parseObjectPath(args[0]).map(String))
      step = {
        operation: QueryOperation.where,
        condition: snapshotQueryField(path, args[1] as QueryOperator, args[2])
      }
    } catch (cause) {
      throw invalidQueryCondition(cause)
    }
  } else throw invalidQueryCondition()
  return step
}
/** Derivation shares history and captured source facts; each chain owns no I/O or resource lifetime. */
function recordQuery<
  T,
  TContext extends IOperationContext | undefined,
  TAugmentMethods extends object
>(
  source: IQuerySourceSnapshot,
  node: IQueryNode | undefined,
  strict: boolean,
  methods: TAugmentMethods | undefined
): IRecordQuery<T, TContext, TAugmentMethods> {
  /** Overloads are implemented through one explicit runtime argument-shape dispatcher. */
  function where(
    condition: IWhere<T> | ((row: T) => boolean)
  ): IRecordQuery<T, TContext, TAugmentMethods>
  function where<P extends IObjectPath<T>, O extends keyof IFieldOps<IObjectPathValue<T, P>>>(
    path: P,
    operator: O,
    value: IQueryOperand<IObjectPathValue<T, P>, NoInfer<O>>
  ): IRecordQuery<T, TContext, TAugmentMethods>
  function where(...args: readonly unknown[]): IRecordQuery<T, TContext, TAugmentMethods> {
    /** Family dispatch shares the canonical condition/path snapshot. */
    const step = snapshotQueryWhere(args)
    return recordQuery(source, { previous: node, step }, strict, methods)
  }
  /** Projection and callback mapping share one state transition that removes select from the result. */
  function select<const K extends Extract<keyof T, string>>(
    ...fields: readonly [K, ...K[]]
  ): IQueryResult<Pick<T, K>, TContext, true, TAugmentMethods>
  function select<N>(
    mapper: (row: T) => N
  ): IQueryResult<Awaited<N>, TContext, true, TAugmentMethods>
  function select(
    ...args: readonly unknown[]
  ): IQueryResult<unknown, TContext, true, TAugmentMethods> {
    /** A function is an opaque mapper; it is never parsed or presented as native projection. */
    const step: IQueryNode['step'] =
      args.length === 1 && typeof args[0] === 'function'
        ? { operation: QueryOperation.mapper, mapper: args[0] as (row: unknown) => unknown }
        : { operation: QueryOperation.select, fields: snapshotQueryFields(args) }
    return selectedRecordQuery(source, { previous: node, step }, strict, methods)
  }
  return Object.freeze({
    ...methods,
    /** Limit is an immutable streaming node; zero requires no candidate advance. */
    limit(count: number) {
      if (!Number.isSafeInteger(count) || count < 0)
        throw invalidQueryCondition(undefined, StorageContractErrorText.queryLimit)
      return recordQuery<T, TContext, TAugmentMethods>(
        source,
        { previous: node, step: { operation: QueryOperation.limit, count } },
        strict,
        methods
      )
    },
    /** Comparator state cannot execute until the next node supplies its bounded heap size. */
    orderByComparator(compare: (left: T, right: T) => number) {
      if (typeof compare !== 'function')
        throw invalidQueryCondition(undefined, StorageContractErrorText.queryComparatorLimit)
      return recordQuery<T, TContext, TAugmentMethods>(
        source,
        {
          previous: node,
          step: {
            operation: QueryOperation.comparator,
            compare: compare as (left: unknown, right: unknown) => number
          }
        },
        strict,
        methods
      )
    },
    where,
    select,
    ...recordQueryReads<T, TContext>(source, node, strict),
    requirePushdown: () => recordQuery<T, TContext, TAugmentMethods>(source, node, true, methods)
  }) as IRecordQuery<T, TContext, TAugmentMethods>
}
/**
 * Creates the shared record condition/projection/limit/comparator read executor from one backend
 * author callback. Native projection rows are intentionally unknown; T declares the complete
 * pre-projection row domain. Construction performs no I/O. Every all invocation plans once, passes
 * only the safe native prefix, preserves callback order and awaits the original storage iterator's
 * disposal on success or failure. The original source owns operation timing and transaction
 * lifetime.
 */
export function createRecordQuery<
  T,
  TContext extends IOperationContext | undefined = IOperationContext,
  TAugmentMethods extends object = Record<never, never>
>(
  source: IRecordQuerySource,
  methods?: TAugmentMethods
): IRecordQuery<T, TContext, TAugmentMethods> {
  /** Feature-owned pure functions are captured once and retained by reference on every branch. */
  const captured = snapshotRecordQueryMethods(methods)
  return recordQuery<T, TContext, TAugmentMethods>(
    snapshotQuerySource(source),
    undefined,
    false,
    captured
  )
}

/** Family refinements retain the same nodes, planner, readers and accepted resource operations. */
function familyQuery(
  source: IQuerySourceSnapshot,
  node: IQueryNode | undefined,
  strict: boolean,
  methods: object | undefined,
  bounded: boolean
): object {
  /** Appending one node never copies or scans the existing immutable history. */
  const append = (step: IQueryNode['step']): object =>
    familyQuery(
      source,
      { previous: node, step },
      strict,
      methods,
      bounded || step.operation === QueryOperation.topK
    )
  /** Selection terminates family refinements while retaining the same original read methods. */
  const select = (...args: readonly unknown[]): object => {
    /** Field projection and asynchronous mapping use the original one-selection transition. */
    const step: IQueryNode['step'] =
      args.length === 1 && typeof args[0] === 'function'
        ? { operation: QueryOperation.mapper, mapper: args[0] as (row: unknown) => unknown }
        : { operation: QueryOperation.select, fields: snapshotQueryFields(args) }
    return selectedRecordQuery(source, { previous: node, step }, strict, methods)
  }
  /** Common condition admission is exactly the same shape dispatcher used by records. */
  const shared = {
    ...methods,
    where: (...args: readonly unknown[]) => append(snapshotQueryWhere(args)),
    requirePushdown: () => familyQuery(source, node, true, methods, bounded)
  }
  if (source.vector !== undefined) {
    /** The captured family facts cannot be changed by later author descriptor mutation. */
    const vector = source.vector
    return Object.freeze({
      ...shared,
      minScore(score: number) {
        if (typeof score !== 'number' || !Number.isFinite(score))
          throw invalidQueryCondition(undefined, StorageContractErrorText.queryArgument)
        return append({ operation: QueryOperation.minScore, score })
      },
      withVector: () =>
        familyQuery(
          { ...source, vector: { ...vector, withVector: true } },
          node,
          strict,
          methods,
          bounded
        ),
      topK(count: number) {
        if (!Number.isSafeInteger(count) || count <= 0)
          throw invalidQueryCondition(undefined, StorageContractErrorText.queryArgument)
        return append({ operation: QueryOperation.topK, count })
      },
      ...(bounded
        ? {
            ...familyQueryReads(source, node, strict),
            select,
            ...(vector.groupBy
              ? {
                  groupBy(field: string, options: { readonly perGroup: number }) {
                    assertQueryField(field)
                    /** Only the declared per-group allocation bound is borrowed once. */
                    let perGroup: number
                    try {
                      perGroup = options.perGroup
                    } catch (cause) {
                      throw invalidQueryCondition(cause, StorageContractErrorText.queryArgument)
                    }
                    if (!Number.isSafeInteger(perGroup) || perGroup <= 0)
                      throw invalidQueryCondition(undefined, StorageContractErrorText.queryArgument)
                    return selectedRecordQuery(
                      source,
                      {
                        previous: node,
                        step: { operation: QueryOperation.groupBy, field, perGroup }
                      },
                      strict,
                      methods
                    )
                  }
                }
              : {})
          }
        : {})
    })
  }
  return Object.freeze({
    ...shared,
    ...familyQueryReads(source, node, strict),
    select,
    limit(count: number) {
      if (!Number.isSafeInteger(count) || count < 0)
        throw invalidQueryCondition(undefined, StorageContractErrorText.queryLimit)
      return append({ operation: QueryOperation.limit, count })
    },
    follow(predicate: IRdfNamedNode, target?: IRdfNamedNode) {
      /**
       * The canonical RDF owner validates both positions as ground named nodes without a codec
       * copy.
       */
      const captured = snapshotStorageRdfPattern(
        { predicate, ...(target === undefined ? {} : { subject: target }) },
        undefined
      )
      if (captured.predicate === undefined)
        throw invalidQueryCondition(undefined, StorageContractErrorText.queryArgument)
      return append({
        operation: QueryOperation.follow,
        predicate: captured.predicate!,
        ...(captured.subject === undefined ? {} : { target: captured.subject })
      })
    },
    inverse(predicate: IRdfNamedNode) {
      /** Ground predicate admission rejects request-local blank-node identities before source I/O. */
      const captured = snapshotStorageRdfPattern({ predicate }, undefined)
      if (captured.predicate === undefined)
        throw invalidQueryCondition(undefined, StorageContractErrorText.queryArgument)
      return append({ operation: QueryOperation.inverse, predicate: captured.predicate! })
    }
  })
}

/**
 * Creates a pre-topK vector builder. The backend keeps native scoring and ranking; the canonical
 * planner sends all translatable payload conditions before ranking, even across client predicates.
 * No cursor opens during construction, explanation or immutable refinement.
 */
export function createVectorQuery<
  TPayload,
  TGroupable extends boolean = false,
  TAugmentMethods extends object = Record<never, never>
>(
  source: IVectorQuerySource<TPayload, TGroupable>,
  methods?: TAugmentMethods
): IVectorQueryBuilder<TPayload, TGroupable, false, TAugmentMethods> {
  /** Original descriptor admission captures every existing support/resource field once. */
  const captured = snapshotQuerySource(source as unknown as IRecordQuerySource)
  /** Optional finite source facts are borrowed only after existing descriptor admission finishes. */
  let exact: boolean | undefined
  /** Group support is finite author metadata rather than another provider or runtime registry. */
  let groupBy: boolean | undefined
  try {
    ;({ exact, groupBy } = source)
    if (
      (exact !== undefined && typeof exact !== 'boolean') ||
      (groupBy !== undefined && typeof groupBy !== 'boolean')
    )
      throw new TypeError(StorageContractErrorText.queryArgument)
  } catch (cause) {
    throw invalidQueryCondition(cause, StorageContractErrorText.queryArgument)
  }
  return familyQuery(
    {
      ...captured,
      vector: { exact: exact === true, groupBy: groupBy === true, withVector: false }
    },
    undefined,
    false,
    snapshotRecordQueryMethods(methods, VectorQueryMethod),
    false
  ) as IVectorQueryBuilder<TPayload, TGroupable, false, TAugmentMethods>
}

/** Creates a ground RDF match using the same immutable query and original native resource owner. */
export function createRdfQuery<
  TContext extends IOperationContext | undefined = IOperationContext,
  TAugmentMethods extends object = Record<never, never>
>(
  source: IRdfQuerySource,
  pattern: Partial<IQuad>,
  methods?: TAugmentMethods
): IRdfQuery<TContext, TAugmentMethods> {
  /** Pattern terms detach once; omitting graph retains the canonical all-graphs match semantics. */
  const capturedPattern = snapshotStorageRdfPattern(pattern, undefined)
  /** Native callbacks retain their exact original author receiver and original resource key. */
  const captured = snapshotQuerySource(source as unknown as IRecordQuerySource)
  return familyQuery(
    { ...captured, rdf: { pattern: capturedPattern } },
    undefined,
    false,
    snapshotRecordQueryMethods(methods, RdfQueryMethod),
    true
  ) as IRdfQuery<TContext, TAugmentMethods>
}
