import { asCodecValue, type ICodecValue } from '@migaia/serialize/codec'
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
import type { IStorageIterator } from './resource.js'
import { snapshotOperationContext } from './operation-context.js'
import { runTransactionIteratorOperation } from './transaction.js'

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

/** Produces the registered admission boundary while preserving the exact reflected or native cause. */
function invalidQueryCondition(cause?: unknown): StorageContractError {
  return new StorageContractError(
    StorageContractErrorCode.invalidArgument,
    { cause },
    StorageContractErrorText.queryCondition
  )
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
  explain(): IQueryPlan
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
  }
/** The implemented immutable record slice; later terminals extend this same canonical owner. */
export type IQueryChain<
  T,
  TContext extends IOperationContext | undefined = IOperationContext,
  TWhere = T,
  TStatistics extends boolean = true,
  TAugmentMethods extends object = Record<never, never>
> = IQueryRead<T, TContext> &
  TAugmentMethods & {
    where(condition: IWhere<TWhere>): IQueryChain<T, TContext, TWhere, TStatistics, TAugmentMethods>
    where<P extends IObjectPath<TWhere>, O extends keyof IFieldOps<IObjectPathValue<TWhere, P>>>(
      path: P,
      operator: O,
      value: IQueryOperand<IObjectPathValue<TWhere, P>, NoInfer<O>>
    ): IQueryChain<T, TContext, TWhere, TStatistics, TAugmentMethods>
    where(
      predicate: (row: TWhere) => boolean
    ): IQueryChain<T, TContext, TWhere, TStatistics, TAugmentMethods>
    select<const K extends Extract<keyof T, string>>(
      ...fields: readonly [K, ...K[]]
    ): IQueryResult<Pick<T, K>, TContext, TStatistics, TAugmentMethods>
    select<N>(
      mapper: (row: T) => N
    ): IQueryResult<Awaited<N>, TContext, TStatistics, TAugmentMethods>
    requirePushdown(): IQueryChain<T, TContext, TWhere, TStatistics, TAugmentMethods>
  }
/** Implemented record methods are reserved by the original owner before Feature admission. */
export const RecordQueryMethod = Object.freeze({
  where: 'where',
  select: 'select',
  all: 'all',
  explain: 'explain',
  requirePushdown: 'requirePushdown'
} as const)
/** Captures only pure Feature methods and rejects collisions before source or cursor admission. */
function snapshotRecordQueryMethods<T extends object>(methods: T | undefined): T {
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
        (typeof key === 'string' && Object.hasOwn(RecordQueryMethod, key)) ||
        typeof Reflect.get(captured, key) !== 'function'
      )
        throw new TypeError(StorageContractErrorText.queryArgument)
    return Object.freeze(captured)
  } catch (cause) {
    throw new StorageContractError(
      StorageContractErrorCode.invalidArgument,
      { cause },
      StorageContractErrorText.queryArgument
    )
  }
}
/** Native execution consumes only the shared AST and optional top-level projection from its plan. */
export type IRecordQuerySource = {
  readonly pushdown: IQueryPushdown
  readonly execute: (input: {
    readonly conditions: readonly IQueryCondition[]
    readonly fields: readonly string[] | undefined
    readonly ctx: IOperationContext | undefined
  }) => IStorageIterator<readonly [IStorageKey, unknown]>
}
/** Nodes retain only their immediate predecessor, so deriving a branch never copies its history. */
type IQueryNode = {
  readonly previous: IQueryNode | undefined
  readonly step:
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
}
/** Captured author facts and methods remain independent of later source getter mutation. */
type IQuerySourceSnapshot = {
  readonly pushdown: IQueryPushdown
  readonly execute: IRecordQuerySource['execute']
  readonly receiver: IRecordQuerySource
}
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
        if (!Object.hasOwn(values, position))
          throw new TypeError(StorageContractErrorText.queryArgument)
        /** Every value must name a canonical declared operation. */
        const value = values[position]!
        if (typeof value !== 'string' || !Object.hasOwn(table, value))
          throw new TypeError(StorageContractErrorText.queryArgument)
        result.push(value)
      }
      return Object.freeze(result)
    }
    return {
      receiver: source,
      execute,
      pushdown: Object.freeze({
        operators: capture(operators, QueryOperator),
        operations: capture(operations, QueryOperation),
        source: sourceName,
        ...(index === undefined ? {} : { index })
      })
    }
  } catch (cause) {
    throw new StorageContractError(
      StorageContractErrorCode.invalidArgument,
      { cause },
      StorageContractErrorText.queryArgument
    )
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
  node: IQueryNode | undefined
): IRecordExecutionPlan {
  /** One reverse traversal avoids repeated prefix allocation during fluent construction. */
  const steps: IQueryNode['step'][] = []
  for (let current = node; current !== undefined; current = current.previous)
    steps.push(current.step)
  steps.reverse()
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
    /** A prior client node is a barrier for every subsequent record operation. */
    const reason =
      client.length > 0
        ? StorageContractErrorText.queryPrefix
        : step.operation === QueryOperation.predicate || step.operation === QueryOperation.mapper
          ? StorageContractErrorText.queryFunction
          : !operations.has(step.operation)
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
        source.pushdown.index === undefined ||
        !pushed.some((step) => step.operation === QueryOperation.where),
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
/**
 * Executes one terminal while leaving iterator creation, transaction ownership and cleanup with its
 * source.
 */
async function executeRecordQuery<R>(
  source: IQuerySourceSnapshot,
  node: IQueryNode | undefined,
  strict: boolean,
  ctx: IOperationContext | undefined
): Promise<R[]> {
  /** Strictness is checked before context resources or a native cursor can be created. */
  const plan = planRecordQuery(source, node)
  if (strict && plan.client.length > 0)
    throw new StorageContractError(
      StorageContractErrorCode.queryNotPushable,
      {},
      StorageContractErrorText.queryNotPushable(plan.explanation.client.map((step) => step.reason!))
    )
  /** Base operation fields are captured once and delegated to the original iterator owner. */
  const captured = snapshotOperationContext(ctx)
  assertQueryActive(captured)
  /** The source consumes only the actual native prefix, never an independently recompiled condition. */
  const conditions = Object.freeze(
    plan.pushed.flatMap((step) => (step.operation === QueryOperation.where ? [step.condition] : []))
  )
  /** Field projection can be native only after all preceding steps are native. */
  const fields = plan.pushed.find((step) => step.operation === QueryOperation.select)?.fields
  /** Client declarative predicates are compiled once, including their membership Sets. */
  const client = plan.client.map((step) =>
    step.operation === QueryOperation.where
      ? { ...step, predicate: compileQueryCondition<unknown>(step.condition) }
      : step
  )
  /** The source creates its actual iterator before the complete terminal is admitted to that owner. */
  let iterator: IStorageIterator<readonly [IStorageKey, unknown]>
  try {
    iterator = Reflect.apply(source.execute, source.receiver, [
      { conditions, fields, ctx: captured }
    ])
  } catch (cause) {
    throw queryExecutionFailure(cause)
  }
  /**
   * The whole terminal, including mapping and cleanup, remains one accepted original-owner
   * operation.
   */
  return runTransactionIteratorOperation(iterator, async (advance, fail) => {
    /** Only accepted output is retained; every native candidate is consumed once. */
    const rows: R[] = []
    /** The original primary is recorded before cleanup can fail or expire the operation view. */
    let primary: Error | undefined
    try {
      while (true) {
        assertQueryActive(captured)
        /** Native next is always awaited to settlement before any cleanup is requested. */
        const next = await advance()
        assertQueryActive(captured)
        if (next.done) break
        /** Mapping is local to this row and never mutates a backend-owned candidate. */
        let value = next.value[1]
        /** Short-circuit filtering preserves callback order and avoids unnecessary mapping. */
        let accepted = true
        for (const step of client) {
          if (
            step.operation === QueryOperation.where ||
            step.operation === QueryOperation.predicate
          ) {
            if (!step.predicate(value)) {
              accepted = false
              break
            }
          } else if (step.operation === QueryOperation.mapper) value = await step.mapper(value)
          else {
            /** Projection copies only requested own fields and cannot trigger prototype mutation. */
            const selected: Record<string, unknown> = {}
            for (const field of step.fields)
              Object.defineProperty(selected, field, {
                enumerable: true,
                configurable: true,
                writable: true,
                value:
                  value === null || value === undefined
                    ? undefined
                    : Reflect.get(Object(value), field)
              })
            value = selected
          }
          assertQueryActive(captured)
        }
        if (accepted) rows.push(value as R)
      }
    } catch (cause) {
      primary = queryExecutionFailure(fail(queryExecutionFailure(cause)))
    } finally {
      try {
        await iterator.dispose()
      } catch (cause) {
        /** Cleanup remains reachable after the original first error rather than replacing it. */
        const cleanup = queryExecutionFailure(cause)
        primary =
          primary === undefined
            ? cleanup
            : queryExecutionFailure(attachSecondaryErrors(primary, [cleanup]))
      }
    }
    if (primary !== undefined) throw primary
    return rows
  })
}

/** Captures an immutable string projection before creating another chain node. */
function snapshotQueryFields(fields: readonly unknown[]): readonly string[] {
  if (fields.length === 0 || fields.some((field) => typeof field !== 'string'))
    throw new StorageContractError(
      StorageContractErrorCode.invalidArgument,
      {},
      StorageContractErrorText.queryArgument
    )
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
  methods: TAugmentMethods
): IQueryResult<R, TContext, true, TAugmentMethods> {
  return Object.freeze({
    ...methods,
    all: (ctx?: TContext) => executeRecordQuery<R>(source, node, strict, ctx),
    explain: () => planRecordQuery(source, node).explanation,
    requirePushdown: () =>
      selectedRecordQuery<R, TContext, TAugmentMethods>(source, node, true, methods)
  })
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
  methods: TAugmentMethods
): IQueryChain<T, TContext, T, true, TAugmentMethods> {
  /** Overloads are implemented through one explicit runtime argument-shape dispatcher. */
  function where(
    condition: IWhere<T> | ((row: T) => boolean)
  ): IQueryChain<T, TContext, T, true, TAugmentMethods>
  function where<P extends IObjectPath<T>, O extends keyof IFieldOps<IObjectPathValue<T, P>>>(
    path: P,
    operator: O,
    value: IQueryOperand<IObjectPathValue<T, P>, NoInfer<O>>
  ): IQueryChain<T, TContext, T, true, TAugmentMethods>
  function where(...args: readonly unknown[]): IQueryChain<T, TContext, T, true, TAugmentMethods> {
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
    where,
    select,
    all: (ctx?: TContext) => executeRecordQuery<T>(source, node, strict, ctx),
    explain: () => planRecordQuery(source, node).explanation,
    requirePushdown: () => recordQuery<T, TContext, TAugmentMethods>(source, node, true, methods)
  })
}
/**
 * Creates the shared record where/select/all executor from one backend author callback. Native
 * projection rows are intentionally unknown; T declares the complete pre-projection row domain.
 * Construction performs no I/O. Every all invocation plans once, passes only the safe native
 * prefix, preserves callback order and awaits the original storage iterator's disposal on success
 * or failure. The original source owns operation timing and transaction lifetime.
 */
export function createRecordQuery<
  T,
  TContext extends IOperationContext | undefined = IOperationContext,
  TAugmentMethods extends object = Record<never, never>
>(
  source: IRecordQuerySource,
  methods?: TAugmentMethods
): IQueryChain<T, TContext, T, true, TAugmentMethods> {
  /** Feature-owned pure functions are captured once and retained by reference on every branch. */
  const captured = snapshotRecordQueryMethods(methods)
  return recordQuery<T, TContext, TAugmentMethods>(
    snapshotQuerySource(source),
    undefined,
    false,
    captured
  )
}
