import {
  QueryOperator,
  type IWhere,
  type IQueryOperandValue,
  type IQueryCondition,
  QueryOperation,
  type IQueryPlanStep,
  type IQueryPlan,
  type IQueryPushdown,
  type IQueryRead,
  type IQueryWriteContext,
  type IQueryStatistics,
  type IQueryCursor,
  type IQueryPages,
  type IQueryWatch,
  type IQueryResult,
  type IRecordQuery,
  type IVectorHit,
  VectorQueryOriginKind,
  type IVectorQueryOrigin,
  type IVectorReranker,
  type IVectorRerankOptions,
  type IVectorQueryRefinement,
  type IVectorNativeQuery,
  type IVectorQueryBuilder,
  type IVectorQuery,
  type IRdfQuery,
  RecordQueryMethod,
  VectorQueryMethod,
  RdfQueryMethod,
  type IRecordQuerySource,
  type IRecordQuerySourcePlan,
  type IRecordQueryInput,
  type IQueryDelete,
  type IRecordQueryMutation,
  type IRdfQueryMutation,
  type IQueryMutationPort,
  type IQueryMutator,
  type IQueryWatcher,
  type IQueryReduction,
  type IQueryReductionResult,
  type IQueryReducer,
  type IQueryNativeStep,
  type IVectorQueryInput,
  type IVectorQuerySource,
  type IRdfQueryTraversal,
  type IRdfQueryInput,
  type IRdfQuerySource,
  StorageContractError,
  StorageContractErrorCode,
  STORAGE_CONTRACT_SOURCE,
  StorageContractErrorText,
  type IOperationContext,
  type IStorageKey,
  type IStorageChange,
  type IStorageIterator,
  assertConcurrencyPolicy,
  type IWriteConcurrencyOptions,
  RdfTermType,
  type IQuad,
  type IRdfNamedNode
} from '@migaia/storage-contract'
import { asCodecValue } from '@migaia/serialize/codec'
import { type IMaybe } from '@migaia/utils'
import { type INativeAbortSignal } from '@migaia/utils/promise'
import { immutableSnapshot } from '@migaia/utils/object'
import {
  parseObjectPath,
  probeObjectPathSegments,
  type IObjectPathTupleFor
} from '@migaia/utils/object-path'
import {
  attachErrorIdentity,
  attachSecondaryErrors,
  IdentifyError,
  toError
} from '@migaia/utils/error'
import { createStorageIteratorLifetime } from './resource.js'
import { snapshotOperationContext } from './context.js'
import { snapshotStorageVector, snapshotStorageVectorIds } from './vector.js'
import { runTransactionIteratorOperation, deriveTransactionIterator } from './transaction.js'
import {
  compareStorageKeys,
  snapshotStorageKey,
  encodeOrderedStorageKey,
  orderStorageKeysByBytes,
  storageKeyBytesIdentity
} from './key.js'
import { snapshotStorageRdfPattern, snapshotStorageRdfQuad, encodeRdfQuadSnapshot } from './rdf.js'
import { RecordQueryKeysetOwner } from './query-keyset.js'

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
function snapshotRecordQueryMethods<T extends object>(
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

/** Nodes retain only their immediate predecessor, so deriving a branch never copies its history. */
export type IQueryNode = {
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
    | {
        readonly operation: typeof QueryOperation.after
        readonly cursor: IQueryCursorSnapshot
        readonly compile: (compiler: IQueryCompileContext) => IQueryReader
        readonly native: (source: IQuerySourceSnapshot) => IQueryNativeStep
      }
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
    | (IRdfQueryTraversal & { readonly compile: IFamilyReaderCompiler })
    | {
        readonly operation: typeof QueryOperation.groupBy
        readonly field: string
        readonly perGroup: number
        readonly compile: IVectorReaderCompiler
      }
    | { readonly operation: typeof QueryOperation.rerank; readonly compile: IVectorReaderCompiler }
}

/** Original author methods are invoked directly on their real receiver across all query channels. */
type IQuerySourcePort = {
  readonly execute: (
    input: IRecordQueryInput | IVectorQueryInput | IRdfQueryInput
  ) => IStorageIterator<readonly [IStorageKey, unknown]>
  readonly reduce?: IQueryReducer<IRecordQueryInput | IVectorQueryInput | IRdfQueryInput>
  readonly mutate?: IQueryMutator<
    IRecordQueryInput,
    unknown,
    IRecordQueryMutation | IRdfQueryMutation
  >
  readonly watch?: IQueryWatcher<IRecordQueryInput | IVectorQueryInput | IRdfQueryInput>
  readonly plan?: IRecordQuerySource['plan']
}

/** Captured author facts and methods remain independent of later source option mutation. */
export type IQuerySourceSnapshot = {
  readonly pushdown: IQueryPushdown
  readonly asyncDisposeKey: typeof Symbol.asyncDispose | undefined
  readonly tieBreakByKey: IRecordQuerySource['tieBreakByKey']
  readonly execute: IRecordQuerySource['execute']
  readonly reduce: IRecordQuerySource['reduce']
  readonly mutate: IRecordQuerySource['mutate']
  readonly watch: IRecordQuerySource['watch']
  readonly plan: IRecordQuerySource['plan']
  readonly receiver: IQuerySourcePort
  readonly nativeSteps: boolean
  readonly cursorSource: object
  readonly keyset?: RecordQueryKeysetOwner
  readonly missingKeyset?: () => never
  readonly vector?: {
    readonly beginOperation?: () => () => void
    readonly origin?: IVectorQueryOrigin
    readonly acceptsNative?: true
    readonly native?: IVectorQueryRefinement
    readonly reranked?: true
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
export type IQueryCursorSnapshot = {
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
export type IRecordExecutionPlan = {
  readonly sourcePlan?: IRecordQuerySourcePlan
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

/** Creates the existing coded query-admission error while preserving its native TypeError cause. */
function invalidQueryArgument(): StorageContractError {
  return invalidQueryCondition(
    new TypeError(StorageContractErrorText.queryArgument),
    StorageContractErrorText.queryArgument
  )
}

/** Both static and terminal-local declarations use the same original support snapshot. */
function snapshotQueryPushdown(pushdown: IQueryPushdown, execute: unknown): IQueryPushdown {
  /** Support arrays become independent immutable planner facts. */
  const { operators, operations, source: sourceName, index, canPushCondition } = pushdown
  if (
    !Array.isArray(operators) ||
    !Array.isArray(operations) ||
    typeof sourceName !== 'string' ||
    sourceName.length === 0 ||
    (index !== undefined && typeof index !== 'string') ||
    (canPushCondition !== undefined && typeof canPushCondition !== 'function') ||
    typeof execute !== 'function'
  )
    throw new TypeError(StorageContractErrorText.queryArgument)
  /** Dense declaration arrays reject an omitted operator rather than silently widening support. */
  const capture = <T extends string>(values: readonly T[], table: object): readonly T[] => {
    /** The owning snapshot checks and copies each actual declaration once. */
    const result: T[] = []
    /** The supported declaration array has a finite bound during admission. */
    const length = values.length
    for (let position = 0; position < length; position++) {
      /** Sparse declarations are invalid; each present value must name a declared operation. */
      let value: T | undefined
      if (
        !Object.hasOwn(values, position) ||
        typeof (value = values[position]) !== 'string' ||
        !Object.hasOwn(table, value)
      )
        throw new TypeError(StorageContractErrorText.queryArgument)
      result.push(value)
    }
    return result
  }
  /** Existing source admission finishes before reading the new optional key-order fact. */
  return {
    operators: capture(operators, QueryOperator),
    operations: capture(operations, QueryOperation),
    source: sourceName,
    ...(index === undefined ? {} : { index }),
    ...(canPushCondition === undefined
      ? {}
      : {
          canPushCondition: (condition: IQueryCondition): boolean => {
            try {
              return pushdown.canPushCondition!(condition) === true
            } catch (cause) {
              throw queryExecutionFailure(cause)
            }
          }
        })
  }
}

/** A top-level native support declaration is snapshotted once before any chain is returned. */
function snapshotQuerySource(source: IRecordQuerySource): IQuerySourceSnapshot {
  if (typeof source !== 'object' || source === null) throw invalidQueryArgument()
  /** Supported source facts are retained while its methods run on the original receiver. */
  const { pushdown, execute } = source
  /** Public descriptor admission codes ordinary malformed declarations before retaining a source. */
  let capturedPushdown: IQueryPushdown
  try {
    capturedPushdown = snapshotQueryPushdown(pushdown, execute)
  } catch (cause) {
    throw invalidQueryCondition(cause, StorageContractErrorText.queryArgument)
  }
  /** One read keeps a mutable author descriptor from changing later comparison semantics. */
  const keyOrder = source.tieBreakByKey
  /** The captured declaration cannot change direction or key-budget interpretation later. */
  let tieBreakByKey: IRecordQuerySource['tieBreakByKey']
  if (keyOrder !== undefined) {
    if (typeof keyOrder !== 'object' || keyOrder === null || Array.isArray(keyOrder))
      throw invalidQueryArgument()
    /** Each descriptor field is borrowed once under the original source-admission boundary. */
    const { direction, parts } = keyOrder
    if (
      (direction !== QueryKeyDirection.next && direction !== QueryKeyDirection.prev) ||
      (parts !== undefined && parts !== true)
    )
      throw invalidQueryArgument()
    tieBreakByKey = { direction, ...(parts === undefined ? {} : { parts }) }
  }
  /** The source key is captured once; omission retains the native symbol's existing semantics. */
  const configuredAsyncDisposeKey = source.asyncDisposeKey
  if (configuredAsyncDisposeKey !== undefined && typeof configuredAsyncDisposeKey !== 'symbol')
    throw invalidQueryArgument()
  /** Extended native controls are never inferred from legacy support arrays alone. */
  const nativeSteps = source.nativeSteps
  if (nativeSteps !== undefined && nativeSteps !== true) throw invalidQueryArgument()
  /** Source identity is captured once and is used only for Boolean cursor compatibility checks. */
  const cursorSource = source.cursorSource
  if (
    cursorSource !== undefined &&
    (cursorSource === null ||
      (typeof cursorSource !== 'object' && typeof cursorSource !== 'function'))
  )
    throw invalidQueryArgument()
  /** Optional native terminal support captures one callable rather than inferring another runner. */
  const reduce = source.reduce
  if (reduce !== undefined && typeof reduce !== 'function') throw invalidQueryArgument()
  /** One captured author callback retains original pipeline and native transaction authority. */
  const mutate = source.mutate
  if (mutate !== undefined && typeof mutate !== 'function') throw invalidQueryArgument()
  /** A declared native watcher supplies its own original subscription resource and timing owner. */
  const watch = source.watch
  if (watch !== undefined && typeof watch !== 'function') throw invalidQueryArgument()
  /** Pure planning authority is borrowed once, just like the original native callbacks. */
  const plan = source.plan
  if (plan !== undefined && typeof plan !== 'function') throw invalidQueryArgument()
  return {
    receiver: source as unknown as IQuerySourcePort,
    execute,
    reduce,
    mutate,
    watch,
    plan,
    pushdown: capturedPushdown,
    tieBreakByKey,
    nativeSteps: nativeSteps === true,
    cursorSource: cursorSource ?? source,
    asyncDisposeKey: configuredAsyncDisposeKey ?? Symbol.asyncDispose
  }
}

/** Capture one pure decision without resnapshotting conditions or exposing its private selection. */
function planRecordSource(
  source: IQuerySourceSnapshot,
  steps: readonly IQueryNode['step'][]
): IRecordQuerySourcePlan | undefined {
  if (source.plan === undefined) return undefined
  /**
   * Only adjacent leading declarations can restrict a source without changing callback/page
   * effects.
   */
  const conditions: IQueryCondition[] = []
  for (const step of steps) {
    if (step.operation !== QueryOperation.where) break
    conditions.push(step.condition)
  }
  try {
    /** The original author receives the same captured receiver and canonical AST identities. */
    const result = source.receiver.plan!(conditions)
    if (result === undefined) return undefined
    if (result === null || typeof result !== 'object' || Array.isArray(result))
      throw new TypeError(StorageContractErrorText.queryArgument)
    const { pushdown, fullScan, selection, sourceReason, sourceCandidates } = result
    if (fullScan !== undefined && fullScan !== true)
      throw new TypeError(StorageContractErrorText.queryArgument)
    /** This execution reuses the original support admission, including exact callback receivers. */
    const captured = snapshotQueryPushdown(pushdown, source.execute)
    if (sourceReason !== undefined && typeof sourceReason !== 'string')
      throw new TypeError(StorageContractErrorText.queryArgument)
    /** Explain gets detached metadata only, never the native selection or callback authority. */
    let candidates: IRecordQuerySourcePlan['sourceCandidates']
    if (sourceCandidates !== undefined) {
      if (!Array.isArray(sourceCandidates))
        throw new TypeError(StorageContractErrorText.queryArgument)
      /** Candidate metadata is detached, so later author mutation cannot rewrite an explanation. */
      const entries: { readonly index: string; readonly reason: string }[] = []
      /** A borrowed descriptor array has its bound captured only once. */
      const length = sourceCandidates.length
      for (let position = 0; position < length; position++) {
        if (!Object.hasOwn(sourceCandidates, position))
          throw new TypeError(StorageContractErrorText.queryArgument)
        /** Each present descriptor is read once under the same native-query error boundary. */
        const candidate = sourceCandidates[position]
        if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate))
          throw new TypeError(StorageContractErrorText.queryArgument)
        const { index, reason } = candidate
        if (typeof index !== 'string' || typeof reason !== 'string')
          throw new TypeError(StorageContractErrorText.queryArgument)
        entries.push({ index, reason })
      }
      candidates = entries
    }
    return {
      pushdown: captured,
      ...(fullScan === undefined ? {} : { fullScan }),
      ...(selection === undefined ? {} : { selection }),
      ...(sourceReason === undefined ? {} : { sourceReason }),
      ...(candidates === undefined ? {} : { sourceCandidates: candidates })
    }
  } catch (cause) {
    throw queryExecutionFailure(cause)
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

/** Flattens persistent query history once without running callbacks or opening resources. */
function queryHistory(node: IQueryNode | undefined): IQueryNode['step'][] {
  /** One reverse traversal avoids repeated prefix allocation during fluent construction. */
  const steps: IQueryNode['step'][] = []
  for (let current = node; current !== undefined; current = current.previous)
    steps.push(current.step)
  steps.reverse()
  return steps
}

/** Optional pagination transforms the original nodes before ordinary comparator admission. */
function planQuerySteps(
  source: IQuerySourceSnapshot,
  signature: readonly IQueryNode['step'][],
  pageSize?: number
): IQueryNode['step'][] {
  /** No keyset implementation is referenced by the unassembled record constructor. */
  const steps = source.keyset?.plan(source, signature, pageSize) ?? [...signature]
  for (let index = 0; index < steps.length; index++)
    if (
      steps[index]!.operation === QueryOperation.comparator &&
      steps[index + 1]?.operation !== QueryOperation.limit
    )
      throw invalidQueryCondition(undefined, StorageContractErrorText.queryComparatorLimit)
  return steps
}

/** Retains selector orders only when later cardinality or aggregate selection observes identity. */
function queryCountOrders(
  steps: readonly IQueryNode['step'][],
  countOnly: boolean | typeof QueryOperation.aggregate,
  hasAfter: boolean
): Set<IQueryNode['step']> | undefined {
  /** Count drops only selector ordering that cannot change a later row-selection result. */
  const countOrders = countOnly ? new Set<IQueryNode['step']>() : undefined
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
  return countOrders
}

/** Computes one safe native-prefix decision without interpreting user callbacks. */
function queryPushdownReason(
  source: IQuerySourceSnapshot,
  pushdown: IQueryPushdown,
  operations: ReadonlySet<string>,
  operators: ReadonlySet<QueryOperator>,
  hasClient: boolean,
  step: IQueryNode['step']
): string | undefined {
  /** Vector filters/ranking cross payload callbacks; record/RDF retain their safe prefix. */
  const vectorNative =
    source.vector !== undefined &&
    (step.operation === QueryOperation.where ||
      step.operation === QueryOperation.topK ||
      step.operation === QueryOperation.minScore)
  /** A prior client node is a barrier for every subsequent record/RDF operation. */
  return hasClient && !vectorNative
    ? StorageContractErrorText.queryPrefix
    : step.operation === QueryOperation.predicate ||
        step.operation === QueryOperation.mapper ||
        step.operation === QueryOperation.comparator ||
        (step.operation === QueryOperation.order && 'selector' in step) ||
        step.operation === QueryOperation.groupBy ||
        step.operation === QueryOperation.rerank
      ? source.vector !== undefined && step.operation === QueryOperation.predicate
        ? StorageContractErrorText.queryVectorFunction
        : step.operation === QueryOperation.rerank
          ? StorageContractErrorText.queryRerank
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
          ? (queryConditionReason(step.condition, operators) ??
            (pushdown.canPushCondition?.(step.condition) === false
              ? StorageContractErrorText.queryUnsupported
              : undefined))
          : undefined
}

/** Flattens history once and keeps the longest semantically safe native record prefix. */
function planRecordQuery(
  source: IQuerySourceSnapshot,
  node: IQueryNode | undefined,
  countOnly: boolean | typeof QueryOperation.aggregate = false,
  pageSize?: number
): IRecordExecutionPlan {
  /** One flattening supplies both private compatibility facts and actual execution planning. */
  const signature = queryHistory(node)
  /** Pagination reorders only the same original nodes before native/client partitioning. */
  const steps = planQuerySteps(source, signature, pageSize)
  /** Selection follows original structural admission and stays local to this execution plan. */
  const sourcePlan = planRecordSource(source, signature)
  /** Both native/client partition and explain consume this exact support snapshot. */
  const pushdown = sourcePlan?.pushdown ?? source.pushdown
  /** Membership lookups are compiled once per plan, never once per row. */
  const operations = new Set(pushdown.operations)
  /** Field support has the same lifetime as this single execution plan. */
  const operators = new Set(pushdown.operators)
  /** Actual pushed nodes are handed unchanged to the source execution callback. */
  const pushed: IQueryNode['step'][] = []
  /** Client nodes preserve declaration order after the first non-pushable operation. */
  const client: IQueryNode['step'][] = []
  /** Explain exposes independent immutable facts without callbacks or data reads. */
  const pushedSteps: IQueryPlanStep[] = []
  /** A reason is attached to each client step, including later safe-prefix boundaries. */
  const clientSteps: IQueryPlanStep[] = []
  /** Keyset and aggregate consumers keep selector ordering whenever it affects actual row identity. */
  const hasAfter = steps.some((step) => step.operation === QueryOperation.after)
  /** The reverse dependency pass retains only orders required by this terminal. */
  const countOrders = queryCountOrders(steps, countOnly, hasAfter)
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
    /** Native support and the existing safe-prefix boundary own each explain reason. */
    const reason = queryPushdownReason(
      source,
      pushdown,
      operations,
      operators,
      client.length > 0,
      step
    )
    if (reason === undefined) {
      pushed.push(step)
      pushedSteps.push({
        operation: step.operation,
        ...(step.operation === QueryOperation.skip
          ? { reason: StorageContractErrorText.querySkip }
          : {}),
        ...(pushdown.index === undefined ? {} : { index: pushdown.index })
      })
    } else {
      client.push(step)
      clientSteps.push({
        operation: step.operation,
        reason: step.operation === QueryOperation.skip ? StorageContractErrorText.querySkip : reason
      })
    }
  }
  return {
    ...(sourcePlan === undefined ? {} : { sourcePlan }),
    pushed,
    client,
    signature,
    explanation: {
      pushed: pushedSteps,
      client: clientSteps,
      fullScan:
        sourcePlan?.fullScan === true ||
        (source.vector !== undefined
          ? source.vector.exact || pushdown.index === undefined
          : pushdown.index === undefined ||
            ((source.rdf === undefined || Object.keys(source.rdf.pattern).length === 0) &&
              !pushed.some((step) => step.operation === QueryOperation.where))),
      source: pushdown.source,
      ...(sourcePlan?.sourceReason === undefined ? {} : { sourceReason: sourcePlan.sourceReason }),
      ...(sourcePlan?.sourceCandidates === undefined
        ? {}
        : { sourceCandidates: sourcePlan.sourceCandidates }),
      ...(pushdown.index === undefined ? {} : { index: pushdown.index })
    }
  }
}

/** External cancellation is observed around accepted work without abandoning a native cursor. */
function assertQueryActive(ctx: IOperationContext | undefined): void {
  if (ctx?.signal?.aborted)
    throw new StorageContractError(StorageContractErrorCode.aborted, { cause: ctx.signal.reason })
}

/** One pull stays inside the original source operation view supplied for this accepted read. */
export type IQueryAdvance = () => Promise<IteratorResult<readonly [IStorageKey, unknown]>>

/** Each compiled node transforms one upstream pull without owning another cursor or queue. */
export type IQueryReader = (
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

/** A vector node compiles into the existing reader, never another source or lifetime. */
type IVectorReaderCompiler = (
  upstream: IQueryReader,
  ctx: IOperationContext | undefined
) => IQueryReader

/** Family nodes install only their declared reader and reuse the original cleanup owner. */
export type IFamilyReaderCompiler = (
  compiler: IQueryCompileContext,
  step: IRdfQueryTraversal
) => IQueryReader

/** Original topK grouping is compiled only by vector nodes and retains the same Map pass. */
/** Explicit vector reader state shares the original accepted pull and native cursor. */
type IVectorGroupReaderContext = {
  readonly upstream: IQueryReader
  readonly field: string
  readonly perGroup: number
  groups: readonly { readonly group: unknown; readonly hits: readonly unknown[] }[] | undefined
  prepared: Promise<void> | undefined
  emitted: number
}

function compileVectorGroupReader(
  upstream: IQueryReader,
  field: string,
  perGroup: number
): IQueryReader {
  /** Only this node owns preparation and emission state. */
  const context: IVectorGroupReaderContext = {
    upstream,
    field,
    perGroup,
    groups: undefined,
    prepared: undefined,
    emitted: 0
  }
  return (advance, currentScope) => readVectorGroupReader(context, advance, currentScope)
}

/** Prepares this bounded vector stage once without a second resource lifetime. */
async function prepareVectorGroupReader(
  context: IVectorGroupReaderContext,
  advance: IQueryAdvance,
  currentScope?: object
): Promise<void> {
  /** Map uses SameValueZero, preserving number/string/boolean domains and equal zeroes. */
  const grouped = new Map<string | number | boolean, unknown[]>()
  while (true) {
    /** No candidate outside the original engine topK is requested or scored. */
    /** The original context.upstream advance remains accepted through native EOF and cleanup. */
    const next = await context.upstream(advance, currentScope)
    if (next.done) break
    /** Missing or non-scalar own fields do not create a replacement group. */
    const payload = (next.value as IVectorHit<unknown>).payload
    if (typeof payload !== 'object' || payload === null || !Object.hasOwn(payload, context.field))
      continue
    /** The grouping context.field is read once from this accepted hit. */
    const group = Reflect.get(payload, context.field)
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
    else if (hits.length < context.perGroup) hits.push(next.value)
  }
  context.groups = [...grouped].map(([group, hits]) => ({ group, hits }))
}

/** Concurrent reads share preparation while preserving original emission order. */
async function readVectorGroupReader(
  context: IVectorGroupReaderContext,
  advance: IQueryAdvance,
  currentScope?: object
): Promise<Awaited<ReturnType<IQueryReader>>> {
  await (context.prepared ??= prepareVectorGroupReader(context, advance, currentScope))
  return context.emitted === context.groups!.length
    ? { done: true, value: undefined }
    : { done: false, value: context.groups![context.emitted++] }
}

/** The existing reader result carries private ordering metadata between named nodes. */
export type IQueryReadResult = Awaited<ReturnType<IQueryReader>>

/** Shared immutable plan facts grant no new source, queue or lifetime. */
type IQueryReaderOwner = {
  readonly ctx: IOperationContext | undefined
  readonly tieBreakByKey: IRecordQuerySource['tieBreakByKey']
  readonly retainKeys: boolean
  readonly encodeKeys: boolean
}

/** Every node borrows exactly its direct predecessor and accepted operation context. */
export type IQueryReaderInput = {
  readonly upstream: IQueryReader
  readonly ctx: IOperationContext | undefined
}

/** Filtering compiles its membership predicate once and retains no rejected rows. */
type IQueryFilterContext = IQueryReaderInput & {
  readonly predicate: (row: unknown) => boolean
  readonly vector: boolean
}

/** Projection retains its narrowed node and internal key policy. */
type IQueryProjectionContext = IQueryReaderInput & {
  readonly step: Extract<
    IQueryNode['step'],
    { operation: typeof QueryOperation.mapper | typeof QueryOperation.select }
  >
  readonly retainKeys: boolean
}

/** Traversal state borrows one child cursor and original source cleanup callbacks. */
type IQueryTraversalContext = IQueryReaderInput & {
  readonly owner: IQueryReaderOwner
  readonly traversal: IRdfQueryTraversal
  readonly rdfSource: IQuerySourceSnapshot
  readonly upstreamClose: ICompiledQueryReader['close']
  readonly upstreamReport: ICompiledQueryReader['report']
  current: IStorageIterator<readonly [IStorageKey, unknown]> | undefined
  opening: Promise<void> | undefined
  exhausted: boolean
}

/** Offset and bound positions are reserved by their own reader node. */
type IQueryCountContext = IQueryReaderInput & { remaining: number }

/** Distinct membership uses the original SameValueZero set for one accepted reader. */
type IQueryDistinctContext = IQueryReaderInput & {
  readonly seen: Set<unknown>
  readonly step: Extract<IQueryNode['step'], { operation: typeof QueryOperation.distinct }>
}

/** Ordered candidates preserve the original selector tuple and primary-key tail. */
type IOrderedQueryEntry = {
  readonly value: unknown
  readonly key: IStorageKey
  readonly keyBytes: Uint8Array
  readonly ordering: readonly Uint8Array[]
  readonly bytes: Uint8Array
  readonly anchor: unknown
}

/** Concurrent pulls share one selector preparation and consume distinct output positions. */
type IQueryOrderContext = IQueryReaderInput & {
  readonly selectors: readonly Extract<
    IQueryNode['step'],
    { operation: typeof QueryOperation.order }
  >[]
  prepared: Promise<void> | undefined
  ordered: readonly IOrderedQueryEntry[]
  emitted: number
}

/** The explicit comparator bound owns the stable heap and its preparation. */
type IQueryHeapContext = IQueryReaderInput & {
  readonly bound: Extract<IQueryNode['step'], { operation: typeof QueryOperation.limit }>
  readonly compareRows: (left: unknown, right: unknown) => number
  readonly retainKeys: boolean
  readonly tieBreakByKey: IRecordQuerySource['tieBreakByKey']
  readonly heap: IQueryHeapEntry[]
  prepared: Promise<void> | undefined
  emitted: number
}

/** Compilation follows the existing flat plan without factory-captured per-node mutable state. */
export type IQueryCompileContext = {
  readonly owner: IQueryReaderOwner
  readonly steps: readonly IQueryNode['step'][]
  readonly source: IQuerySourceSnapshot | undefined
  readonly comparator: ((left: unknown, right: unknown) => number) | undefined
  readonly vector: boolean
  index: number
  read: IQueryReader
  close: ICompiledQueryReader['close']
  report: ICompiledQueryReader['report']
}

/** Retains source keys only when downstream ordering or awaits require them. */
function captureQueryRow(
  context: IQueryReaderOwner,
  row: readonly [IStorageKey, unknown]
): IQueryReadResult {
  if (!context.retainKeys) return { done: false, value: row[1] }
  /** Retained keys detach before projected value access can mutate any borrowed source objects. */
  const key =
    context.tieBreakByKey === undefined
      ? snapshotStorageKey(row[0], undefined)
      : snapshotQuerySourceKey(row[0], context.tieBreakByKey)
  if (!context.encodeKeys) return { done: false, value: row[1], key }
  /** Author-only key parts retain their independent logical budgets when making a sort tail. */
  const encoded =
    context.tieBreakByKey?.parts === true
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
      context.tieBreakByKey?.direction === QueryKeyDirection.prev
        ? queryDescendingBytes(encoded)
        : encoded
  }
}

/** Runs this named reader stage with explicit state and the original accepted pull. */
async function readQueryLeaf(
  context: IQueryReaderOwner,
  advance: IQueryAdvance
): Promise<IQueryReadResult> {
  assertQueryActive(context.ctx)
  /** Native next settles before any client node or cleanup starts. */
  const next = await advance()
  assertQueryActive(context.ctx)
  return next.done ? { done: true, value: undefined } : captureQueryRow(context, next.value)
}

/** Runs this named reader stage with explicit state and the original accepted pull. */
async function readFilteredQuery(
  context: IQueryFilterContext,
  advance: IQueryAdvance,
  currentScope?: object
): Promise<IQueryReadResult> {
  while (true) {
    /** Filtering discards each rejected row immediately. */
    /** The original context.upstream advance remains accepted through native EOF and cleanup. */
    const next = await context.upstream(advance, currentScope)
    if (next.done) return next
    if (
      context.predicate(context.vector ? (next.value as IVectorHit<unknown>).payload : next.value)
    ) {
      assertQueryActive(context.ctx)
      return next
    }
    assertQueryActive(context.ctx)
  }
}

/** Runs this named reader stage with explicit state and the original accepted pull. */
async function readProjectedQuery(
  context: IQueryProjectionContext,
  advance: IQueryAdvance,
  currentScope?: object
): Promise<IQueryReadResult> {
  /** Projectionconsumes exactly one accepted context.upstream row. */
  /** The original context.upstream advance remains accepted through native EOF and cleanup. */
  const next = await context.upstream(advance, currentScope)
  if (next.done) return next
  if (context.step.operation === QueryOperation.mapper) {
    /** Awaited mapping remains part of the original accepted read. */
    const value = await context.step.mapper(next.value)
    assertQueryActive(context.ctx)
    return !context.retainKeys ? { done: false, value } : { ...next, value }
  }
  /** Own data properties cannot mutate a row prototype, including a selected **proto**. */
  const value: Record<string, unknown> = {}
  for (const field of context.step.fields)
    Object.defineProperty(value, field, {
      enumerable: true,
      configurable: true,
      writable: true,
      value:
        next.value === null || next.value === undefined
          ? undefined
          : Reflect.get(Object(next.value), field)
    })
  return !context.retainKeys ? { done: false, value } : { ...next, value }
}

/** Opens one child match in the original accepted source scope. */
async function openQueryMatch(
  context: IQueryTraversalContext,
  advance: IQueryAdvance,
  currentScope?: object
): Promise<void> {
  while (true) {
    /** The original context.upstream advance remains accepted through native EOF and cleanup. */
    const next = await context.upstream(advance, currentScope)
    if (next.done) {
      context.exhausted = true
      return
    }
    /** Canonical quad positions are read once before another match can start. */
    const { subject, object, graph } = next.value as IQuad
    assertQueryActive(context.ctx)
    if (
      context.traversal.operation === QueryOperation.follow &&
      object.termType !== RdfTermType.namedNode
    )
      continue
    /** The original RDF snapshot owner validates each ground pattern without another term codec. */
    const pattern = snapshotStorageRdfPattern(
      {
        predicate: context.traversal.predicate,
        graph,
        ...(context.traversal.operation === QueryOperation.follow
          ? {
              subject: object as IRdfNamedNode,
              ...(context.traversal.target === undefined
                ? {}
                : { object: context.traversal.target })
            }
          : { object: subject })
      },
      undefined
    )
    assertQueryActive(context.ctx)
    context.current = context.rdfSource.receiver.execute({
      pattern,
      steps: [],
      ctx: context.ctx,
      ...(currentScope === undefined ? {} : { operationScope: currentScope })
    })
    return
  }
}

/** Runs this named reader stage with explicit state and the original accepted pull. */
async function readTraversedQuery(
  context: IQueryTraversalContext,
  advance: IQueryAdvance,
  currentScope?: object
): Promise<IQueryReadResult> {
  while (true) {
    if (context.current === undefined) {
      if (context.exhausted) return { done: true, value: undefined }
      await (context.opening ??= openQueryMatch(context, advance, currentScope).finally(() => {
        context.opening = undefined
      }))
      continue
    }
    /** A settled concurrent EOF cannot close a different later-created child cursor. */
    const child = context.current
    const next = await runTransactionIteratorOperation(child, (next) => next(), currentScope)
    assertQueryActive(context.ctx)
    if (!next.done) return captureQueryRow(context.owner, next.value)
    await child.dispose()
    if (context.current === child) context.current = undefined
  }
}

/** Later-created children clean up first through their same original source owners. */
function closeQueryTraversal(context: IQueryTraversalContext, report: boolean): Promise<void> {
  return completeQueryCleanup(
    context.current === undefined
      ? undefined
      : report
        ? () => context.current![context.rdfSource.asyncDisposeKey!]()
        : () => context.current!.dispose(),
    (report ? context.upstreamReport : context.upstreamClose) ?? (() => Promise.resolve())
  )
}

/** RDF nodes alone retain traversal execution; record-only consumers never import this reader. */
function compileQueryTraversal(
  compiler: IQueryCompileContext,
  step: IRdfQueryTraversal
): IQueryReader {
  if (compiler.source?.rdf === undefined)
    throw invalidQueryCondition(undefined, StorageContractErrorText.queryArgument)
  /** A single child cursor belongs to this explicit traversal state. */
  const context: IQueryTraversalContext = {
    upstream: compiler.read,
    ctx: compiler.owner.ctx,
    owner: compiler.owner,
    traversal: step,
    rdfSource: compiler.source,
    upstreamClose: compiler.close,
    upstreamReport: compiler.report,
    current: undefined,
    opening: undefined,
    exhausted: false
  }
  compiler.close = () => closeQueryTraversal(context, false)
  compiler.report = () => closeQueryTraversal(context, true)
  return (advance, scope) => readTraversedQuery(context, advance, scope)
}

/** Runs this named reader stage with explicit state and the original accepted pull. */
async function readSkippedQuery(
  context: IQueryCountContext,
  advance: IQueryAdvance,
  currentScope?: object
): Promise<IQueryReadResult> {
  while (context.remaining > 0) {
    context.remaining--
    /** EOF stops skipping immediately rather than repeatedly touching an exhausted source. */
    /** The original context.upstream advance remains accepted through native EOF and cleanup. */
    const next = await context.upstream(advance, currentScope)
    if (next.done) return next
  }
  return context.upstream(advance, currentScope)
}

/** Runs this named reader stage with explicit state and the original accepted pull. */
async function readDistinctQuery(
  context: IQueryDistinctContext,
  advance: IQueryAdvance,
  currentScope?: object
): Promise<IQueryReadResult> {
  while (true) {
    /** Only accepted distinctvalues survive downstream bounds and projections. */
    /** The original context.upstream advance remains accepted through native EOF and cleanup. */
    const next = await context.upstream(advance, currentScope)
    if (next.done) return next
    /** Each candidate's selected field is read once; missing and present undefined share a value. */
    const value =
      next.value == null ? undefined : Reflect.get(Object(next.value), context.step.field)
    if (!context.seen.has(value)) {
      context.seen.add(value)
      return next
    }
  }
}

/** Runs selectors once before the canonical radix ordering pass. */
async function prepareQueryOrder(
  context: IQueryOrderContext,
  advance: IQueryAdvance,
  currentScope?: object
): Promise<void> {
  /** Only selector ordering retains unbounded candidates, never scalar reductions. */
  const entries: IOrderedQueryEntry[] = []
  while (true) {
    /** Each native row enters this ordering stage once. */
    /** The original context.upstream advance remains accepted through native EOF and cleanup. */
    const next = await context.upstream(advance, currentScope)
    if (next.done) break
    /** Prior selector stages retain their original keys across filters and bounds. */
    const ordering = [...(next.ordering ?? [])]
    for (const order of context.selectors) {
      if (!('selector' in order)) continue
      /** Invoke the user's opaque selector once, before any later selector can mutate its key. */
      const selector = order.selector
      /** Canonical snapshot/encoding owns all supported key domain validation and ordering. */
      const encoded = encodeOrderedStorageKey(selector(next.value), undefined)
      ordering.push(
        order.direction === QueryOrderDirection.desc ? queryDescendingBytes(encoded) : encoded
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
    assertQueryActive(context.ctx)
  }
  context.ordered = orderStorageKeysByBytes(entries, (entry) => entry.bytes)
}

/** Ordered pulls share one preparation and emit private metadata only to downstream readers. */
async function readOrderedQuery(
  context: IQueryOrderContext,
  advance: IQueryAdvance,
  currentScope?: object
): Promise<IQueryReadResult> {
  await (context.prepared ??= prepareQueryOrder(context, advance, currentScope))
  if (context.emitted === context.ordered.length) return { done: true, value: undefined }
  /** This winner retains its original ordering metadata. */
  const entry = context.ordered[context.emitted++]!
  return {
    done: false,
    value: entry.value,
    anchor: entry.anchor,
    key: entry.key,
    keyBytes: entry.keyBytes,
    ordering: entry.ordering
  }
}

/** Uses the original comparator, source key direction and stable input position. */
function compareQueryHeap(
  context: IQueryHeapContext,
  left: IQueryHeapEntry,
  right: IQueryHeapEntry
): number {
  /** JavaScript comparator NaN and zero both enter the declared tie path. */
  const order = context.compareRows(left.value, right.value)
  if (order) return order
  /** Every keyed candidate carries its one captured original source key through all nodes. */
  const keyOrder = !context.retainKeys ? 0 : compareStorageKeys(left.key!, right.key!)
  return (
    (context.tieBreakByKey?.direction === QueryKeyDirection.prev ? -keyOrder : keyOrder) ||
    left.position - right.position
  )
}

/** Scans once and retains only the caller-bounded stable heap. */
async function prepareQueryHeap(
  context: IQueryHeapContext,
  advance: IQueryAdvance,
  currentScope?: object
): Promise<void> {
  if (context.bound.count === 0) return
  /** Source order is stable even when equal candidates arrive far apart. */
  let position = 0
  while (true) {
    /** Discarded rows become unreachable after this iteration. */
    /** The original context.upstream advance remains accepted through native EOF and cleanup. */
    const next = await context.upstream(advance, currentScope)
    if (next.done) break
    /** Only this candidate and the retained context.heap are live during selection. */
    const entry: IQueryHeapEntry = !context.retainKeys
      ? { value: next.value, position: position++ }
      : {
          value: next.value,
          position: position++,
          key: next.key,
          keyBytes: next.keyBytes,
          ordering: next.ordering,
          anchor: next.anchor
        }
    if (context.heap.length < context.bound.count) {
      context.heap.push(entry)
      /** Appending can violate only this new leaf's ancestor path. */
      let child = context.heap.length - 1
      while (child > 0) {
        /** Integer parent indexing keeps each insertion logarithmic in the explicit context.bound. */
        const parent = Math.floor((child - 1) / 2)
        if (compareQueryHeap(context, context.heap[parent]!, context.heap[child]!) >= 0) break
        ;[context.heap[parent], context.heap[child]] = [context.heap[child]!, context.heap[parent]!]
        child = parent
      }
    } else if (compareQueryHeap(context, entry, context.heap[0]!) < 0) {
      context.heap[0] = entry
      queryHeapSiftDown(context.heap, context.heap.length, (left, right) =>
        compareQueryHeap(context, left, right)
      )
    }
    assertQueryActive(context.ctx)
  }
  for (let end = context.heap.length - 1; end > 0; end--) {
    ;[context.heap[0], context.heap[end]] = [context.heap[end]!, context.heap[0]!]
    queryHeapSiftDown(context.heap, end, (left, right) => compareQueryHeap(context, left, right))
  }
}

/** Runs this named reader stage with explicit state and the original accepted pull. */
async function readHeapQuery(
  context: IQueryHeapContext,
  advance: IQueryAdvance,
  currentScope?: object
): Promise<IQueryReadResult> {
  await (context.prepared ??= prepareQueryHeap(context, advance, currentScope))
  if (context.emitted >= context.heap.length) return { done: true, value: undefined }
  /** A bounded winner keeps its key available to later compiled reader nodes. */
  const entry = context.heap[context.emitted++]!
  return !context.retainKeys
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

/** Bound reservations happen before awaiting, preserving concurrent pull admission. */
async function readLimitedQuery(
  context: IQueryCountContext,
  advance: IQueryAdvance,
  currentScope?: object
): Promise<IQueryReadResult> {
  return context.remaining-- > 0
    ? context.upstream(advance, currentScope)
    : { done: true, value: undefined }
}

/** Installs one named node and consumes adjacent selector or comparator-bound nodes together. */
function compileQueryNode(compiler: IQueryCompileContext): IQueryReader {
  /** This node borrows its immediate predecessor. */
  const upstream = compiler.read
  /** Plan admission and explanation use this same original node. */
  const step = compiler.steps[compiler.index]!
  /** Context belongs to the original accepted operation. */
  const ctx = compiler.owner.ctx
  if (step.operation === QueryOperation.where || step.operation === QueryOperation.predicate) {
    /** Membership sets compile before native reading. */
    const context: IQueryFilterContext = {
      upstream,
      ctx,
      vector: compiler.vector,
      predicate:
        step.operation === QueryOperation.where
          ? compileQueryCondition<unknown>(step.condition)
          : step.predicate
    }
    return (advance, scope) => readFilteredQuery(context, advance, scope)
  }
  if (step.operation === QueryOperation.mapper || step.operation === QueryOperation.select) {
    /** Projection borrows its declared fields or callback. */
    const context: IQueryProjectionContext = {
      upstream,
      ctx,
      step,
      retainKeys: compiler.owner.retainKeys
    }
    return (advance, scope) => readProjectedQuery(context, advance, scope)
  }
  if (step.operation === QueryOperation.follow || step.operation === QueryOperation.inverse) {
    return step.compile(compiler, step)
  }
  if (step.operation === QueryOperation.after) {
    return step.compile(compiler)
  }
  if (step.operation === QueryOperation.skip || step.operation === QueryOperation.limit) {
    /** Reservations belong to this node alone. */
    const context: IQueryCountContext = { upstream, ctx, remaining: step.count }
    return step.operation === QueryOperation.skip
      ? (advance, scope) => readSkippedQuery(context, advance, scope)
      : (advance, scope) => readLimitedQuery(context, advance, scope)
  }
  if (step.operation === QueryOperation.distinct) {
    /** SameValueZero membership lasts only for this accepted reader. */
    const context: IQueryDistinctContext = { upstream, ctx, step, seen: new Set() }
    return (advance, scope) => readDistinctQuery(context, advance, scope)
  }
  if (step.operation === QueryOperation.order) {
    /** Consecutive refinements form one canonical radix pass. */
    const selectors = [step]
    while (compiler.steps[compiler.index + 1]?.operation === QueryOperation.order)
      selectors.push(compiler.steps[++compiler.index] as typeof step)
    /** Concurrent pulls share initialization and reserve separate outputs. */
    const context: IQueryOrderContext = {
      upstream,
      ctx,
      selectors,
      prepared: undefined,
      ordered: [],
      emitted: 0
    }
    return (advance, scope) => readOrderedQuery(context, advance, scope)
  }
  if (step.operation === QueryOperation.groupBy || step.operation === QueryOperation.rerank)
    return step.compile(upstream, ctx)
  if (step.operation === QueryOperation.comparator) {
    /** Admission already proved this immediately following bound. */
    const bound = compiler.steps[++compiler.index] as IQueryHeapContext['bound']
    /** Only bounded candidates and original stable tie keys survive the scan. */
    const context: IQueryHeapContext = {
      upstream,
      ctx,
      bound,
      compareRows: step.compare,
      retainKeys: compiler.owner.retainKeys,
      tieBreakByKey: compiler.owner.tieBreakByKey,
      heap: [],
      prepared: undefined,
      emitted: 0
    }
    return (advance, scope) => readHeapQuery(context, advance, scope)
  }
  throw invalidQueryCondition(undefined, StorageContractErrorText.queryArgument)
}

/** Compiles the existing client plan once; stateful readers use explicit module context owners. */
function compileRecordQueryReader(
  steps: readonly IQueryNode['step'][],
  ctx: IOperationContext | undefined,
  tieBreakByKey: IRecordQuerySource['tieBreakByKey'],
  vector = false,
  metadata = false,
  comparator?: (left: unknown, right: unknown) => number,
  source?: IQuerySourceSnapshot
): ICompiledQueryReader {
  /** Selector ordering needs the same original primary-key tail as comparator metadata. */
  const selectorOrdering = steps.some((step) => step.operation === QueryOperation.order)
  /** Source keys are retained only for actual downstream ordering and cursor consumers. */
  const owner: IQueryReaderOwner = {
    ctx,
    tieBreakByKey,
    retainKeys:
      metadata ||
      selectorOrdering ||
      tieBreakByKey !== undefined ||
      steps.some((step) => step.operation === QueryOperation.after),
    encodeKeys:
      selectorOrdering || metadata || steps.some((step) => step.operation === QueryOperation.after)
  }
  /** Compilation replaces per-node captured mutable variables with named explicit contexts. */
  const compiler: IQueryCompileContext = {
    owner,
    steps,
    source,
    comparator,
    vector,
    index: 0,
    read: (advance) => readQueryLeaf(owner, advance),
    close: undefined,
    report: undefined
  }
  for (; compiler.index < steps.length; compiler.index++) compiler.read = compileQueryNode(compiler)
  return {
    close: compiler.close,
    report: compiler.report,
    read: (advance, scope) => readCompiledQuery(compiler, metadata, advance, scope)
  }
}

/** Every terminal observes cancellation and public rows omit private ordering metadata. */
async function readCompiledQuery(
  compiler: IQueryCompileContext,
  metadata: boolean,
  advance: IQueryAdvance,
  currentScope?: object
): Promise<IQueryReadResult> {
  assertQueryActive(compiler.owner.ctx)
  /** The original node chain retains no accepted view after this pull settles. */
  const next = await compiler.read(advance, currentScope)
  assertQueryActive(compiler.owner.ctx)
  return metadata || !compiler.owner.retainKeys || next.done
    ? next
    : { done: false, value: next.value }
}

/** Checks the captured intent before any native source is invoked. */
function assertQueryExecution(
  source: IQuerySourceSnapshot,
  plan: IRecordExecutionPlan,
  strict: boolean,
  ctx: IOperationContext | undefined
): void {
  source.keyset?.assertMatches(source, plan, ctx)
  /** Ranking and traversal cannot be emulated by the ordinary row reader. */
  const requiredNative = plan.client.some(
    (step) => step.operation === QueryOperation.topK || step.operation === QueryOperation.minScore
  )
  if ((strict && plan.client.length > 0) || requiredNative)
    throw new StorageContractError(
      StorageContractErrorCode.queryNotPushable,
      {},
      StorageContractErrorText.queryNotPushable(plan.explanation.client.map((step) => step.reason!))
    )
  assertQueryActive(ctx)
}

/** Captures caller intent once before reads can await native I/O or callback work. */
function prepareQueryExecution(
  source: IQuerySourceSnapshot,
  plan: IRecordExecutionPlan,
  strict: boolean,
  ctx: IOperationContext | undefined
): IOperationContext | undefined {
  /** Scalar context choices remain stable while the original signal continues to carry cancellation. */
  const captured = snapshotOperationContext(ctx)
  assertQueryExecution(source, plan, strict, captured)
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
  return steps.map((step) => {
    if (step.operation === QueryOperation.follow || step.operation === QueryOperation.inverse) {
      /** Native authors receive traversal data only, never the private client reader compiler. */
      const { compile: _compile, ...traversal } = step
      return traversal
    }
    if (step.operation === QueryOperation.after) return step.native(source)
    return { ...step } as IQueryNativeStep | IRdfQueryTraversal
  })
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
  const conditions = plan.pushed.flatMap((step) =>
    step.operation === QueryOperation.where ? [step.condition] : []
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
      ...(source.vector.native === undefined ? {} : { native: source.vector.native.native }),
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
      ...(plan.sourcePlan?.selection === undefined ? {} : { selection: plan.sourcePlan.selection }),
      ...(source.nativeSteps
        ? { steps: nativeQuerySteps(source, plan.pushed) as readonly IQueryNativeStep[] }
        : {})
    }
  return input
}

/** A new client stage borrows only the provider's existing accepted-work lease. */
function beginVectorQueryOperation(source: IQuerySourceSnapshot): (() => void) | undefined {
  if (!source.vector?.reranked || source.vector.beginOperation === undefined) return undefined
  try {
    const release = source.vector.beginOperation()
    if (typeof release !== 'function')
      throw invalidQueryCondition(undefined, StorageContractErrorText.queryArgument)
    return release
  } catch (cause) {
    throw queryExecutionFailure(cause)
  }
}

/** Original lease cleanup preserves an earlier query failure through the existing error owner. */
function releaseVectorQueryOperation(
  release: (() => void) | undefined,
  primary?: { readonly error: unknown }
): void {
  try {
    release?.()
  } catch (cause) {
    const cleanup = queryExecutionFailure(cause)
    throw primary === undefined
      ? cleanup
      : queryExecutionFailure(attachSecondaryErrors(primary.error, [cleanup]))
  }
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
  retainKeys = false,
  holdOperation = false
): {
  readonly release?: () => void
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
  /** An original write owner can reuse pre-I/O admission without another context snapshot. */
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
  /** Only the new reranked terminal borrows the existing provider lease after pure admission. */
  const release = holdOperation ? beginVectorQueryOperation(source) : undefined
  try {
    /** The same native compiler is shared with direct native subscriptions. */
    const input = querySourceInput(source, plan, captured)
    return {
      release,
      iterator:
        reduction === undefined
          ? source.receiver.execute(input)
          : source.receiver.reduce!({ ...input, reduction: reduction.request }),
      read,
      close,
      report,
      ctx: captured,
      signature: plan.signature,
      mapper
    }
  } catch (cause) {
    const primary = queryExecutionFailure(cause)
    releaseVectorQueryOperation(release, { error: primary })
    throw primary
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
    mapper,
    release
  } = openRecordQuery(
    source,
    node,
    strict,
    ctx,
    countOnly,
    pageSize,
    reduction,
    prepared,
    retainKeys,
    true
  )
  /** A boxed failure also distinguishes a deliberately thrown undefined from success. */
  let primary: { readonly error: unknown } | undefined
  try {
    /** Omitted/new-unused lease hooks preserve the original direct Promise adoption path. */
    const pending = runTransactionIteratorOperation(
      iterator,
      async (advance, fail, currentScope) => {
        /**
         * The terminal's scalar, bounded chunk or explicit all result stays inside the same
         * operation.
         */
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
      }
    )
    return release === undefined ? pending : await pending
  } catch (error) {
    primary = { error }
    throw error
  } finally {
    releaseVectorQueryOperation(release, primary)
  }
}

/** Captures write-only policy once while the existing context owner retains all other admission. */
function queryWriteContext(
  ctx: (IOperationContext & IWriteConcurrencyOptions) | undefined
): Pick<IQueryDelete, 'ctx' | 'concurrency'> {
  /** Context scalar fields are captured before the write owner can await. */
  const captured = snapshotOperationContext(ctx)
  if (ctx === undefined) return { ctx: captured }
  /** Concurrency is a typed author definition and does not belong to the scalar context snapshot. */
  const concurrency = ctx.concurrency
  if (concurrency !== undefined) assertConcurrencyPolicy(concurrency)
  return { ctx: captured, ...(concurrency === undefined ? {} : { concurrency }) }
}

/** A patch is detached at the terminal before its original backend transaction can start. */
function snapshotQueryPatch(patch: unknown): Readonly<Partial<Record<string, unknown>>> {
  try {
    if (typeof patch !== 'object' || patch === null || Array.isArray(patch))
      throw new TypeError(StorageContractErrorText.queryArgument)
    /** The original snapshot owner detaches data; the actual backend codec retains value admission. */
    const captured = immutableSnapshot(patch)
    return captured as Record<string, unknown>
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
  const ctx = request.ctx
  assertQueryExecution(source, plan, strict, ctx)
  /** Replacement identity uses the original admitted RDF encoder, never source-key spellings. */
  const replaced =
    request.operation === RdfQueryMethod.replace
      ? storageKeyBytesIdentity(encodeRdfQuadSnapshot(request.oldQuad))
      : undefined
  try {
    return await source.receiver.mutate!(
      request,
      async (port: IQueryMutationPort<IRecordQueryInput, unknown>) => {
        /** A native owner supplies exactly these two functions once per actual write attempt. */
        const { execute, accept } = port
        if (typeof execute !== 'function' || typeof accept !== 'function')
          throw invalidQueryCondition(undefined, StorageContractErrorText.queryArgument)
        /** The captured source facts stay fixed while I/O borrows the actual transaction receiver. */
        const scoped = { ...source, execute, receiver: port as unknown as IQuerySourcePort }
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
              const accepted = await port.accept(next.key!, value)
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
    )
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
/** Read terminals share one explicit query definition while original source resources own execution. */
class RecordQueryReads<R, TContext extends IOperationContext | undefined>
  implements IQueryRead<R, TContext>, IQueryStatistics<R, TContext>, IQueryPages<R, TContext>
{
  /** Original source facts and callbacks are borrowed without another native reader owner. */
  readonly #source: IQuerySourceSnapshot
  /** Persistent query history is shared without copying previous branch nodes. */
  readonly #node: IQueryNode | undefined
  /** Strictness applies to the real source plan and client terminal admission. */
  readonly #strict: boolean
  /** Comparator.first alone adds its established one-row retained bound. */
  readonly #firstNode: IQueryNode | undefined
  /** Admit no I/O; terminals retain only this query’s source, history and pushdown intent. */
  constructor(source: IQuerySourceSnapshot, node: IQueryNode | undefined, strict: boolean) {
    this.#source = source
    this.#node = node
    this.#strict = strict
    this.#firstNode =
      this.#node?.step.operation === QueryOperation.comparator
        ? { previous: this.#node, step: { operation: QueryOperation.limit, count: 1 } }
        : this.#node
  }
  /** Reject a client-only terminal when the current query requires complete native pushdown. */
  #assertClientTerminal(): void {
    if (this.#strict)
      throw new StorageContractError(
        StorageContractErrorCode.queryNotPushable,
        {},
        StorageContractErrorText.queryNotPushable([StorageContractErrorText.queryUnsupported])
      )
  }
  /** Select a real supported scalar cursor after planning the complete original query. */
  #nativeReduction(
    request: IQueryReduction,
    ctx: TContext | undefined
  ): { readonly native?: Promise<IQueryReductionResult>; readonly plan?: IRecordExecutionPlan } {
    if (
      this.#source.reduce === undefined ||
      (this.#source.plan === undefined &&
        !this.#source.pushdown.operations.includes(request.operation))
    )
      return {}
    /** The original planner drops only irrelevant output/order nodes for the requested reduction. */
    const countOnly =
      request.operation === QueryOperation.aggregate
        ? QueryOperation.aggregate
        : request.operation === QueryOperation.count
    const plan = planRecordQuery(this.#source, this.#node, countOnly)
    if (
      plan.client.length > 0 ||
      !(plan.sourcePlan?.pushdown ?? this.#source.pushdown).operations.includes(request.operation)
    )
      return this.#source.plan === undefined ? {} : { plan }
    return {
      plan,
      native: consumeRecordQuery<IQueryReductionResult, IQueryReductionResult>(
        this.#source,
        this.#node,
        this.#strict,
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
  }
  /** Reuse the original prepared plan and one admitted operation context for a client fallback. */
  readonly #prepareFallback = (
    plan: IRecordExecutionPlan | undefined,
    ctx: TContext | undefined
  ): IPreparedQueryExecution | undefined =>
    plan === undefined
      ? undefined
      : {
          plan,
          ctx: prepareQueryExecution(this.#source, plan, this.#strict, ctx)
        }
  /** Preserve presence and the implicit comparator first bound through the original reader. */
  readonly #first = (ctx?: TContext, planned?: IRecordExecutionPlan): Promise<IteratorResult<R>> =>
    consumeRecordQuery<R, IteratorResult<R>>(
      this.#source,
      this.#firstNode,
      this.#strict,
      ctx,
      (read) => read(),
      false,
      undefined,
      undefined,
      this.#prepareFallback(planned, ctx)
    )
  /** Accumulate numeric values through the same original source and accepted cursor lifetime. */
  async #aggregate(
    operation:
      | typeof RecordQueryMethod.min
      | typeof RecordQueryMethod.max
      | typeof RecordQueryMethod.sum
      | typeof RecordQueryMethod.avg,
    field: string,
    ctx?: TContext
  ): Promise<number | IMaybe<number>> {
    assertQueryField(field)
    const { native, plan } = this.#nativeReduction(
      { operation: QueryOperation.aggregate, aggregate: operation, field },
      ctx
    )
    if (native !== undefined) return native as Promise<number | IMaybe<number>>
    this.#assertClientTerminal()
    return consumeRecordQuery<R, number | IMaybe<number>>(
      this.#source,
      this.#node,
      this.#strict,
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
      QueryOperation.aggregate,
      undefined,
      undefined,
      this.#prepareFallback(plan, ctx)
    )
  }
  /** An explicitly selected keyset owner borrows this same terminal execution. */
  readonly page: IQueryPages<R, TContext>['page'] = async (size, ctx) => {
    if (this.#source.keyset === undefined) return this.#source.missingKeyset!()
    return this.#source.keyset.page<R, TContext>(this.#source, this.#node, this.#strict, size, ctx)
  }
  /** The all terminal stays inside this query’s original planner, cursor and error owner. */
  readonly all: IQueryRead<R, TContext>['all'] = (ctx) =>
    consumeRecordQuery<R, R[]>(this.#source, this.#node, this.#strict, ctx, async (read) => {
      /** Only the explicit all terminal retains all accepted rows. */
      const rows: R[] = []
      while (true) {
        /** Rows come from the same lazy reader exposed by stream. */
        const next = await read()
        if (next.done) return rows
        rows.push(next.value)
      }
    })
  /** The first terminal stays inside this query’s original planner, cursor and error owner. */
  readonly first: IQueryRead<R, TContext>['first'] = async (ctx) => {
    /** A present undefined value intentionally collapses only at this terminal. */
    const next = await this.#first(ctx)
    return next.done ? undefined : next.value
  }
  /** The maybe terminal stays inside this query’s original planner, cursor and error owner. */
  readonly maybe: IQueryRead<R, TContext>['maybe'] = async (ctx) => {
    /** The discriminant preserves presence independently of payload value. */
    const next = await this.#first(ctx)
    return next.done ? { some: false } : { some: true, value: next.value }
  }
  /** The firstOrThrow terminal stays inside this query’s original planner, cursor and error owner. */
  readonly firstOrThrow: IQueryRead<R, TContext>['firstOrThrow'] = async (ctx) => {
    /** Cleanup finishes before the empty-result error crosses the package boundary. */
    const next = await this.#first(ctx)
    if (next.done)
      throw new StorageContractError(
        StorageContractErrorCode.queryEmptyResult,
        {},
        StorageContractErrorText.queryEmptyResult
      )
    return next.value
  }
  /** The exists terminal stays inside this query’s original planner, cursor and error owner. */
  readonly exists: IQueryRead<R, TContext>['exists'] = async (ctx) => {
    const { native, plan } = this.#nativeReduction({ operation: QueryOperation.exists }, ctx)
    return native === undefined ? !(await this.#first(ctx, plan)).done : ((await native) as boolean)
  }
  /** The count terminal stays inside this query’s original planner, cursor and error owner. */
  readonly count: IQueryRead<R, TContext>['count'] = async (ctx) => {
    const { native, plan } = this.#nativeReduction({ operation: QueryOperation.count }, ctx)
    if (native !== undefined) return native as Promise<number>
    this.#assertClientTerminal()
    return consumeRecordQuery<R, number>(
      this.#source,
      this.#node,
      this.#strict,
      ctx,
      async (read) => {
        /** Cardinality retains no accepted row and never requests output-only planner nodes. */
        let count = 0
        while (!(await read()).done) count++
        return count
      },
      true,
      undefined,
      undefined,
      this.#prepareFallback(plan, ctx)
    )
  }
  /** The pluck terminal stays inside this query’s original planner, cursor and error owner. */
  readonly pluck: IQueryRead<R, TContext>['pluck'] = async (field, ctx) => {
    assertQueryField(field)
    /** Pluck uses the existing field-projection node, including native projection when declared. */
    const projection: IQueryNode = {
      previous: this.#node,
      step: { operation: QueryOperation.select, fields: [field] }
    }
    return consumeRecordQuery<R, R[typeof field][]>(
      this.#source,
      projection,
      this.#strict,
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
  }
  /** The each terminal stays inside this query’s original planner, cursor and error owner. */
  readonly each: IQueryRead<R, TContext>['each'] = async (fn, ctx) => {
    if (typeof fn !== 'function')
      throw invalidQueryCondition(undefined, StorageContractErrorText.queryArgument)
    this.#assertClientTerminal()
    return consumeRecordQuery<R, number>(
      this.#source,
      this.#node,
      this.#strict,
      ctx,
      async (read, captured) => {
        /** The next original row is requested only after this callback completes. */
        let count = 0
        while (true) {
          /** The callback belongs to the terminal's already accepted transaction operation. */
          const next = await read()
          if (next.done) return count
          await fn(next.value, count++)
          assertQueryActive(captured)
        }
      }
    )
  }
  /** The chunk terminal stays inside this query’s original planner, cursor and error owner. */
  readonly chunk: IQueryRead<R, TContext>['chunk'] = async (size, fn, ctx) => {
    if (!Number.isSafeInteger(size) || size <= 0)
      throw invalidQueryCondition(undefined, StorageContractErrorText.queryChunk)
    if (typeof fn !== 'function')
      throw invalidQueryCondition(undefined, StorageContractErrorText.queryArgument)
    this.#assertClientTerminal()
    return consumeRecordQuery<R, number>(
      this.#source,
      this.#node,
      this.#strict,
      ctx,
      async (read, captured) => {
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
      }
    )
  }
  /** The min terminal stays inside this query’s original planner, cursor and error owner. */
  readonly min: IQueryStatistics<R, TContext>['min'] = (field, ctx) =>
    this.#aggregate(RecordQueryMethod.min, field, ctx) as Promise<
      IMaybe<NonNullable<R[typeof field]>>
    >
  /** The max terminal stays inside this query’s original planner, cursor and error owner. */
  readonly max: IQueryStatistics<R, TContext>['max'] = (field, ctx) =>
    this.#aggregate(RecordQueryMethod.max, field, ctx) as Promise<
      IMaybe<NonNullable<R[typeof field]>>
    >
  /** The sum terminal stays inside this query’s original planner, cursor and error owner. */
  readonly sum: IQueryStatistics<R, TContext>['sum'] = (field, ctx) =>
    this.#aggregate(RecordQueryMethod.sum, field, ctx) as Promise<number>
  /** The avg terminal stays inside this query’s original planner, cursor and error owner. */
  readonly avg: IQueryStatistics<R, TContext>['avg'] = (field, ctx) =>
    this.#aggregate(RecordQueryMethod.avg, field, ctx) as Promise<IMaybe<number>>
  /** The stream terminal stays inside this query’s original planner, cursor and error owner. */
  readonly stream: IQueryRead<R, TContext>['stream'] = (ctx) =>
    streamRecordQuery<R>(this.#source, this.#node, this.#strict, ctx)
  /** The explain terminal stays inside this query’s original planner, cursor and error owner. */
  readonly explain: IQueryRead<R, TContext>['explain'] = () =>
    planRecordQuery(this.#source, this.#node).explanation
}

function recordQueryReads<R, TContext extends IOperationContext | undefined>(
  source: IQuerySourceSnapshot,
  node: IQueryNode | undefined,
  strict: boolean
): IQueryRead<R, TContext> & IQueryStatistics<R, TContext> & IQueryPages<R, TContext> {
  return new RecordQueryReads<R, TContext>(source, node, strict)
}

/** A mapped stream borrows the original cursor and its sole canonical lifetime. */
class RecordQueryStream<R> {
  /** The source retains native timing, transaction and vector-operation authority. */
  readonly #source: IQuerySourceSnapshot
  /** The original native iterator remains the only cursor resource. */
  readonly #iterator: ReturnType<typeof openRecordQuery>['iterator']
  /** One compiled reader owns the same accepted mapping and traversal stages. */
  readonly #read: IQueryReader
  /** Traversal cleanup delegates to original source owners. */
  readonly #close: ICompiledQueryReader['close']
  /** Symbolic traversal cleanup delegates to those same owners' diagnostics. */
  readonly #report: ICompiledQueryReader['report']
  /** Only the first accepted pull can invoke the original asynchronous vector scorer. */
  #first = true

  /** Opens only the original source and compiles the existing client stages. */
  constructor(
    source: IQuerySourceSnapshot,
    node: IQueryNode | undefined,
    strict: boolean,
    ctx: IOperationContext | undefined
  ) {
    this.#source = source
    const opened = openRecordQuery(source, node, strict, ctx)
    this.#iterator = opened.iterator
    this.#read = opened.read
    this.#close = opened.close
    this.#report = opened.report
  }
  /** Keeps accepted mapping and failure-before-cleanup inside the original transaction operation. */
  readonly #accepted = async (
    advance: IQueryAdvance,
    fail: (error: unknown) => unknown,
    currentScope: object | undefined
  ): Promise<IteratorResult<R>> => {
    let release: (() => void) | undefined
    /** Preserve the actual error after original source cleanup if release also fails. */
    let primary: { readonly error: unknown } | undefined
    try {
      try {
        if (this.#first) {
          this.#first = false
          release = beginVectorQueryOperation(this.#source)
        }
        return (await this.#read(advance, currentScope)) as IteratorResult<R>
      } catch (cause) {
        return await failedRecordQuery(this.#iterator, fail, cause, this.#close)
      }
    } catch (error) {
      primary = { error }
      throw error
    } finally {
      releaseVectorQueryOperation(release, primary)
    }
  }

  /** Publishes the original derived transaction iterator or a root mapping over the same lifetime. */
  build(): IStorageIterator<R> {
    /** Registered sources retain full mapped-next and buffered-result scope ownership. */
    const derived = deriveTransactionIterator(this.#iterator, this.#accepted, this.#close)
    if (derived) return derived
    /** The mapped root retains the original backend's canonical resource key. */
    const asyncDisposeKey: typeof Symbol.asyncDispose = this.#source.asyncDisposeKey!
    /** Root mapping reuses the same canonical accepted-advance drain as transaction resources. */
    const lifetime = createStorageIteratorLifetime<R>({
      close: () => completeQueryCleanup(this.#close, () => this.#iterator.dispose()),
      report: () => completeQueryCleanup(this.#report, () => this.#iterator[asyncDisposeKey]())
    })
    return {
      next: () =>
        lifetime.advance(() =>
          runTransactionIteratorOperation(this.#iterator, async (advance, fail, currentScope) =>
            lifetime.isClosing()
              ? { done: true, value: undefined }
              : this.#accepted(advance, fail, currentScope)
          )
        ),
      return: lifetime.returned,
      dispose: lifetime.dispose,
      [asyncDisposeKey]: lifetime.symbolic,
      [Symbol.asyncIterator]() {
        return this
      }
    }
  }
}

/** Streams the same client reader without adding a native cursor, queue or lifecycle owner. */
function streamRecordQuery<R>(
  source: IQuerySourceSnapshot,
  node: IQueryNode | undefined,
  strict: boolean,
  ctx: IOperationContext | undefined
): IStorageIterator<R> {
  return new RecordQueryStream<R>(source, node, strict, ctx).build()
}

/** Captures an immutable string projection before creating another chain node. */
function snapshotQueryFields(fields: readonly unknown[]): readonly string[] {
  if (fields.length === 0 || fields.some((field) => typeof field !== 'string'))
    throw invalidQueryCondition(undefined, StorageContractErrorText.queryArgument)
  return fields as string[]
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
        return source.receiver.watch!(querySourceInput(source, plan, captured))
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
  return {
    ...methods,
    ...familyQueryReads<R, TContext>(source, node, strict),
    ...(source.vector?.reranked || source.vector?.native !== undefined
      ? {}
      : {
          ...queryWatch(source, node),
          requirePushdown: () =>
            selectedRecordQuery<R, TContext, TAugmentMethods>(source, node, true, methods)
        })
  } as IQueryResult<R, TContext, true, TAugmentMethods>
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
      const path = parseObjectPath(args[0]).map(String)
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
/** A fluent record branch owns only its source, persistent history and pure method definition. */
class RecordQueryBranch<
  T,
  TContext extends IOperationContext | undefined,
  TAugmentMethods extends object
> {
  /** Execution stays with the original source; this branch opens no native resource. */
  readonly #source: IQuerySourceSnapshot
  /** An appended branch retains the same immutable predecessor instead of cloning history. */
  readonly #node: IQueryNode | undefined
  /** Strict native pushdown is query intent consumed by the same original planner. */
  readonly #strict: boolean
  /** Pure Feature functions retain identity and use the actual published branch as receiver. */
  readonly #methods: TAugmentMethods | undefined
  /** Selector/comparator states remain mutually exclusive on the runtime facade. */
  readonly #ordering: 'selector' | 'comparator' | undefined
  /** Retain branch configuration without starting I/O or another lifetime. */
  constructor(
    source: IQuerySourceSnapshot,
    node: IQueryNode | undefined,
    strict: boolean,
    methods: TAugmentMethods | undefined,
    ordering?: 'selector' | 'comparator'
  ) {
    this.#source = source
    this.#node = node
    this.#strict = strict
    this.#methods = methods
    this.#ordering = ordering
  }
  /** Append one admitted condition node while sharing all prior history. */
  readonly #where = (...args: readonly unknown[]): IRecordQuery<T, TContext, TAugmentMethods> => {
    /** Family dispatch shares the canonical condition/path snapshot. */
    const step = snapshotQueryWhere(args)
    return recordQuery(
      this.#source,
      { previous: this.#node, step },
      this.#strict,
      this.#methods,
      this.#ordering
    )
  }
  /** Preserve the single projection transition without granting another select terminal. */
  readonly #select = (
    ...args: readonly unknown[]
  ): IQueryResult<unknown, TContext, true, TAugmentMethods> => {
    /** A function is an opaque mapper; it is never parsed or presented as native projection. */
    const step: IQueryNode['step'] =
      args.length === 1 && typeof args[0] === 'function'
        ? { operation: QueryOperation.mapper, mapper: args[0] as (row: unknown) => unknown }
        : { operation: QueryOperation.select, fields: snapshotQueryFields(args) }
    return selectedRecordQuery(
      this.#source,
      { previous: this.#node, step },
      this.#strict,
      this.#methods
    )
  }
  /** Publish finite fluent commands backed by this named branch owner. */
  build(): IRecordQuery<T, TContext, TAugmentMethods> {
    return {
      ...this.#methods,
      /** Limit is an immutable streaming node; zero requires no candidate advance. */
      limit: (count: number) => {
        if (!Number.isSafeInteger(count) || count < 0)
          throw invalidQueryCondition(undefined, StorageContractErrorText.queryLimit)
        return recordQuery<T, TContext, TAugmentMethods>(
          this.#source,
          { previous: this.#node, step: { operation: QueryOperation.limit, count } },
          this.#strict,
          this.#methods,
          this.#ordering
        )
      },
      /** Distinct values retain the first row in this stage's current order. */
      distinct: (field: string) => {
        assertQueryField(field)
        return recordQuery<T, TContext, TAugmentMethods>(
          this.#source,
          { previous: this.#node, step: { operation: QueryOperation.distinct, field } },
          this.#strict,
          this.#methods,
          this.#ordering
        )
      },
      /** Offset is explicit linear work; native execution requires the source's finite opt-in. */
      skip: (count: number) => {
        if (!Number.isSafeInteger(count) || count < 0)
          throw invalidQueryCondition(undefined, StorageContractErrorText.queryLimit)
        return recordQuery<T, TContext, TAugmentMethods>(
          this.#source,
          { previous: this.#node, step: { operation: QueryOperation.skip, count } },
          this.#strict,
          this.#methods,
          this.#ordering
        )
      },
      after: (cursor: IQueryCursor) => {
        return recordQuery<T, TContext, TAugmentMethods>(
          this.#source,
          {
            previous: this.#node,
            step: this.#source.keyset?.after(cursor) ?? this.#source.missingKeyset!()
          },
          this.#strict,
          this.#methods,
          this.#ordering
        )
      },
      /**
       * Selector refinements use canonical byte ordering and preserve the original primary-key
       * tail.
       */
      orderBy: (selector: (row: T) => IStorageKey, direction?: 'asc' | 'desc') => {
        if (this.#ordering === QueryOrderMode.comparator)
          throw invalidQueryCondition(undefined, StorageContractErrorText.queryArgument)
        return recordQuery<T, TContext, TAugmentMethods>(
          this.#source,
          { previous: this.#node, step: snapshotQueryOrder(selector, direction) },
          this.#strict,
          this.#methods,
          QueryOrderMode.selector
        )
      },
      /** Comparator state cannot execute until the next node supplies its bounded heap size. */
      ...(this.#ordering === QueryOrderMode.selector
        ? {}
        : {
            orderByComparator: (compare: (left: T, right: T) => number) => {
              if (typeof compare !== 'function')
                throw invalidQueryCondition(
                  undefined,
                  StorageContractErrorText.queryComparatorLimit
                )
              return recordQuery<T, TContext, TAugmentMethods>(
                this.#source,
                {
                  previous: this.#node,
                  step: {
                    operation: QueryOperation.comparator,
                    compare: compare as (left: unknown, right: unknown) => number
                  }
                },
                this.#strict,
                this.#methods,
                QueryOrderMode.comparator
              )
            }
          }),
      where: this.#where,
      select: this.#select,
      /** Actual record writes remain inside the backend's original pipeline and transaction. */
      delete: (ctx?: IQueryWriteContext<TContext>) =>
        mutateRecordQuery(this.#source, this.#node, this.#strict, {
          operation: RecordQueryMethod.delete,
          ...queryWriteContext(ctx)
        }),
      update: (patch: Partial<T>, ctx?: IQueryWriteContext<TContext>) =>
        mutateRecordQuery(this.#source, this.#node, this.#strict, {
          operation: RecordQueryMethod.update,
          patch: snapshotQueryPatch(patch),
          ...queryWriteContext(ctx)
        }),
      ...recordQueryReads<T, TContext>(this.#source, this.#node, this.#strict),
      ...queryWatch(this.#source, this.#node),
      requirePushdown: () =>
        recordQuery<T, TContext, TAugmentMethods>(
          this.#source,
          this.#node,
          true,
          this.#methods,
          this.#ordering
        )
    } as unknown as IRecordQuery<T, TContext, TAugmentMethods>
  }
}

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
  return new RecordQueryBranch<T, TContext, TAugmentMethods>(
    source,
    node,
    strict,
    methods,
    ordering
  ).build()
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
    { ...snapshotQuerySource(source), keyset: createRecordQueryKeysetOwner() },
    undefined,
    false,
    captured
  )
}

/** The keyset owner borrows finite pure helpers and the original accepted terminal runner. */
export type IRecordQueryKeysetContext = {
  readonly invalid: typeof invalidQueryCondition
  readonly sameCondition: typeof sameQueryCondition
  readonly orderingBytes: typeof queryOrderingBytes
  readonly sourceKey: typeof snapshotQuerySourceKey
  readonly consume: typeof consumeRecordQuery
  readonly active: typeof assertQueryActive
  readonly keyDirection: typeof QueryKeyDirection
  readonly orderDirection: typeof QueryOrderDirection
  readonly orderField: typeof QueryOrderField
}

/** Only full authoring constructors retain the keyset implementation and its helper references. */
function createRecordQueryKeysetOwner(): RecordQueryKeysetOwner {
  return new RecordQueryKeysetOwner({
    invalid: invalidQueryCondition,
    sameCondition: sameQueryCondition,
    orderingBytes: queryOrderingBytes,
    sourceKey: snapshotQuerySourceKey,
    consume: consumeRecordQuery,
    active: assertQueryActive,
    keyDirection: QueryKeyDirection,
    orderDirection: QueryOrderDirection,
    orderField: QueryOrderField
  })
}

/**
 * Construct the same record executor without retaining pagination implementation. The caller owns
 * the coded missing-unit error; ordinary reads and derived branches keep their original semantics.
 */
export function createRecordQueryWithoutKeyset<
  T,
  TContext extends IOperationContext | undefined = IOperationContext,
  TAugmentMethods extends object = Record<never, never>
>(
  source: IRecordQuerySource,
  methods?: TAugmentMethods,
  missingKeyset: () => never = () => {
    throw invalidQueryCondition(undefined, StorageContractErrorText.queryArgument)
  }
): IRecordQuery<T, TContext, TAugmentMethods> {
  /** Feature callbacks retain their original identity on every derived branch. */
  const captured = snapshotRecordQueryMethods(methods)
  return recordQuery<T, TContext, TAugmentMethods>(
    { ...snapshotQuerySource(source), missingKeyset },
    undefined,
    false,
    captured
  )
}

/** Origin capture reuses the vector component/ID owners and never resolves samples or opens I/O. */
function snapshotVectorQueryOrigin(
  origin: IVectorQueryOrigin | undefined
): IVectorQueryOrigin | undefined {
  if (origin === undefined) return undefined
  if (origin === null || typeof origin !== 'object')
    throw invalidQueryCondition(undefined, StorageContractErrorText.queryRerankArgument)
  /** The discriminator and origin fields are retained before scorer execution can await. */
  const kind = origin.kind
  if (kind === VectorQueryOriginKind.near)
    return { kind, vector: snapshotStorageVector(origin.vector) }
  if (kind === VectorQueryOriginKind.similarTo) {
    /** The immutable sample ID is retained without native vector lookup. */
    const id = origin.id
    if (typeof id === 'string') return { kind, id }
  }
  if (kind === VectorQueryOriginKind.recommend) {
    /** Sample identities retain the canonical ID owner and original input order. */
    const positive = snapshotStorageVectorIds(origin.positive)
    /** Negative samples are captured independently without resolving native vectors. */
    const negative = snapshotStorageVectorIds(origin.negative)
    if (positive.length > 0) return { kind, positive, negative }
  }
  throw invalidQueryCondition(undefined, StorageContractErrorText.queryRerankArgument)
}

/** One bounded scorer runs within the original accepted reader and shares its cleanup/failure path. */
/** Explicit vector reader state shares the original accepted pull and native cursor. */
type IVectorRerankReaderContext = {
  readonly upstream: IQueryReader
  readonly ctx: IOperationContext | undefined
  readonly origin: IVectorQueryOrigin
  readonly scorer: IVectorReranker<unknown, boolean>
  readonly topN: number
  prepared: Promise<readonly Awaited<ReturnType<IQueryReader>>[]> | undefined
  emitted: number
}

function compileVectorRerankReader(
  upstream: IQueryReader,
  ctx: IOperationContext | undefined,
  origin: IVectorQueryOrigin,
  scorer: IVectorReranker<unknown, boolean>,
  topN: number
): IQueryReader {
  /** Only this node owns preparation and emission state. */
  const context: IVectorRerankReaderContext = {
    upstream,
    ctx,
    origin,
    scorer,
    topN,
    prepared: undefined,
    emitted: 0
  }
  return (advance, currentScope) => readVectorRerankReader(context, advance, currentScope)
}

/** Prepares this bounded vector stage once without a second resource lifetime. */
async function prepareVectorRerankReader(
  context: IVectorRerankReaderContext,
  advance: IQueryAdvance,
  currentScope?: object
): Promise<readonly Awaited<ReturnType<IQueryReader>>[]> {
  /** Native topK and existing payload predicates have already bounded this candidate list. */
  const entries: Awaited<ReturnType<IQueryReader>>[] = []
  while (true) {
    /** The original context.upstream advance remains accepted through native EOF and cleanup. */
    const next = await context.upstream(advance, currentScope)
    if (next.done) break
    entries.push(next)
  }
  /** The scorer borrows the original readonly engine hits; this array only projects their values. */
  const hits = entries.map((entry) => entry.value as IVectorHit<unknown, boolean>)
  /** An omitted caller signal needs no timer, listener, controller registration or new budget. */
  const signal = (context.ctx?.signal ?? new AbortController().signal) as INativeAbortSignal
  /** User output stays unknown until the one finite-score admission pass. */
  let result: unknown
  try {
    assertQueryActive(context.ctx)
    result = await context.scorer({ origin: context.origin, hits }, { signal })
    assertQueryActive(context.ctx)
  } catch (cause) {
    assertQueryActive(context.ctx)
    throw new StorageContractError(
      StorageContractErrorCode.rerankFailed,
      { cause },
      StorageContractErrorText.queryRerankFailed
    )
  }
  try {
    if (!Array.isArray(result) || result.length !== hits.length)
      throw new StorageContractError(
        StorageContractErrorCode.rerankResultInvalid,
        {},
        StorageContractErrorText.queryRerankResult
      )
    /** The existing canonical numeric key codec and radix own descending scores and stable ties. */
    const scored = entries.map((entry, position) => {
      /** Each present engine position must supply one finite score. */
      const score = Object.hasOwn(result, position) ? result[position] : undefined
      if (typeof score !== 'number' || !Number.isFinite(score))
        throw new StorageContractError(
          StorageContractErrorCode.rerankResultInvalid,
          {},
          StorageContractErrorText.queryRerankResult
        )
      return {
        bytes: encodeOrderedStorageKey([-score, position], undefined),
        row: { ...entry, value: { ...hits[position]!, rerankScore: score } }
      }
    })
    return orderStorageKeysByBytes(scored, (entry) => entry.bytes)
      .slice(0, context.topN)
      .map((entry) => entry.row)
  } catch (cause) {
    if (
      cause instanceof StorageContractError &&
      cause.code === StorageContractErrorCode.rerankResultInvalid
    )
      throw cause
    throw new StorageContractError(
      StorageContractErrorCode.rerankResultInvalid,
      { cause },
      StorageContractErrorText.queryRerankResult
    )
  }
}

/** Concurrent reads share preparation while preserving original emission order. */
async function readVectorRerankReader(
  context: IVectorRerankReaderContext,
  advance: IQueryAdvance,
  currentScope?: object
): Promise<Awaited<ReturnType<IQueryReader>>> {
  /** All pulls share one preparation and reserve their own output position. */
  const ranked = await (context.prepared ??= prepareVectorRerankReader(
    context,
    advance,
    currentScope
  ))
  assertQueryActive(context.ctx)
  return context.emitted === ranked.length
    ? { done: true, value: undefined }
    : ranked[context.emitted++]!
}

/** The finite author closure derives an existing query; it grants no store, source or close handle. */
const vectorQueryRefinement = Symbol()

/** A source that explicitly accepts native facts can derive only its own already bounded query. */
type IVectorQueryAuthor = (refine: (topK: number) => IVectorQueryRefinement) => object

/**
 * Native Feature authors retain this exact source and immutable nodes. Only the selected backend
 * interprets its captured opaque fact; the common planner still owns conditions, context and
 * reads.
 */
export function refineStorageVectorQuery<
  TPayload,
  TGroupable extends boolean,
  TWithVector extends boolean,
  TMethods extends object
>(
  query: IVectorQuery<TPayload, TGroupable, TWithVector, TMethods>,
  refine: (topK: number) => IVectorQueryRefinement
): IVectorNativeQuery<TPayload, TGroupable, TWithVector, TMethods> {
  try {
    if (typeof query !== 'object' || query === null || typeof refine !== 'function')
      throw invalidQueryCondition(undefined, StorageContractErrorText.queryArgument)
    /** This closure can derive only the original query that already granted it. */
    const author: unknown = Reflect.get(query, vectorQueryRefinement)
    if (typeof author !== 'function')
      throw invalidQueryCondition(undefined, StorageContractErrorText.queryArgument)
    return (author as IVectorQueryAuthor)(refine) as IVectorNativeQuery<
      TPayload,
      TGroupable,
      TWithVector,
      TMethods
    >
  } catch (cause) {
    throw queryExecutionFailure(cause)
  }
}

/** Family branches retain the original source and immutable nodes without opening resources. */
class FamilyQueryBranch {
  /** The backend source remains the sole owner of native execution and resource lifetime. */
  readonly #source: IQuerySourceSnapshot
  /** One persistent node identifies this branch's conditions and refinements. */
  readonly #node: IQueryNode | undefined
  /** Strict branches require every stage to use the existing native pushdown path. */
  readonly #strict: boolean
  /** Feature methods retain their original function identities across branch derivation. */
  readonly #methods: object | undefined
  /** Only bounded vector branches expose terminals, grouping and reranking. */
  readonly #bounded: boolean
  /** The original engine bound constrains every finite vector refinement. */
  readonly #bound: number | undefined

  /** Captures branch facts without acquiring a cursor, lease or subscription. */
  constructor(
    source: IQuerySourceSnapshot,
    node: IQueryNode | undefined,
    strict: boolean,
    methods: object | undefined,
    bounded: boolean,
    bound?: number
  ) {
    this.#source = source
    this.#node = node
    this.#strict = strict
    this.#methods = methods
    this.#bounded = bounded
    this.#bound = bound
  }

  /** Appending one node preserves the persistent history and its original native bound. */
  #append(step: IQueryNode['step']): object {
    return familyQuery(
      this.#source,
      { previous: this.#node, step },
      this.#strict,
      this.#methods,
      this.#bounded || step.operation === QueryOperation.topK,
      step.operation === QueryOperation.topK ? step.count : this.#bound
    )
  }

  /** Selection ends family refinement while preserving the original read executor. */
  readonly #select = (...args: readonly unknown[]): object => {
    /** The existing dispatcher permits one field projection or asynchronous mapping transition. */
    const step: IQueryNode['step'] =
      args.length === 1 && typeof args[0] === 'function'
        ? { operation: QueryOperation.mapper, mapper: args[0] as (row: unknown) => unknown }
        : { operation: QueryOperation.select, fields: snapshotQueryFields(args) }
    return selectedRecordQuery(
      this.#source,
      { previous: this.#node, step },
      this.#strict,
      this.#methods
    )
  }

  /** Vector projection retains the same source, score order and already captured request. */
  readonly #withVector = (): object =>
    familyQuery(
      { ...this.#source, vector: { ...this.#source.vector!, withVector: true } },
      this.#node,
      this.#strict,
      this.#methods,
      this.#bounded,
      this.#bound
    )

  /** Captures one scorer and validates its bound before any native or scorer execution. */
  readonly #rerank = (
    scorer: IVectorReranker<unknown, boolean>,
    options?: IVectorRerankOptions
  ): object => {
    /** A native refinement can narrow the candidate count without changing engine topK. */
    const vector = this.#source.vector!
    /** The selected native or engine limit remains authoritative for this branch. */
    const limit = vector.native?.topN ?? this.#bound!
    if (
      typeof scorer !== 'function' ||
      vector.origin === undefined ||
      (options !== undefined &&
        (typeof options !== 'object' || options === null || Array.isArray(options)))
    )
      throw invalidQueryCondition(undefined, StorageContractErrorText.queryRerankArgument)
    /** Options are ordinary supported input; the bound is retained across later scorer awaits. */
    const topN = options?.topN ?? limit
    if (!Number.isSafeInteger(topN) || topN <= 0 || topN > limit)
      throw invalidQueryCondition(undefined, StorageContractErrorText.queryRerankArgument)
    /** Origin is already detached from caller mutation before the query begins execution. */
    const origin = vector.origin
    return familyQuery(
      { ...this.#source, vector: { ...vector, reranked: true } },
      {
        previous: this.#node,
        step: {
          operation: QueryOperation.rerank,
          compile: (upstream, ctx) => compileVectorRerankReader(upstream, ctx, origin, scorer, topN)
        }
      },
      this.#strict,
      this.#methods,
      true,
      this.#bound
    )
  }

  /** Grouping retains each key's bounded best-hit prefix within the original native topK. */
  readonly #groupBy = (field: string, options: { readonly perGroup: number }): object => {
    assertQueryField(field)
    /** The scalar count is captured before subsequent query and native execution awaits. */
    const perGroup = options.perGroup
    if (!Number.isSafeInteger(perGroup) || perGroup <= 0)
      throw invalidQueryCondition(undefined, StorageContractErrorText.queryArgument)
    return selectedRecordQuery(
      this.#source,
      {
        previous: this.#node,
        step: {
          operation: QueryOperation.groupBy,
          field,
          perGroup,
          compile: (upstream) => compileVectorGroupReader(upstream, field, perGroup)
        }
      },
      this.#strict,
      this.#methods
    )
  }

  /** Native authors can derive only this already bounded query and receive no resource authority. */
  readonly #refine = (refine: (topK: number) => IVectorQueryRefinement): object => {
    /** Feature-owned facts are captured once before native execution begins. */
    const captured = refine(this.#bound!)
    if (captured === null || typeof captured !== 'object')
      throw invalidQueryCondition(undefined, StorageContractErrorText.queryArgument)
    /** The opaque fact belongs to the backend; only its finite bound is shared by the planner. */
    const { native, topN } = captured
    if (native === undefined || !Number.isSafeInteger(topN) || topN <= 0 || topN > this.#bound!)
      throw invalidQueryCondition(undefined, StorageContractErrorText.queryArgument)
    return familyQuery(
      { ...this.#source, vector: { ...this.#source.vector!, native: { native, topN } } },
      this.#node,
      this.#strict,
      this.#methods,
      true,
      this.#bound
    )
  }

  /** Builds the finite native vector surface appropriate to this branch's current phase. */
  #vector(shared: object): object {
    /** Vector metadata is a branch fact, not a second execution or resource owner. */
    const vector = this.#source.vector!
    /** Group support is advertised only after the original source is bounded. */
    const groups = this.#bounded && vector.groupBy ? { groupBy: this.#groupBy } : {}
    if (vector.reranked || vector.native !== undefined)
      return {
        ...this.#methods,
        ...familyQueryReads(this.#source, this.#node, this.#strict),
        select: this.#select,
        ...groups,
        ...(vector.reranked ? {} : { withVector: this.#withVector, rerank: this.#rerank })
      }
    /** Ordinary branches preserve the original pre/post-topK runtime surface. */
    const result = {
      ...shared,
      minScore: (score: number) => {
        if (typeof score !== 'number' || !Number.isFinite(score))
          throw invalidQueryCondition(undefined, StorageContractErrorText.queryArgument)
        return this.#append({ operation: QueryOperation.minScore, score })
      },
      withVector: this.#withVector,
      topK: (count: number) => {
        if (!Number.isSafeInteger(count) || count <= 0)
          throw invalidQueryCondition(undefined, StorageContractErrorText.queryArgument)
        return this.#append({ operation: QueryOperation.topK, count })
      },
      ...(this.#bounded
        ? {
            ...familyQueryReads(this.#source, this.#node, this.#strict),
            ...queryWatch(this.#source, this.#node),
            delete: (ctx?: IOperationContext & IWriteConcurrencyOptions) =>
              mutateRecordQuery(this.#source, this.#node, this.#strict, {
                operation: RecordQueryMethod.delete,
                ...queryWriteContext(ctx)
              }),
            select: this.#select,
            rerank: this.#rerank,
            distinct: (field: string) => {
              assertQueryField(field)
              return this.#append({ operation: QueryOperation.distinct, field })
            },
            ...groups
          }
        : {})
    }
    if (this.#bounded && vector.acceptsNative)
      Object.defineProperty(result, vectorQueryRefinement, { value: this.#refine })
    return result
  }

  /** RDF refinements reuse the canonical ground-term validators and the original cursor owner. */
  #rdf(shared: object): object {
    return {
      ...shared,
      ...familyQueryReads(this.#source, this.#node, this.#strict),
      ...queryWatch(this.#source, this.#node),
      delete: (ctx?: IOperationContext & IWriteConcurrencyOptions) =>
        mutateRecordQuery(this.#source, this.#node, this.#strict, {
          operation: RecordQueryMethod.delete,
          ...queryWriteContext(ctx)
        }),
      replace: (
        oldQuad: IQuad,
        newQuad: IQuad,
        ctx?: IOperationContext & IWriteConcurrencyOptions
      ) =>
        mutateRecordQuery(this.#source, this.#node, this.#strict, {
          operation: RdfQueryMethod.replace,
          oldQuad: snapshotStorageRdfQuad(oldQuad, undefined),
          newQuad: snapshotStorageRdfQuad(newQuad, undefined),
          ...queryWriteContext(ctx)
        }),
      select: this.#select,
      distinct: (field: string) => {
        assertQueryField(field)
        return this.#append({ operation: QueryOperation.distinct, field })
      },
      skip: (count: number) => {
        if (!Number.isSafeInteger(count) || count < 0)
          throw invalidQueryCondition(undefined, StorageContractErrorText.queryLimit)
        return this.#append({ operation: QueryOperation.skip, count })
      },
      after: (cursor: IQueryCursor) => this.#append(this.#source.keyset!.after(cursor)),
      orderBy: (selector: (quad: IQuad) => IStorageKey, direction?: 'asc' | 'desc') =>
        this.#append(snapshotQueryOrder(selector, direction)),
      limit: (count: number) => {
        if (!Number.isSafeInteger(count) || count < 0)
          throw invalidQueryCondition(undefined, StorageContractErrorText.queryLimit)
        return this.#append({ operation: QueryOperation.limit, count })
      },
      follow: (predicate: IRdfNamedNode, target?: IRdfNamedNode) => {
        /** Captured ground terms survive query construction and subsequent native awaits. */
        const captured = snapshotStorageRdfPattern(
          { predicate, ...(target === undefined ? {} : { subject: target }) },
          undefined
        )
        if (captured.predicate === undefined)
          throw invalidQueryCondition(undefined, StorageContractErrorText.queryArgument)
        return this.#append({
          operation: QueryOperation.follow,
          predicate: captured.predicate!,
          compile: compileQueryTraversal,
          ...(captured.subject === undefined ? {} : { target: captured.subject })
        })
      },
      inverse: (predicate: IRdfNamedNode) => {
        /** Predicate admission rejects request-local blank nodes before source I/O. */
        const captured = snapshotStorageRdfPattern({ predicate }, undefined)
        if (captured.predicate === undefined)
          throw invalidQueryCondition(undefined, StorageContractErrorText.queryArgument)
        return this.#append({
          operation: QueryOperation.inverse,
          predicate: captured.predicate!,
          compile: compileQueryTraversal
        })
      }
    }
  }

  /** Publishes only the family methods supported by the original source and branch phase. */
  build(): object {
    /** Condition dispatch and strict planning remain common to vector and RDF branches. */
    const shared = {
      ...this.#methods,
      where: (...args: readonly unknown[]) => this.#append(snapshotQueryWhere(args)),
      requirePushdown: () =>
        familyQuery(this.#source, this.#node, true, this.#methods, this.#bounded, this.#bound)
    }
    return this.#source.vector === undefined ? this.#rdf(shared) : this.#vector(shared)
  }
}

/** Derives a family branch without opening I/O or adding another resource lifetime. */
function familyQuery(
  source: IQuerySourceSnapshot,
  node: IQueryNode | undefined,
  strict: boolean,
  methods: object | undefined,
  bounded: boolean,
  bound?: number
): object {
  return new FamilyQueryBranch(source, node, strict, methods, bounded, bound).build()
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
  /** Origin and the finite native channel are optional author facts, not capability registration. */
  let origin: IVectorQueryOrigin | undefined
  /** The native extension channel is opt-in and carries no registration authority. */
  let native: true | undefined
  /** The finite original lease hook is captured without acquiring work during construction. */
  let beginOperation: (() => () => void) | undefined
  ;({ exact, groupBy } = source)
  if ('origin' in source) origin = source.origin
  if ('native' in source) native = source.native
  if ('beginOperation' in source) beginOperation = source.beginOperation
  if (
    (exact !== undefined && typeof exact !== 'boolean') ||
    (groupBy !== undefined && typeof groupBy !== 'boolean') ||
    (native !== undefined && native !== true) ||
    (beginOperation !== undefined && typeof beginOperation !== 'function')
  )
    throw invalidQueryArgument()
  origin = snapshotVectorQueryOrigin(origin)
  return familyQuery(
    {
      ...captured,
      vector: {
        exact: exact === true,
        groupBy: groupBy === true,
        withVector: false,
        origin,
        acceptsNative: native,
        ...(beginOperation === undefined
          ? {}
          : {
              beginOperation: () => source.beginOperation!()
            })
      }
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
      keyset: createRecordQueryKeysetOwner(),
      rdf: { pattern: capturedPattern, condition: snapshotStorageWhere(capturedPattern) }
    },
    undefined,
    false,
    snapshotRecordQueryMethods(methods, RdfQueryMethod),
    true
  ) as IRdfQuery<TContext, TAugmentMethods>
}
