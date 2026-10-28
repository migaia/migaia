// Query node shapes, source snapshots and record query planning for the query SDK (see ./query.ts).
import {
  QueryOperator,
  type IQueryOperandValue,
  type IQueryCondition,
  QueryOperation,
  type IQueryPlanStep,
  type IQueryPlan,
  type IQueryPushdown,
  type IVectorQueryOrigin,
  type IVectorQueryRefinement,
  type IRecordQuerySource,
  type IRecordQuerySourcePlan,
  type IRecordQueryInput,
  type IRecordQueryMutation,
  type IRdfQueryMutation,
  type IQueryMutator,
  type IQueryWatcher,
  type IQueryReducer,
  type IQueryNativeStep,
  type IVectorQueryInput,
  type IRdfQueryTraversal,
  type IRdfQueryInput,
  StorageContractErrorCode,
  STORAGE_CONTRACT_SOURCE,
  StorageContractErrorText,
  type IStorageKey,
  type IStorageIterator,
  type IQuad
} from '@migaia/storage-contract'
import { attachErrorIdentity, IdentifyError, toError } from '@migaia/utils/error'
import { RecordQueryKeysetOwner } from './query-keyset.ts'
import {
  invalidQueryArgument,
  invalidQueryCondition,
  QueryConditionKind,
  queryEqual
} from './query-condition.ts'
import type {
  IQueryCompileContext,
  IQueryReader,
  IFamilyReaderCompiler,
  IVectorReaderCompiler
} from './query-reader.ts'

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
export type IQuerySourcePort = {
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
export const QueryKeyDirection = { next: 'next', prev: 'prev' } as const

/** Selector direction is shared by admission and byte reversal without a second ordering domain. */
export const QueryOrderDirection = { asc: 'asc', desc: 'desc' } as const

/** Pure chain shape controls which mutually exclusive ordering refinement remains available. */
export const QueryOrderMode = {
  selector: 'selector',
  comparator: QueryOperation.comparator
} as const

/** Native primary-key ordering has no JavaScript selector to serialize or interpret. */
export const QueryOrderField = { key: 'key' } as const

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
export function queryExecutionFailure(cause: unknown): Error {
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
export function snapshotQuerySource(source: IRecordQuerySource): IQuerySourceSnapshot {
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
    /** Backend authors declare this typed descriptor; its fields are copied, not re-validated. */
    const { direction, parts } = keyOrder
    tieBreakByKey = { direction, ...(parts === undefined ? {} : { parts }) }
  }
  /** The source key is captured once; omission retains the native symbol's existing semantics. */
  const configuredAsyncDisposeKey = source.asyncDisposeKey
  /** Extended native controls are never inferred from legacy support arrays alone. */
  const nativeSteps = source.nativeSteps
  /** Source identity is captured once and is used only for Boolean cursor compatibility checks. */
  const cursorSource = source.cursorSource
  /** Optional native terminal support captures one callable rather than inferring another runner. */
  const reduce = source.reduce
  /** One captured author callback retains original pipeline and native transaction authority. */
  const mutate = source.mutate
  /** A declared native watcher supplies its own original subscription resource and timing owner. */
  const watch = source.watch
  /** Pure planning authority is borrowed once, just like the original native callbacks. */
  const plan = source.plan
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
export function sameQueryCondition(left: IQueryCondition, right: IQueryCondition): boolean {
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
export function planRecordQuery(
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
