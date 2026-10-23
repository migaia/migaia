import { asCodecValue, type ICodecValue } from '@migaia/serialize/codec'
import type { IMaybe } from '@migaia/utils'
import { immutableSnapshot } from '@migaia/utils/object'
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
import type { IStorageChange } from './change-feed.js'
import { createStorageIteratorLifetime, type IStorageIterator } from './resource.js'
import { snapshotOperationContext } from './operation-context.js'
import { runTransactionIteratorOperation, deriveTransactionIterator } from './transaction.js'
import { compareStorageKeys, snapshotStorageKey } from './key.js'
import {
  encodeOrderedStorageKey,
  orderStorageKeysByBytes,
  storageKeyBytesIdentity
} from './key-order.js'
import {
  assertConcurrencyPolicy,
  type IConcurrencyPolicy,
  type IWriteConcurrencyOptions
} from './concurrency.js'
import {
  snapshotStorageRdfPattern,
  snapshotStorageRdfQuad,
  encodeRdfQuadSnapshot,
  RdfTermType,
  type IQuad,
  type IRdfNamedNode
} from './capabilities/rdf.js'

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
export function snapshotStorageWhere(where: unknown): IQueryCondition {
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

/**
 * Compiles only the canonical AST already admitted and supplied to a native source callback. Reuses
 * the same compiler without parsing, cloning or re-reading the original IWhere input. Compilation
 * failures use the existing admission error path; predicate failures stay unchanged.
 */
export function compileStorageQueryCondition<T>(condition: IQueryCondition): (value: T) => boolean {
  try {
    return compileQueryCondition<T>(condition)
  } catch (cause) {
    throw invalidQueryCondition(cause)
  }
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
/** Opaque in-process keyset cursors contain no source, store or cleanup authority. */
const queryCursorBrand: unique symbol = Symbol()
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
  groupBy: 'groupBy'
} as const)
/** RDF Feature admission reserves traversal methods before returning any native source. */
export const RdfQueryMethod = Object.freeze({
  ...RecordQueryMethod,
  follow: 'follow',
  inverse: 'inverse',
  replace: 'replace'
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
/** The existing record execute shape is also used verbatim by its native reduction port. */
export type IRecordQueryInput = {
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
  readonly ctx: IOperationContext | undefined
}
/** Backend vector engines own scoring, organization/TTL filtering and score/id ranking. */
export type IVectorQuerySource<TPayload, TGroupable extends boolean = false> = {
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
/** Nodes retain only their immediate predecessor, so deriving a branch never copies its history. */
type IQueryNode = {
  readonly previous: IQueryNode | undefined
  readonly step:
    | { readonly operation: typeof QueryOperation.limit; readonly count: number }
    | { readonly operation: typeof QueryOperation.skip; readonly count: number }
    | { readonly operation: typeof QueryOperation.distinct; readonly field: string }
    | {
        readonly operation: typeof QueryOperation.order
        readonly selector: (row: unknown) => IStorageKey
        readonly direction: 'asc' | 'desc'
      }
    | {
        readonly operation: typeof QueryOperation.order
        readonly by: 'key'
        readonly direction: 'asc' | 'desc'
      }
    | { readonly operation: typeof QueryOperation.after; readonly cursor: IQueryCursorSnapshot }
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
  readonly reduce: IRecordQuerySource['reduce']
  readonly mutate: IRecordQuerySource['mutate']
  readonly watch: IRecordQuerySource['watch']
  readonly receiver: object
  readonly nativeSteps: boolean
  readonly cursorSource: object
  readonly vector?: {
    readonly withVector: boolean
    readonly exact: boolean
    readonly groupBy: boolean
  }
  readonly rdf?: { readonly pattern: Readonly<Partial<IQuad>>; readonly condition: IQueryCondition }
}
/** Canonical key directions apply only to explicit comparator tie resolution. */
const QueryKeyDirection = { next: 'next', prev: 'prev' } as const
/** Selector direction is shared by admission and byte reversal without a second ordering domain. */
const QueryOrderDirection = { asc: 'asc', desc: 'desc' } as const
/** Pure chain shape controls which mutually exclusive ordering refinement remains available. */
const QueryOrderMode = { selector: 'selector', comparator: QueryOperation.comparator } as const
/** Native primary-key ordering has no JavaScript selector to serialize or interpret. */
const QueryOrderField = { key: 'key' } as const
/** Detached cursor data and a Boolean identity check never return an underlying source object. */
type IQueryCursorSnapshot = {
  readonly key: IStorageKey
  readonly bytes: Uint8Array
  readonly row?: unknown
  readonly matches: (
    source: IQuerySourceSnapshot,
    steps: readonly IQueryNode['step'][],
    orgId: string | undefined
  ) => boolean
}
/** Planning retains the actual nodes so native and client execution cannot diverge from explain. */
type IRecordExecutionPlan = {
  readonly explanation: IQueryPlan
  readonly pushed: readonly IQueryNode['step'][]
  readonly client: readonly IQueryNode['step'][]
  readonly signature: readonly IQueryNode['step'][]
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
    /** Extended native controls are never inferred from legacy support arrays alone. */
    const nativeSteps = source.nativeSteps
    if (nativeSteps !== undefined && nativeSteps !== true)
      throw new TypeError(StorageContractErrorText.queryArgument)
    /** Source identity is captured once and is used only for Boolean cursor compatibility checks. */
    const cursorSource = source.cursorSource
    if (
      cursorSource !== undefined &&
      (cursorSource === null ||
        (typeof cursorSource !== 'object' && typeof cursorSource !== 'function'))
    )
      throw new TypeError(StorageContractErrorText.queryArgument)
    /** Optional native terminal support captures one callable rather than inferring another runner. */
    const reduce = source.reduce
    if (reduce !== undefined && typeof reduce !== 'function')
      throw new TypeError(StorageContractErrorText.queryArgument)
    /** One captured author callback retains original pipeline and native transaction authority. */
    const mutate = source.mutate
    if (mutate !== undefined && typeof mutate !== 'function')
      throw new TypeError(StorageContractErrorText.queryArgument)
    /** A declared native watcher supplies its own original subscription resource and timing owner. */
    const watch = source.watch
    if (watch !== undefined && typeof watch !== 'function')
      throw new TypeError(StorageContractErrorText.queryArgument)
    return {
      receiver: source,
      execute,
      reduce,
      mutate,
      watch,
      pushdown: capturedPushdown,
      tieBreakByKey,
      nativeSteps: nativeSteps === true,
      cursorSource: cursorSource ?? source,
      asyncDisposeKey: configuredAsyncDisposeKey ?? Symbol.asyncDispose
    }
  } catch (cause) {
    throw invalidQueryCondition(cause, StorageContractErrorText.queryArgument)
  }
}
/** Canonical condition identity preserves Date values, operand order and opaque object identity. */
function sameQueryCondition(left: IQueryCondition, right: IQueryCondition): boolean {
  if (left.kind !== right.kind) return false
  if (left.kind === QueryConditionKind.field) {
    /** Both operands are already captured by the sole shared condition admission owner. */
    const other = right as typeof left
    if (
      left.operator !== other.operator ||
      left.path.length !== other.path.length ||
      !left.path.every((part, index) => part === other.path[index])
    )
      return false
    if (left.operator === QueryOperator.in || left.operator === QueryOperator.between) {
      /** List containers have no identity semantics; each captured member retains its own domain. */
      const values = left.value as readonly IQueryOperandValue[]
      /** Matching operators guarantee the same admitted list shape. */
      const others = other.value as readonly IQueryOperandValue[]
      return (
        values.length === others.length &&
        values.every((value, index) => queryEqual(value, others[index]))
      )
    }
    return queryEqual(left.value, other.value)
  }
  if (left.kind === QueryConditionKind.not)
    return sameQueryCondition(left.condition, (right as typeof left).condition)
  /** Boolean child order remains observable through short-circuit field reads. */
  const other = right as typeof left
  return (
    left.conditions.length === other.conditions.length &&
    left.conditions.every((condition, index) =>
      sameQueryCondition(condition, other.conditions[index]!)
    )
  )
}
/** Page size, output projection and explicit offsets are not condition or ordering identity. */
function queryCursorStep(step: IQueryNode['step']): boolean {
  return (
    step.operation !== QueryOperation.after &&
    step.operation !== QueryOperation.limit &&
    step.operation !== QueryOperation.skip &&
    step.operation !== QueryOperation.select &&
    step.operation !== QueryOperation.mapper
  )
}
/** Compares only finite canonical query nodes; no callback parsing, hashing or serialization occurs. */
function sameQueryCursorStep(left: IQueryNode['step'], right: IQueryNode['step']): boolean {
  if (left.operation !== right.operation) return false
  switch (left.operation) {
    case QueryOperation.where:
      return sameQueryCondition(left.condition, (right as typeof left).condition)
    case QueryOperation.predicate:
      return left.predicate === (right as typeof left).predicate
    case QueryOperation.comparator:
      return left.compare === (right as typeof left).compare
    case QueryOperation.order:
      return (
        left.direction === (right as typeof left).direction &&
        Reflect.get(left, 'selector') === Reflect.get(right, 'selector')
      )
    case QueryOperation.distinct:
      return left.field === (right as typeof left).field
    case QueryOperation.follow:
    case QueryOperation.inverse:
      return (
        left.predicate.value === (right as typeof left).predicate.value &&
        left.target?.value === (right as typeof left).target?.value
      )
    default:
      return false
  }
}
/** Private fields authenticate only owner-created cursors; reflected properties carry no authority. */
class QueryCursor implements IQueryCursor {
  /** The public type brand contains no data or executable admission callback. */
  readonly [queryCursorBrand] = true as const
  /** Detached ordering facts remain inaccessible even when consumers reflect own properties. */
  #snapshot: IQueryCursorSnapshot
  /** Composite-key metadata remains owned with the snapshot so each refinement gets a fresh copy. */
  #order: NonNullable<IRecordQuerySource['tieBreakByKey']>
  /** Only the query owner creates a cursor after its original reader supplies a page anchor. */
  constructor(
    snapshot: IQueryCursorSnapshot,
    order: NonNullable<IRecordQuerySource['tieBreakByKey']>
  ) {
    this.#snapshot = snapshot
    this.#order = order
    // A cursor exposes no constructor or factory through its prototype.
    Object.setPrototypeOf(this, null)
    Object.freeze(this)
  }
  /** Rejects forged objects without reading their properties or invoking unknown functions. */
  static snapshot(cursor: IQueryCursor): IQueryCursorSnapshot {
    if (typeof cursor !== 'object' || cursor === null || !(#snapshot in cursor))
      throw new TypeError(StorageContractErrorText.queryArgument)
    /** All state comes from this private owner rather than a structurally supplied cursor. */
    const value = cursor.#snapshot
    return {
      key: snapshotQuerySourceKey(value.key, cursor.#order),
      bytes: value.bytes.slice(),
      ...('row' in value ? { row: immutableSnapshot(value.row) } : {}),
      matches: value.matches
    }
  }
}
/** Admits an owner-created read-only cursor and captures only detached data before source I/O. */
function snapshotQueryCursor(cursor: IQueryCursor): IQueryCursorSnapshot {
  try {
    return QueryCursor.snapshot(cursor)
  } catch (cause) {
    throw invalidQueryCondition(cause, StorageContractErrorText.queryArgument)
  }
}
/** Creates an immutable keyset value whose hidden snapshot factory never exposes mutable state. */
function createQueryCursor(
  source: IQuerySourceSnapshot,
  steps: readonly IQueryNode['step'][],
  row: Awaited<ReturnType<IQueryReader>>,
  orgId: string | undefined
): IQueryCursor {
  /** Cursor scope is data identity only; no base, registration or cleanup handle is returned. */
  const identity = source.cursorSource
  /** Original source metadata and condition/order nodes define exact execution compatibility. */
  const signature = steps.filter(queryCursorStep)
  /** Only opaque comparator ordering needs a detached row rather than captured scalar sort bytes. */
  const comparator = signature.find((step) => step.operation === QueryOperation.comparator)
  /** Snapshot before returning page items so user mutation cannot move a saved comparator anchor. */
  const anchor = comparator === undefined ? undefined : immutableSnapshot(row.anchor)
  /** Original key and encoded tuple are private owned snapshots, never handles into the backend. */
  const key = row.key!
  /** The encoded primary tail follows the existing source direction. */
  const bytes = queryOrderingBytes([...(row.ordering ?? []), row.keyBytes!])
  /** Compatibility returns only a Boolean and never the captured source identity itself. */
  const matches: IQueryCursorSnapshot['matches'] = (candidate, candidateSteps, candidateOrg) => {
    if (
      candidate.cursorSource !== identity ||
      candidateOrg !== orgId ||
      candidate.pushdown.source !== source.pushdown.source ||
      candidate.pushdown.index !== source.pushdown.index ||
      candidate.tieBreakByKey?.direction !== source.tieBreakByKey?.direction ||
      candidate.tieBreakByKey?.parts !== source.tieBreakByKey?.parts
    )
      return false
    if (
      (candidate.rdf === undefined) !== (source.rdf === undefined) ||
      (candidate.rdf !== undefined &&
        source.rdf !== undefined &&
        !sameQueryCondition(candidate.rdf.condition, source.rdf.condition))
    )
      return false
    /** Candidate projection/page controls can change while the same condition/order remains. */
    const relevant = candidateSteps.filter(queryCursorStep)
    return (
      relevant.length === signature.length &&
      signature.every((step, index) => sameQueryCursorStep(step, relevant[index]!))
    )
  }
  return new QueryCursor(
    {
      key,
      bytes,
      ...(comparator === undefined ? {} : { row: anchor }),
      matches
    },
    source.tieBreakByKey ?? { direction: QueryKeyDirection.next }
  )
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
  countOnly: boolean | typeof QueryOperation.aggregate = false,
  pageSize?: number
): IRecordExecutionPlan {
  /** One reverse traversal avoids repeated prefix allocation during fluent construction. */
  let steps: IQueryNode['step'][] = []
  for (let current = node; current !== undefined; current = current.previous)
    steps.push(current.step)
  steps.reverse()
  /** Fingerprints exclude execution-only bounds and never allocate a persistent cursor registry. */
  const signature = Object.freeze([...steps])
  /** New keyset executions keep row selection before per-page bounds in this same plan. */
  const after: IQueryNode['step'][] = []
  /** One linear partition never shifts an already retained tail for each removed node. */
  const body: IQueryNode['step'][] = []
  for (const step of steps) (step.operation === QueryOperation.after ? after : body).push(step)
  if (pageSize !== undefined || after.length > 0) {
    /** Opaque comparison can seek before its original bounded heap without unbounded radix sorting. */
    if (body.some((step) => step.operation === QueryOperation.comparator)) {
      steps = []
      /** The supported comparator state has one ordering stage and its adjacent explicit bound. */
      let inserted = false
      for (const step of body) {
        if (!inserted && step.operation === QueryOperation.comparator) {
          for (const anchor of after) steps.push(anchor)
          inserted = true
        }
        steps.push(step)
      }
    } else {
      /** Each original node is copied once into selection, page-bound or output partitions. */
      const rows: IQueryNode['step'][] = []
      /** Keyset limit and skip apply after the complete condition/order/distinct result. */
      const bounds: IQueryNode['step'][] = []
      /** Output callbacks observe only accepted keyset rows. */
      const output: IQueryNode['step'][] = []
      for (const step of body)
        (step.operation === QueryOperation.limit || step.operation === QueryOperation.skip
          ? bounds
          : step.operation === QueryOperation.mapper
            ? output
            : rows
        ).push(step)
      steps = [...rows, ...after, ...bounds, ...output]
      /** Default primary-key order is needed only without either explicit ordering family. */
      if (!rows.some((step) => step.operation === QueryOperation.order))
        steps.unshift({
          operation: QueryOperation.order,
          by: QueryOrderField.key,
          direction:
            source.tieBreakByKey?.direction === QueryKeyDirection.prev
              ? QueryOrderDirection.desc
              : QueryOrderDirection.asc
        })
    }
  }
  if (pageSize !== undefined) {
    /** Lookahead precedes output mapping, so only returned rows run an asynchronous user mapper. */
    const projection = steps.findIndex((step) => step.operation === QueryOperation.mapper)
    steps.splice(projection < 0 ? steps.length : projection, 0, {
      operation: QueryOperation.limit,
      count: Math.min(pageSize + 1, Number.MAX_SAFE_INTEGER)
    })
  }
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
  /** Count drops only selector ordering that cannot change a later row-selection result. */
  const countOrders = countOnly ? new Set<IQueryNode['step']>() : undefined
  /** A keyset bound observes its actual ordering keys even when the terminal only counts rows. */
  const hasAfter = steps.some((step) => step.operation === QueryOperation.after)
  if (countOrders !== undefined) {
    /** A later value-sensitive step observes which row a bound or distinct operation retained. */
    let observesIdentity = countOnly === QueryOperation.aggregate
    /** Once selection can affect cardinality, preceding selector orders must remain in the reader. */
    let selectionMatters = false
    for (let index = steps.length - 1; index >= 0; index--) {
      /** Reverse planning inspects each immutable operation once without running any callback. */
      const step = steps[index]!
      if (step.operation === QueryOperation.order && (selectionMatters || hasAfter))
        countOrders.add(step)
      /** Numeric output callbacks can depend on prior row order even without a finite bound. */
      if (
        countOnly === QueryOperation.aggregate &&
        (step.operation === QueryOperation.mapper || step.operation === QueryOperation.predicate)
      )
        selectionMatters = true
      if (
        observesIdentity &&
        (step.operation === QueryOperation.limit ||
          step.operation === QueryOperation.skip ||
          step.operation === QueryOperation.distinct)
      )
        selectionMatters = true
      if (
        step.operation === QueryOperation.where ||
        step.operation === QueryOperation.predicate ||
        step.operation === QueryOperation.distinct ||
        step.operation === QueryOperation.follow ||
        step.operation === QueryOperation.inverse
      )
        observesIdentity = true
    }
  }
  for (const step of steps) {
    /** Cardinality keeps conditions and page controls without evaluating output-only callbacks. */
    if (
      countOnly &&
      ((step.operation === QueryOperation.comparator && countOnly === true && !hasAfter) ||
        (step.operation === QueryOperation.order && !countOrders!.has(step)) ||
        (countOnly === true &&
          (step.operation === QueryOperation.select || step.operation === QueryOperation.mapper)))
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
            (step.operation === QueryOperation.order && 'selector' in step) ||
            step.operation === QueryOperation.groupBy
          ? source.vector !== undefined && step.operation === QueryOperation.predicate
            ? StorageContractErrorText.queryVectorFunction
            : StorageContractErrorText.queryFunction
          : (!source.nativeSteps &&
                (step.operation === QueryOperation.limit ||
                  step.operation === QueryOperation.skip ||
                  step.operation === QueryOperation.distinct ||
                  step.operation === QueryOperation.order ||
                  step.operation === QueryOperation.after)) ||
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
          ...(step.operation === QueryOperation.skip
            ? { reason: StorageContractErrorText.querySkip }
            : {}),
          ...(source.pushdown.index === undefined ? {} : { index: source.pushdown.index })
        })
      )
    } else {
      client.push(step)
      clientSteps.push(
        Object.freeze({
          operation: step.operation,
          reason:
            step.operation === QueryOperation.skip ? StorageContractErrorText.querySkip : reason
        })
      )
    }
  }
  return {
    pushed,
    client,
    signature,
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
  advance: IQueryAdvance,
  currentScope?: object
) => Promise<
  IteratorResult<unknown> & {
    readonly key?: IStorageKey
    readonly keyBytes?: Uint8Array
    readonly ordering?: readonly Uint8Array[]
    readonly anchor?: unknown
  }
>
/** Compiled traversal nodes borrow cleanup callbacks, without another resource lifetime or registry. */
type ICompiledQueryReader = {
  readonly read: IQueryReader
  readonly close: (() => Promise<void>) | undefined
  readonly report: (() => Promise<void>) | undefined
}
/**
 * Attempts later-created source cleanup first and retains both failures through the same error
 * owner.
 */
function completeQueryCleanup(
  first: (() => Promise<void>) | undefined,
  second: () => Promise<void>
): Promise<void> {
  if (first === undefined) return second()
  return (async () => {
    /** Only actual source cleanup failures are retained, in disposal order. */
    let failure: Error | undefined
    try {
      await first()
    } catch (cause) {
      failure = queryExecutionFailure(cause)
    }
    try {
      await second()
    } catch (cause) {
      if (failure === undefined) throw cause
      throw attachSecondaryErrors(failure, [queryExecutionFailure(cause)])
    }
    if (failure !== undefined) throw failure
  })()
}
/** Stable candidate order resolves comparator ties without retaining discarded source rows. */
type IQueryHeapEntry = {
  readonly value: unknown
  readonly position: number
  readonly key?: IStorageKey
  readonly keyBytes?: Uint8Array
  readonly ordering?: readonly Uint8Array[]
  readonly anchor?: unknown
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
/** Concatenates complete self-delimiting canonical keys without another encoding domain. */
function queryOrderingBytes(parts: readonly Uint8Array[]): Uint8Array {
  /** Every complete encoded component contributes its actual byte length once. */
  let length = 0
  for (const part of parts) length += part.length
  /** Only this query candidate owns the combined ordering bytes. */
  const bytes = new Uint8Array(length)
  /** The write position advances through complete canonical components. */
  let position = 0
  for (const part of parts) {
    bytes.set(part, position)
    position += part.length
  }
  return bytes
}
/** Reverses a detached complete key's byte order without changing canonical encoding itself. */
function queryDescendingBytes(bytes: Uint8Array): Uint8Array {
  for (let index = 0; index < bytes.length; index++) bytes[index] = 255 - bytes[index]!
  return bytes
}
/** Selector callbacks stay opaque and borrow the canonical key snapshot/byte encoder exactly once. */
function snapshotQueryOrder(
  selector: unknown,
  direction: unknown
): Extract<IQueryNode['step'], { readonly operation: typeof QueryOperation.order }> {
  if (
    typeof selector !== 'function' ||
    (direction !== undefined &&
      direction !== QueryOrderDirection.asc &&
      direction !== QueryOrderDirection.desc)
  )
    throw invalidQueryCondition(undefined, StorageContractErrorText.queryArgument)
  return {
    operation: QueryOperation.order,
    selector: selector as (row: unknown) => IStorageKey,
    direction: direction ?? QueryOrderDirection.asc
  }
}
/** Compiles the existing client plan once; comparator buffering is bounded by its explicit limit. */
function compileRecordQueryReader(
  steps: readonly IQueryNode['step'][],
  ctx: IOperationContext | undefined,
  tieBreakByKey: IRecordQuerySource['tieBreakByKey'],
  vector = false,
  metadata = false,
  comparator?: (left: unknown, right: unknown) => number,
  source?: IQuerySourceSnapshot
): ICompiledQueryReader {
  /** Only active original traversal cursors contribute borrowed close/report callbacks. */
  let close: ICompiledQueryReader['close']
  /** Symbolic cleanup delegates diagnostics to those same original source owners. */
  let report: ICompiledQueryReader['report']
  /**
   * New selector ordering needs the same original primary-key tail even without comparator
   * metadata.
   */
  const selectorOrdering = steps.some((step) => step.operation === QueryOperation.order)
  /** Existing comparator-only and ordinary reads keep their original key-admission path. */
  const retainKeys =
    metadata ||
    selectorOrdering ||
    tieBreakByKey !== undefined ||
    steps.some((step) => step.operation === QueryOperation.after)
  /** Encoded tuples are prepared once per candidate, never rediscovered by scanning the plan. */
  const encodeKeys =
    selectorOrdering || metadata || steps.some((step) => step.operation === QueryOperation.after)
  /** Initial and traversal rows share one canonical key snapshot/encoding path. */
  const captureRow = (row: readonly [IStorageKey, unknown]): Awaited<ReturnType<IQueryReader>> => {
    if (!retainKeys) return { done: false, value: row[1] }
    /** Retained keys detach before projected value access can mutate any borrowed source objects. */
    const key =
      tieBreakByKey === undefined
        ? snapshotStorageKey(row[0], undefined)
        : snapshotQuerySourceKey(row[0], tieBreakByKey)
    if (!encodeKeys) return { done: false, value: row[1], key }
    /** Author-only key parts retain their independent logical budgets when making a sort tail. */
    const encoded =
      tieBreakByKey?.parts === true
        ? queryOrderingBytes(
            (key as readonly IStorageKey[]).map((part) => encodeOrderedStorageKey(part, undefined))
          )
        : encodeOrderedStorageKey(key, undefined)
    return {
      done: false,
      value: row[1],
      anchor: row[1],
      key,
      keyBytes:
        tieBreakByKey?.direction === QueryKeyDirection.prev
          ? queryDescendingBytes(encoded)
          : encoded
    }
  }
  /** The leaf borrows the one original backend cursor; no row array is materialized. */
  let read: IQueryReader = async (advance) => {
    assertQueryActive(ctx)
    /** Native next settles before any client node or cleanup starts. */
    const next = await advance()
    assertQueryActive(ctx)
    return next.done ? { done: true, value: undefined } : captureRow(next.value)
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
      read = async (advance, currentScope) => {
        while (true) {
          /** Filtering discards each rejected row immediately. */
          const next = await upstream(advance, currentScope)
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
      read = async (advance, currentScope) => {
        /** Projection consumes exactly one accepted upstream row. */
        const next = await upstream(advance, currentScope)
        if (next.done) return next
        if (step.operation === QueryOperation.mapper) {
          /** Awaited mapping remains part of the original accepted read. */
          const value = await step.mapper(next.value)
          assertQueryActive(ctx)
          return !retainKeys ? { done: false, value } : { ...next, value }
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
        return !retainKeys ? { done: false, value } : { ...next, value }
      }
    } else if (
      step.operation === QueryOperation.follow ||
      step.operation === QueryOperation.inverse
    ) {
      if (source?.rdf === undefined)
        throw invalidQueryCondition(undefined, StorageContractErrorText.queryArgument)
      /** One active child cursor is borrowed until exhausted or the containing query closes. */
      let current: IStorageIterator<readonly [IStorageKey, unknown]> | undefined
      /** Later traversal stages close before the upstream stages that produced their rows. */
      const upstreamClose = close
      /** Each native source retains its own separately cached symbolic diagnostics. */
      const upstreamReport = report
      close = () =>
        completeQueryCleanup(
          current === undefined ? undefined : () => current!.dispose(),
          upstreamClose ?? (() => Promise.resolve())
        )
      report = () =>
        completeQueryCleanup(
          current === undefined ? undefined : () => current![source.asyncDisposeKey!](),
          upstreamReport ?? (() => Promise.resolve())
        )
      /** Concurrent accepted pulls share one lazy predecessor lookup, without a queue or scheduler. */
      let opening: Promise<void> | undefined
      /** Upstream EOF is a query-reader fact, not an additional resource lifecycle. */
      let exhausted = false
      /** Immutable narrowed plan facts remain precise inside the lazy match callback. */
      const traversal = step
      /** The original source was admitted as an RDF native match provider. */
      const rdfSource = source
      /**
       * Opens at most one child for the next eligible predecessor and captures no view beyond this
       * pull.
       */
      async function openMatch(
        advance: IQueryAdvance,
        currentScope: object | undefined
      ): Promise<void> {
        while (true) {
          const next = await upstream(advance, currentScope)
          if (next.done) {
            exhausted = true
            return
          }
          /** Canonical quad positions are read once before another match can start. */
          const { subject, object, graph } = next.value as IQuad
          assertQueryActive(ctx)
          if (
            traversal.operation === QueryOperation.follow &&
            object.termType !== RdfTermType.namedNode
          )
            continue
          /**
           * The original RDF snapshot owner validates each ground pattern without another term
           * codec.
           */
          const pattern = snapshotStorageRdfPattern(
            {
              predicate: traversal.predicate,
              graph,
              ...(traversal.operation === QueryOperation.follow
                ? {
                    subject: object as IRdfNamedNode,
                    ...(traversal.target === undefined ? {} : { object: traversal.target })
                  }
                : { object: subject })
            },
            undefined
          )
          assertQueryActive(ctx)
          current = Reflect.apply(rdfSource.execute, rdfSource.receiver, [
            {
              pattern,
              steps: [],
              ctx,
              ...(currentScope === undefined ? {} : { operationScope: currentScope })
            }
          ])
          return
        }
      }
      read = async (advance, currentScope) => {
        while (true) {
          if (current === undefined) {
            if (exhausted) return { done: true, value: undefined }
            await (opening ??= openMatch(advance, currentScope).finally(() => {
              opening = undefined
            }))
            continue
          }
          /** A settled concurrent EOF cannot close a different later-created child cursor. */
          const child = current
          const next = await runTransactionIteratorOperation(child, (next) => next(), currentScope)
          assertQueryActive(ctx)
          if (!next.done) return captureRow(next.value)
          await child.dispose()
          if (current === child) current = undefined
        }
      }
    } else if (step.operation === QueryOperation.after) {
      read = async (advance, currentScope) => {
        while (true) {
          /** Keyset filtering seeks by the original full ordering tuple, never an offset counter. */
          const next = await upstream(advance, currentScope)
          if (next.done) return next
          /**
           * Comparator callbacks remain opaque; their anchor was detached before page items
           * escaped.
           */
          const rank = comparator === undefined ? 0 : comparator(next.anchor, step.cursor.row)
          /** Canonical bytes include the source primary-key tail and every selector direction. */
          const bytes = queryOrderingBytes([...(next.ordering ?? []), next.keyBytes!])
          if (
            rank > 0 ||
            (!rank &&
              compareStorageKeys(
                bytes.buffer as ArrayBuffer,
                step.cursor.bytes.buffer as ArrayBuffer
              ) > 0)
          )
            return next
          assertQueryActive(ctx)
        }
      }
    } else if (step.operation === QueryOperation.skip) {
      /** Offset reads advance only through the original cursor; no skipped result is retained. */
      let remaining = step.count
      read = async (advance, currentScope) => {
        while (remaining > 0) {
          remaining--
          /** EOF stops skipping immediately rather than repeatedly touching an exhausted source. */
          const next = await upstream(advance, currentScope)
          if (next.done) return next
        }
        return upstream(advance, currentScope)
      }
    } else if (step.operation === QueryOperation.distinct) {
      /**
       * SameValueZero keeps primitive domains and opaque object identity without deep
       * serialization.
       */
      const seen = new Set<unknown>()
      read = async (advance, currentScope) => {
        while (true) {
          /** Only accepted distinct values survive downstream bounds and projections. */
          const next = await upstream(advance, currentScope)
          if (next.done) return next
          /**
           * Each candidate's selected field is read once; missing and present undefined share a
           * value.
           */
          const value = next.value == null ? undefined : Reflect.get(Object(next.value), step.field)
          if (!seen.has(value)) {
            seen.add(value)
            return next
          }
        }
      }
    } else if (step.operation === QueryOperation.order) {
      /** Consecutive refinements form one lexicographic key and one canonical radix pass. */
      const selectors = [step]
      while (steps[index + 1]?.operation === QueryOperation.order)
        selectors.push(steps[++index] as typeof step)
      /** Ordering retains source keys only internally; public rows and iterator results omit them. */
      type IOrderedEntry = {
        readonly value: unknown
        readonly key: IStorageKey
        readonly keyBytes: Uint8Array
        readonly ordering: readonly Uint8Array[]
        readonly bytes: Uint8Array
        readonly anchor: unknown
      }
      /**
       * The same accepted initialization is shared by concurrent reads through the original
       * lifetime.
       */
      let prepared: Promise<void> | undefined
      /** Native or earlier client filtering determines the actual candidates in this radix pass. */
      let ordered: readonly IOrderedEntry[] = []
      /** Emission advances through the one ordered result without rerunning selectors. */
      let emitted = 0
      read = async (advance, currentScope) => {
        await (prepared ??= (async () => {
          /**
           * Retained rows are required by this unbounded selector order, never by scalar
           * reductions.
           */
          const entries: IOrderedEntry[] = []
          while (true) {
            /** Each native row enters this ordering stage once. */
            const next = await upstream(advance, currentScope)
            if (next.done) break
            /** Prior selector stages retain their original keys across filters and bounds. */
            const ordering = [...(next.ordering ?? [])]
            for (const order of selectors) {
              if (!('selector' in order)) continue
              /**
               * Invoke the user's opaque selector once, before any later selector can mutate its
               * key.
               */
              const selector = order.selector
              /** Canonical snapshot/encoding owns all supported key domain validation and ordering. */
              const encoded = encodeOrderedStorageKey(selector(next.value), undefined)
              ordering.push(
                order.direction === QueryOrderDirection.desc
                  ? queryDescendingBytes(encoded)
                  : encoded
              )
            }
            entries.push({
              value: next.value,
              anchor: next.anchor,
              key: next.key!,
              keyBytes: next.keyBytes!,
              ordering,
              bytes: queryOrderingBytes([...ordering, next.keyBytes!])
            })
            assertQueryActive(ctx)
          }
          ordered = orderStorageKeysByBytes(entries, (entry) => entry.bytes)
        })())
        if (emitted === ordered.length) return { done: true, value: undefined }
        /** Selector/primary-key metadata remains inside the existing compiled reader. */
        const entry = ordered[emitted++]!
        return {
          done: false,
          value: entry.value,
          anchor: entry.anchor,
          key: entry.key,
          keyBytes: entry.keyBytes,
          ordering: entry.ordering
        }
      }
    } else if (step.operation === QueryOperation.limit) {
      /** Admission reserves one remaining position before awaiting the upstream read. */
      let remaining = step.count
      read = async (advance, currentScope) =>
        remaining-- > 0 ? upstream(advance, currentScope) : { done: true, value: undefined }
    } else if (step.operation === QueryOperation.groupBy) {
      /** At most the already ranked topK hits enter this single grouping pass. */
      let groups:
        | readonly { readonly group: unknown; readonly hits: readonly unknown[] }[]
        | undefined
      /** One initialization belongs to the same original accepted reader operation. */
      let prepared: Promise<void> | undefined
      /** Emission preserves each group's first best-hit position. */
      let emitted = 0
      read = async (advance, currentScope) => {
        await (prepared ??= (async () => {
          /** Map uses SameValueZero, preserving number/string/boolean domains and equal zeroes. */
          const grouped = new Map<string | number | boolean, unknown[]>()
          while (true) {
            /** No candidate outside the original engine topK is requested or scored. */
            const next = await upstream(advance, currentScope)
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
        const keyOrder = !retainKeys ? 0 : compareStorageKeys(left.key!, right.key!)
        return (
          (tieBreakByKey?.direction === QueryKeyDirection.prev ? -keyOrder : keyOrder) ||
          left.position - right.position
        )
      }
      /** Scans each upstream candidate once and sorts only the retained bounded heap. */
      async function prepare(advance: IQueryAdvance, currentScope?: object): Promise<void> {
        if (bound.count === 0) return
        /** Source order is stable even when equal candidates arrive far apart. */
        let position = 0
        while (true) {
          /** Discarded rows become unreachable after this iteration. */
          const next = await upstream(advance, currentScope)
          if (next.done) break
          /** Only this candidate and the retained heap are live during selection. */
          const entry: IQueryHeapEntry = !retainKeys
            ? { value: next.value, position: position++ }
            : {
                value: next.value,
                position: position++,
                key: next.key,
                keyBytes: next.keyBytes,
                ordering: next.ordering,
                anchor: next.anchor
              }
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
      read = async (advance, currentScope) => {
        await (prepared ??= prepare(advance, currentScope))
        if (emitted >= heap.length) return { done: true, value: undefined }
        /** A bounded winner keeps its key available to later compiled reader nodes. */
        const entry = heap[emitted++]!
        return !retainKeys
          ? { done: false, value: entry.value }
          : {
              done: false,
              value: entry.value,
              key: entry.key,
              keyBytes: entry.keyBytes,
              ordering: entry.ordering,
              anchor: entry.anchor
            }
      }
    } else {
      throw invalidQueryCondition(undefined, StorageContractErrorText.queryArgument)
    }
  }
  /** Every terminal transition observes cancellation, including a final projection or zero limit. */
  return {
    close,
    report,
    read: async (advance, currentScope) => {
      assertQueryActive(ctx)
      /** The compiled node chain retains no operation view beyond this accepted read. */
      const next = await read(advance, currentScope)
      assertQueryActive(ctx)
      return metadata || !retainKeys || next.done ? next : { done: false, value: next.value }
    }
  }
}
/** Admission remains pure and runs once before either a read cursor or a write owner can open. */
function prepareQueryExecution(
  source: IQuerySourceSnapshot,
  plan: IRecordExecutionPlan,
  strict: boolean,
  ctx: IOperationContext | undefined
): IOperationContext | undefined {
  /** Cursor mismatch rejects before native I/O without changing existing no-cursor getter order. */
  const after = [...plan.pushed, ...plan.client].filter(
    (step) => step.operation === QueryOperation.after
  )
  /** Only cursor scope validation needs the captured organization before strictness admission. */
  let captured = after.length === 0 ? undefined : snapshotOperationContext(ctx)
  for (const step of after)
    if (!step.cursor.matches(source, plan.signature, captured?.orgId))
      throw invalidQueryCondition(undefined, StorageContractErrorText.queryArgument)
  /** Ranking and traversal cannot be emulated by the ordinary row reader. */
  const requiredNative = plan.client.filter(
    (step) => step.operation === QueryOperation.topK || step.operation === QueryOperation.minScore
  )
  if ((strict && plan.client.length > 0) || requiredNative.length > 0)
    throw new StorageContractError(
      StorageContractErrorCode.queryNotPushable,
      {},
      StorageContractErrorText.queryNotPushable(plan.explanation.client.map((step) => step.reason!))
    )
  /** Captured intent is shared by the source and every client node. */
  if (after.length === 0) captured = snapshotOperationContext(ctx)
  assertQueryActive(captured)
  return captured
}
/** A write reuses this plan and captured context inside the original transaction callback. */
type IPreparedQueryExecution = {
  readonly plan: IRecordExecutionPlan
  readonly ctx: IOperationContext | undefined
}

/** Plans once and opens only the original native prefix; terminal adapters share this execution. */
function nativeQuerySteps(
  source: IQuerySourceSnapshot,
  steps: readonly IQueryNode['step'][]
): readonly (IQueryNativeStep | IRdfQueryTraversal)[] {
  return Object.freeze(
    steps.map((step) => {
      if (step.operation === QueryOperation.after)
        return Object.freeze({
          operation: QueryOperation.after,
          key: snapshotQuerySourceKey(
            step.cursor.key,
            source.tieBreakByKey ?? { direction: QueryKeyDirection.next }
          ),
          direction: source.tieBreakByKey?.direction ?? QueryKeyDirection.next
        })
      return Object.freeze({ ...step }) as IQueryNativeStep | IRdfQueryTraversal
    })
  )
}
/** A terminal's already compiled native plan is consumed by the original resource runner. */
type INativeQueryReduction = {
  readonly request: IQueryReduction
  readonly plan: IRecordExecutionPlan
}
/** One native input compiler serves original read, mutation and subscription callbacks. */
function querySourceInput(
  source: IQuerySourceSnapshot,
  plan: IRecordExecutionPlan,
  captured: IOperationContext | undefined
): IVectorQueryInput | IRdfQueryInput | IRecordQueryInput {
  /** Conditions retain the original safe-prefix AST without resnapshotting or another parser. */
  const conditions = Object.freeze(
    plan.pushed.flatMap((step) => (step.operation === QueryOperation.where ? [step.condition] : []))
  )
  /** Output projection remains part of the same native plan. */
  const fields = plan.pushed.find((step) => step.operation === QueryOperation.select)?.fields
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
      steps: nativeQuerySteps(source, plan.pushed),
      ctx: captured
    }
  } else
    input = {
      conditions,
      fields,
      ctx: captured,
      ...(source.nativeSteps
        ? { steps: nativeQuerySteps(source, plan.pushed) as readonly IQueryNativeStep[] }
        : {})
    }
  return input
}
/** Plans once and opens only the original native prefix; terminal adapters share this execution. */
function openRecordQuery(
  source: IQuerySourceSnapshot,
  node: IQueryNode | undefined,
  strict: boolean,
  ctx: IOperationContext | undefined,
  countOnly: boolean | typeof QueryOperation.aggregate = false,
  pageSize?: number,
  reduction?: INativeQueryReduction,
  prepared?: IPreparedQueryExecution,
  retainKeys = false
): {
  readonly iterator: IStorageIterator<readonly [IStorageKey, unknown]>
  readonly read: IQueryReader
  readonly close: ICompiledQueryReader['close']
  readonly report: ICompiledQueryReader['report']
  readonly ctx: IOperationContext | undefined
  readonly signature: readonly IQueryNode['step'][]
  readonly mapper: ((row: unknown) => unknown) | undefined
} {
  /** Strictness and missing comparator bounds reject before a source can open. */
  const plan =
    prepared?.plan ?? reduction?.plan ?? planRecordQuery(source, node, countOnly, pageSize)
  /** An original write owner can reuse pre-I/O admission without re-reading context getters. */
  const captured =
    prepared === undefined ? prepareQueryExecution(source, plan, strict, ctx) : prepared.ctx
  /** Node compilation creates no source I/O and retains no materialized row array. */
  const mapper =
    pageSize === undefined
      ? undefined
      : plan.client.find((step) => step.operation === QueryOperation.mapper)?.mapper
  /** Output mapping runs only for actual page items after the bounded original read. */
  const client =
    pageSize === undefined
      ? plan.client
      : plan.client.filter((step) => step.operation !== QueryOperation.mapper)
  /** Opaque comparison uses the original callback and a detached cursor anchor. */
  const comparator = plan.signature.find(
    (step) => step.operation === QueryOperation.comparator
  )?.compare
  const { read, close, report } = compileRecordQueryReader(
    reduction === undefined ? client : [],
    captured,
    reduction === undefined ? source.tieBreakByKey : undefined,
    source.vector !== undefined,
    pageSize !== undefined || retainKeys,
    comparator,
    source
  )
  try {
    /** The same native compiler is shared with direct native subscriptions. */
    const input = querySourceInput(source, plan, captured)
    return {
      iterator:
        reduction === undefined
          ? Reflect.apply(source.execute, source.receiver, [input])
          : Reflect.apply(source.reduce!, source.receiver, [
              { ...input, reduction: reduction.request }
            ]),
      read,
      close,
      report,
      ctx: captured,
      signature: plan.signature,
      mapper
    }
  } catch (cause) {
    throw queryExecutionFailure(cause)
  }
}
/** Records the original primary before awaiting original cursor cleanup on every read failure. */
async function failedRecordQuery(
  iterator: IStorageIterator<unknown>,
  fail: (error: unknown) => unknown,
  cause: unknown,
  close?: () => Promise<void>
): Promise<never> {
  /** Cleanup cannot replace an earlier predicate, mapper, comparator or native failure. */
  let primary = queryExecutionFailure(fail(queryExecutionFailure(cause)))
  try {
    await completeQueryCleanup(close, () => iterator.dispose())
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
    read: () => Promise<
      IteratorResult<R> & { readonly key?: IStorageKey; readonly keyBytes?: Uint8Array }
    >,
    ctx: IOperationContext | undefined,
    page:
      | {
          readonly signature: readonly IQueryNode['step'][]
          readonly mapper: ((row: unknown) => unknown) | undefined
        }
      | undefined
  ) => Promise<TResult>,
  countOnly: boolean | typeof QueryOperation.aggregate = false,
  pageSize?: number,
  reduction?: INativeQueryReduction,
  prepared?: IPreparedQueryExecution,
  retainKeys = false
): Promise<TResult> {
  /** Opening synchronously admits the complete terminal to the original transaction owner. */
  const {
    iterator,
    read,
    close,
    ctx: captured,
    signature,
    mapper
  } = openRecordQuery(
    source,
    node,
    strict,
    ctx,
    countOnly,
    pageSize,
    reduction,
    prepared,
    retainKeys
  )
  return runTransactionIteratorOperation(iterator, async (advance, fail, currentScope) => {
    /** The terminal's scalar, bounded chunk or explicit all result stays inside the same operation. */
    let result: TResult
    try {
      result = await consume(
        async () =>
          (await read(advance, currentScope)) as IteratorResult<R> & {
            readonly key?: IStorageKey
            readonly keyBytes?: Uint8Array
          },
        captured,
        pageSize === undefined ? undefined : { signature, mapper }
      )
    } catch (cause) {
      return failedRecordQuery(iterator, fail, cause, close)
    }
    try {
      await completeQueryCleanup(close, () => iterator.dispose())
    } catch (cause) {
      throw queryExecutionFailure(fail(queryExecutionFailure(cause)))
    }
    return result
  })
}

/** Captures write-only policy once while the existing context owner retains all other admission. */
function queryWriteContext(
  ctx: (IOperationContext & IWriteConcurrencyOptions) | undefined
): Pick<IQueryDelete, 'ctx' | 'concurrency'> {
  /** Context getters are read only by the original snapshot owner. */
  const captured = snapshotOperationContext(ctx)
  if (ctx === undefined) return { ctx: captured }
  try {
    /** Concurrency is not an operation-context field and is therefore borrowed exactly once here. */
    const concurrency = ctx.concurrency
    if (concurrency !== undefined) assertConcurrencyPolicy(concurrency)
    return Object.freeze({ ctx: captured, ...(concurrency === undefined ? {} : { concurrency }) })
  } catch (cause) {
    throw queryExecutionFailure(cause)
  }
}
/** A patch is detached at the terminal before its original backend transaction can start. */
function snapshotQueryPatch(patch: unknown): Readonly<Partial<Record<string, unknown>>> {
  try {
    if (typeof patch !== 'object' || patch === null || Array.isArray(patch))
      throw new TypeError(StorageContractErrorText.queryArgument)
    /** The original snapshot owner detaches data; the actual backend codec retains value admission. */
    const captured = immutableSnapshot(patch)
    return Object.freeze(captured as Record<string, unknown>)
  } catch (cause) {
    throw invalidQueryCondition(cause, StorageContractErrorText.queryArgument)
  }
}
/**
 * Selects and accepts actual rows inside the original backend write callback. This terminal reuses
 * the one planner, reader, resource cleanup and transaction operation; it owns no retry or lock.
 */
async function mutateRecordQuery(
  source: IQuerySourceSnapshot,
  node: IQueryNode | undefined,
  strict: boolean,
  request: IRecordQueryMutation | IRdfQueryMutation
): Promise<number> {
  /** Missing write authority rejects before source execution or any native transaction starts. */
  if (source.mutate === undefined)
    throw new StorageContractError(StorageContractErrorCode.unsupported)
  /** One execution plan is admitted before the original write pipeline can perform I/O. */
  const plan = planRecordQuery(source, node)
  /** This original snapshot is retained for every scoped cursor, including nested RDF traversal. */
  const ctx = prepareQueryExecution(source, plan, strict, request.ctx)
  /** Replacement identity uses the original admitted RDF encoder, never source-key spellings. */
  const replaced =
    request.operation === RdfQueryMethod.replace
      ? storageKeyBytesIdentity(encodeRdfQuadSnapshot(request.oldQuad))
      : undefined
  try {
    return await Reflect.apply(source.mutate, source.receiver, [
      request,
      async (port: IQueryMutationPort<IRecordQueryInput, unknown>) => {
        /** A native owner supplies exactly these two functions once per actual write attempt. */
        const { execute, accept } = port
        if (typeof execute !== 'function' || typeof accept !== 'function')
          throw invalidQueryCondition(undefined, StorageContractErrorText.queryArgument)
        /** The captured source facts stay fixed while I/O borrows the actual transaction receiver. */
        const scoped = { ...source, execute, receiver: port }
        /** One hash set retains only selected identities; rows are streamed and never materialized. */
        const seen = new Set<string>()
        return consumeRecordQuery<unknown, number>(
          scoped,
          node,
          strict,
          ctx,
          async (read, captured) => {
            /** Count increments only after the original draft explicitly accepts that unique row. */
            let count = 0
            while (true) {
              /**
               * Selection and callback failures retain the original cursor cleanup and primary
               * error.
               */
              const next = await read()
              if (next.done) return count
              /** RDF portable identity is the ground quad; vector identity is its original hit id. */
              const value =
                source.rdf === undefined
                  ? next.value
                  : snapshotStorageRdfQuad(next.value as IQuad, undefined)
              /** Key bytes have already been snapshotted and encoded by the same reader. */
              const identity =
                source.rdf !== undefined
                  ? storageKeyBytesIdentity(encodeRdfQuadSnapshot(value as IQuad))
                  : source.vector !== undefined
                    ? (value as IVectorHit<unknown>).id
                    : storageKeyBytesIdentity(next.keyBytes!)
              if ((replaced !== undefined && identity !== replaced) || seen.has(identity)) continue
              seen.add(identity)
              /** The actual backend draft decides accepted no-ops and concurrent disappearance. */
              const accepted = await Reflect.apply(accept, port, [next.key!, value])
              if (typeof accepted !== 'boolean')
                throw invalidQueryCondition(undefined, StorageContractErrorText.queryArgument)
              if (accepted) count++
              assertQueryActive(captured)
            }
          },
          false,
          undefined,
          undefined,
          { plan, ctx },
          true
        )
      }
    ])
  } catch (cause) {
    throw queryExecutionFailure(cause)
  }
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
): IQueryRead<R, TContext> & IQueryStatistics<R, TContext> & IQueryPages<R, TContext> {
  /** A fallback terminal with client callbacks cannot claim fully native execution in strict mode. */
  function assertClientTerminal(): void {
    if (strict)
      throw new StorageContractError(
        StorageContractErrorCode.queryNotPushable,
        {},
        StorageContractErrorText.queryNotPushable([StorageContractErrorText.queryUnsupported])
      )
  }
  /** Selects a real native scalar cursor only when the complete required plan is supported. */
  function nativeReduction(
    request: IQueryReduction,
    ctx: TContext | undefined
  ): Promise<IQueryReductionResult> | undefined {
    if (source.reduce === undefined || !source.pushdown.operations.includes(request.operation))
      return undefined
    /** The original planner drops only irrelevant output/order nodes for the requested reduction. */
    const countOnly =
      request.operation === QueryOperation.aggregate
        ? QueryOperation.aggregate
        : request.operation === QueryOperation.count
    const plan = planRecordQuery(source, node, countOnly)
    if (plan.client.length > 0) return undefined
    return consumeRecordQuery<IQueryReductionResult, IQueryReductionResult>(
      source,
      node,
      strict,
      ctx,
      async (read) => {
        /**
         * A native scalar result remains inside its original accepted cursor operation until
         * cleanup.
         */
        const next = await read()
        if (next.done)
          throw invalidQueryCondition(undefined, StorageContractErrorText.queryArgument)
        /** Read the finite result once; no backend rows are materialized by a scalar terminal. */
        const value = next.value
        if (
          request.operation === QueryOperation.count ||
          (request.operation === QueryOperation.aggregate &&
            request.aggregate === RecordQueryMethod.sum)
        ) {
          if (typeof value !== 'number')
            throw invalidQueryCondition(undefined, StorageContractErrorText.queryNumericField)
          return value
        }
        if (request.operation === QueryOperation.exists) {
          if (typeof value !== 'boolean')
            throw invalidQueryCondition(undefined, StorageContractErrorText.queryArgument)
          return value
        }
        if (typeof value !== 'object' || value === null)
          throw invalidQueryCondition(undefined, StorageContractErrorText.queryArgument)
        /** Native Maybe results use the same presence discriminator as client reductions. */
        const some = value.some
        if (some === false) return { some: false }
        const sample = some === true ? value.value : undefined
        if (some !== true || typeof sample !== 'number')
          throw invalidQueryCondition(undefined, StorageContractErrorText.queryNumericField)
        return { some: true, value: sample }
      },
      countOnly,
      undefined,
      { request, plan }
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
    const native = nativeReduction(
      { operation: QueryOperation.aggregate, aggregate: operation, field },
      ctx
    )
    if (native !== undefined) return native as Promise<number | IMaybe<number>>
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
      },
      QueryOperation.aggregate
    )
  }
  return {
    page: async (size, ctx) => {
      if (!Number.isSafeInteger(size) || size <= 0)
        throw invalidQueryCondition(undefined, StorageContractErrorText.queryPage)
      return consumeRecordQuery<R, { readonly items: R[]; readonly next?: IQueryCursor }>(
        source,
        node,
        strict,
        ctx,
        async (read, captured, plan) => {
          /** Only one bounded page plus its original lookahead row is retained. */
          const rows: Awaited<ReturnType<IQueryReader>>[] = []
          while (rows.length <= size) {
            /** Mapping is deferred, so a lookahead row never runs the user's output callback. */
            const next = await read()
            if (next.done) break
            rows.push(next)
          }
          /** A cursor anchor detaches before returned items or mappers can mutate the source row. */
          const next =
            rows.length > size
              ? createQueryCursor(source, plan!.signature, rows[size - 1]!, captured?.orgId)
              : undefined
          if (rows.length > size) rows.pop()
          /**
           * Actual returned items preserve the original awaited projection order and operation
           * lifetime.
           */
          const items: R[] = []
          for (const row of rows) {
            if (plan!.mapper === undefined) items.push(row.value as R)
            else {
              /** Preserve plain callback invocation rather than exposing a private plan receiver. */
              const mapper = plan!.mapper
              items.push((await mapper(row.value)) as R)
              assertQueryActive(captured)
            }
          }
          return { items, ...(next === undefined ? {} : { next }) }
        },
        false,
        size
      )
    },
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
    exists: async (ctx) => {
      const native = nativeReduction({ operation: QueryOperation.exists }, ctx)
      return native === undefined ? !(await first(ctx)).done : ((await native) as boolean)
    },
    count: async (ctx) => {
      const native = nativeReduction({ operation: QueryOperation.count }, ctx)
      if (native !== undefined) return native as Promise<number>
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
  const { iterator, read, close, report } = openRecordQuery(source, node, strict, ctx)
  /** Registered sources retain full mapped-next and buffered-result scope ownership. */
  const derived = deriveTransactionIterator(
    iterator,
    async (advance, fail, currentScope) => {
      try {
        return (await read(advance, currentScope)) as IteratorResult<R>
      } catch (cause) {
        return failedRecordQuery(iterator, fail, cause, close)
      }
    },
    close
  )
  if (derived) return derived
  /** The mapped root and its diagnostic forwarding use the same original source resource key. */
  const asyncDisposeKey: typeof Symbol.asyncDispose = source.asyncDisposeKey!
  /** Root mapped reads share the canonical accepted-advance drain with transaction resources. */
  const lifetime = createStorageIteratorLifetime<R>({
    close: () => completeQueryCleanup(close, () => iterator.dispose()),
    // Every original source owns its own cached report-and-resolve Promise.
    report: () => completeQueryCleanup(report, () => iterator[asyncDisposeKey]())
  })
  return {
    next: () =>
      lifetime.advance(() =>
        runTransactionIteratorOperation(iterator, async (advance, fail, currentScope) => {
          if (lifetime.isClosing()) return { done: true, value: undefined }
          try {
            return (await read(advance, currentScope)) as IteratorResult<R>
          } catch (cause) {
            return failedRecordQuery(iterator, fail, cause, close)
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
/** Native subscriptions accept only the complete original pushed plan and return the same resource. */
function queryWatch(
  source: IQuerySourceSnapshot,
  node: IQueryNode | undefined
): Partial<IQueryWatch> {
  if (source.watch === undefined) return {}
  return {
    watch(ctx?: IOperationContext): IStorageIterator<IStorageChange> {
      /** No client filtering, remapping or resubscription platform is introduced for native feeds. */
      const plan = planRecordQuery(source, node)
      /** Strict native admission rejects opaque callbacks and client traversal before subscribing. */
      const captured = prepareQueryExecution(source, plan, true, ctx)
      try {
        return Reflect.apply(source.watch!, source.receiver, [
          querySourceInput(source, plan, captured)
        ])
      } catch (cause) {
        throw queryExecutionFailure(cause)
      }
    }
  }
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
    ...queryWatch(source, node),
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
  const { min: _min, max: _max, sum: _sum, avg: _avg, page: _page, ...vectorReads } = reads
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
  methods: TAugmentMethods | undefined,
  ordering?: 'selector' | 'comparator'
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
    return recordQuery(source, { previous: node, step }, strict, methods, ordering)
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
        methods,
        ordering
      )
    },
    /** Distinct values retain the first row in this stage's current order. */
    distinct(field: string) {
      assertQueryField(field)
      return recordQuery<T, TContext, TAugmentMethods>(
        source,
        { previous: node, step: { operation: QueryOperation.distinct, field } },
        strict,
        methods,
        ordering
      )
    },
    /** Offset is explicit linear work; native execution requires the source's finite opt-in. */
    skip(count: number) {
      if (!Number.isSafeInteger(count) || count < 0)
        throw invalidQueryCondition(undefined, StorageContractErrorText.queryLimit)
      return recordQuery<T, TContext, TAugmentMethods>(
        source,
        { previous: node, step: { operation: QueryOperation.skip, count } },
        strict,
        methods,
        ordering
      )
    },
    after(cursor: IQueryCursor) {
      return recordQuery<T, TContext, TAugmentMethods>(
        source,
        {
          previous: node,
          step: { operation: QueryOperation.after, cursor: snapshotQueryCursor(cursor) }
        },
        strict,
        methods,
        ordering
      )
    },
    /** Selector refinements use canonical byte ordering and preserve the original primary-key tail. */
    orderBy(selector: (row: T) => IStorageKey, direction?: 'asc' | 'desc') {
      if (ordering === QueryOrderMode.comparator)
        throw invalidQueryCondition(undefined, StorageContractErrorText.queryArgument)
      return recordQuery<T, TContext, TAugmentMethods>(
        source,
        { previous: node, step: snapshotQueryOrder(selector, direction) },
        strict,
        methods,
        QueryOrderMode.selector
      )
    },
    /** Comparator state cannot execute until the next node supplies its bounded heap size. */
    ...(ordering === QueryOrderMode.selector
      ? {}
      : {
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
              methods,
              QueryOrderMode.comparator
            )
          }
        }),
    where,
    select,
    /** Actual record writes remain inside the backend's original pipeline and transaction. */
    delete: (ctx?: IQueryWriteContext<TContext>) =>
      mutateRecordQuery(source, node, strict, {
        operation: RecordQueryMethod.delete,
        ...queryWriteContext(ctx)
      }),
    update: (patch: Partial<T>, ctx?: IQueryWriteContext<TContext>) =>
      mutateRecordQuery(source, node, strict, {
        operation: RecordQueryMethod.update,
        patch: snapshotQueryPatch(patch),
        ...queryWriteContext(ctx)
      }),
    ...recordQueryReads<T, TContext>(source, node, strict),
    ...queryWatch(source, node),
    requirePushdown: () =>
      recordQuery<T, TContext, TAugmentMethods>(source, node, true, methods, ordering)
  }) as unknown as IRecordQuery<T, TContext, TAugmentMethods>
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
  source: IRecordQuerySource & { readonly watch: IQueryWatcher<IRecordQueryInput> },
  methods?: TAugmentMethods
): IRecordQuery<
  T,
  TContext,
  TAugmentMethods & (TContext extends undefined ? Record<never, never> : IQueryWatch<TContext>)
>
/** Sources without a declared native feed preserve their original read/write family shape. */
export function createRecordQuery<
  T,
  TContext extends IOperationContext | undefined = IOperationContext,
  TAugmentMethods extends object = Record<never, never>
>(source: IRecordQuerySource, methods?: TAugmentMethods): IRecordQuery<T, TContext, TAugmentMethods>
/** Captures original source support without subscribing or constructing another lifetime owner. */
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
            ...queryWatch(source, node),
            delete: (ctx?: IOperationContext & IWriteConcurrencyOptions) =>
              mutateRecordQuery(source, node, strict, {
                operation: RecordQueryMethod.delete,
                ...queryWriteContext(ctx)
              }),
            select,
            distinct(field: string) {
              assertQueryField(field)
              return append({ operation: QueryOperation.distinct, field })
            },
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
    ...queryWatch(source, node),
    delete: (ctx?: IOperationContext & IWriteConcurrencyOptions) =>
      mutateRecordQuery(source, node, strict, {
        operation: RecordQueryMethod.delete,
        ...queryWriteContext(ctx)
      }),
    replace(oldQuad: IQuad, newQuad: IQuad, ctx?: IOperationContext & IWriteConcurrencyOptions) {
      return mutateRecordQuery(source, node, strict, {
        operation: RdfQueryMethod.replace,
        oldQuad: snapshotStorageRdfQuad(oldQuad, undefined),
        newQuad: snapshotStorageRdfQuad(newQuad, undefined),
        ...queryWriteContext(ctx)
      })
    },
    select,
    distinct(field: string) {
      assertQueryField(field)
      return append({ operation: QueryOperation.distinct, field })
    },
    skip(count: number) {
      if (!Number.isSafeInteger(count) || count < 0)
        throw invalidQueryCondition(undefined, StorageContractErrorText.queryLimit)
      return append({ operation: QueryOperation.skip, count })
    },
    after(cursor: IQueryCursor) {
      return append({ operation: QueryOperation.after, cursor: snapshotQueryCursor(cursor) })
    },
    orderBy(selector: (quad: IQuad) => IStorageKey, direction?: 'asc' | 'desc') {
      return append(snapshotQueryOrder(selector, direction))
    },
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
  source: IVectorQuerySource<TPayload, TGroupable> & {
    readonly watch: IQueryWatcher<IVectorQueryInput>
  },
  methods?: TAugmentMethods
): IVectorQueryBuilder<TPayload, TGroupable, false, TAugmentMethods & IQueryWatch>
/** No native source watcher means the original pre-topK builder has no watch projection. */
export function createVectorQuery<
  TPayload,
  TGroupable extends boolean = false,
  TAugmentMethods extends object = Record<never, never>
>(
  source: IVectorQuerySource<TPayload, TGroupable>,
  methods?: TAugmentMethods
): IVectorQueryBuilder<TPayload, TGroupable, false, TAugmentMethods>
/** Captures one native vector source and no subscription or client ranking platform. */
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
  TAugmentMethods extends object = Record<never, never>,
  TOperationScope extends object = object
>(
  source: IRdfQuerySource<TOperationScope> & {
    readonly watch: IQueryWatcher<IRdfQueryInput<TOperationScope>>
  },
  pattern: Partial<IQuad>,
  methods?: TAugmentMethods
): IRdfQuery<
  TContext,
  TAugmentMethods & (TContext extends undefined ? Record<never, never> : IQueryWatch<TContext>)
>
/** Transaction and non-feed callers preserve their original exact RDF family shape. */
export function createRdfQuery<
  TContext extends IOperationContext | undefined = IOperationContext,
  TAugmentMethods extends object = Record<never, never>,
  TOperationScope extends object = object
>(
  source: IRdfQuerySource<TOperationScope>,
  pattern: Partial<IQuad>,
  methods?: TAugmentMethods
): IRdfQuery<TContext, TAugmentMethods>
/** Captures one ground native source without creating a subscription or lifecycle owner. */
export function createRdfQuery<
  TContext extends IOperationContext | undefined = IOperationContext,
  TAugmentMethods extends object = Record<never, never>,
  TOperationScope extends object = object
>(
  source: IRdfQuerySource<TOperationScope>,
  pattern: Partial<IQuad>,
  methods?: TAugmentMethods
): IRdfQuery<TContext, TAugmentMethods> {
  /** Pattern terms detach once; omitting graph retains the canonical all-graphs match semantics. */
  const capturedPattern = snapshotStorageRdfPattern(pattern, undefined)
  /** Native callbacks retain their exact original author receiver and original resource key. */
  const captured = snapshotQuerySource(source as unknown as IRecordQuerySource)
  return familyQuery(
    {
      ...captured,
      rdf: { pattern: capturedPattern, condition: snapshotStorageWhere(capturedPattern) }
    },
    undefined,
    false,
    snapshotRecordQueryMethods(methods, RdfQueryMethod),
    true
  ) as IRdfQuery<TContext, TAugmentMethods>
}
