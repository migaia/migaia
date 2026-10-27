// Query where-condition snapshots, comparison and compilation for the query SDK (see ./query.ts).
import {
  QueryOperator,
  type IWhere,
  type IQueryOperandValue,
  type IQueryCondition,
  RecordQueryMethod,
  StorageContractError,
  StorageContractErrorCode,
  StorageContractErrorText
} from '@migaia/storage-contract'
import { asCodecValue } from '@migaia/serialize/codec'
import {
  parseObjectPath,
  probeObjectPathSegments,
  type IObjectPathTupleFor
} from '@migaia/utils/object-path'

/** Boolean node tags never require another query state or expression platform. */
export const QueryConditionKind = { field: 'field', and: 'and', or: 'or', not: 'not' } as const

/** Range comparisons accept only one shared ordered field domain per comparison. */
type IQueryComparable = number | bigint | string | Date

/** Produces the original admission boundary with its captured message and exact native cause. */
export function invalidQueryCondition(
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
  return captured
}

/** Returns a comparable point only for valid values in one declared ordered field domain. */
function queryComparable(value: unknown): IQueryComparable | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value === 'bigint' || typeof value === 'string') return value
  if (value instanceof Date && Number.isFinite(value.getTime())) return value
  return undefined
}

/** SameValueZero agrees with Set membership; Date values additionally compare their time points. */
export function queryEqual(left: unknown, right: unknown): boolean {
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
export function snapshotQueryField(
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
  return { kind: QueryConditionKind.field, path, operator, value: captured }
}

/** Owns cycle admission while canonical condition nodes retain data across later execution awaits. */
class QueryWhereParser {
  /** Only active ancestors reject cycles; independent shared sibling records remain legal. */
  readonly #active = new WeakSet<object>()
  /** Parses one declaration using the canonical object-path and operand owners. */
  parse(where: unknown): IQueryCondition {
    try {
      return this.#visit(where, [])
    } catch (cause) {
      throw invalidQueryCondition(cause)
    }
  }
  /** Nested declarations retain their validated path prefix and source boolean order. */
  #visit(value: unknown, prefix: readonly string[]): IQueryCondition {
    if (
      typeof value !== 'object' ||
      value === null ||
      Array.isArray(value) ||
      value instanceof Date ||
      this.#active.has(value)
    )
      throw new TypeError(StorageContractErrorText.queryCondition)
    this.#active.add(value)
    try {
      /** Own condition fields retain their source declaration order. */
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
            nested.push(this.#visit(entry[index], prefix))
          }
          conditions.push({ kind: field, conditions: nested })
        } else if (field === QueryConditionKind.not)
          conditions.push({ kind: field, condition: this.#visit(entry, prefix) })
        else {
          /**
           * The validated public path uses strings even for an array index's ordinary property
           * name.
           */
          const path = [...prefix, ...parseObjectPath(field).map(String)]
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
            } else conditions.push(this.#visit(entry, path))
          } else conditions.push(snapshotQueryField(path, QueryOperator.eq, entry))
        }
      }
      return { kind: QueryConditionKind.and, conditions: conditions }
    } finally {
      this.#active.delete(value)
    }
  }
}

/** Captures one canonical condition before later query execution can await native work. */
export function snapshotStorageWhere(where: unknown): IQueryCondition {
  return new QueryWhereParser().parse(where)
}

/** Compiles the already captured AST once; in lists become Sets before any candidate is read. */
export function compileQueryCondition<T>(condition: IQueryCondition): (value: T) => boolean {
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
      /** The canonical path owner distinguishes a missing property from present undefined. */
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
 * Compiles one declarative condition to a stateless predicate. Operator values and membership lists
 * are captured once; ordinary object equality is identity-based, Date equality is by captured time
 * and ranges never coerce domains. The compiler creates no owner, query, I/O or side effect.
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

/** Captures only pure Feature methods and rejects collisions before source or cursor admission. */
export function snapshotRecordQueryMethods<T extends object>(
  methods: T | undefined,
  reserved: object = RecordQueryMethod
): T | undefined {
  if (methods === undefined) return undefined

  if (
    methods !== undefined &&
    (typeof methods !== 'object' || methods === null || Array.isArray(methods))
  )
    throw invalidQueryArgument()
  /** Feature method identities are retained for every derived branch. */
  const captured = { ...methods } as T
  for (const key of Reflect.ownKeys(captured))
    if (
      (typeof key === 'string' && Object.hasOwn(reserved, key)) ||
      typeof Reflect.get(captured, key) !== 'function'
    )
      throw invalidQueryArgument()
  return captured
}

/** Creates the existing coded query-admission error while preserving its native TypeError cause. */
export function invalidQueryArgument(): StorageContractError {
  return invalidQueryCondition(
    new TypeError(StorageContractErrorText.queryArgument),
    StorageContractErrorText.queryArgument
  )
}
