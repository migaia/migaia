import {
  QueryOperation,
  StorageContractErrorText,
  type IQueryCursor,
  type IQueryCondition,
  type IOperationContext,
  type IQueryNativeStep
} from '@migaia/storage-contract'
import { immutableSnapshot } from '@migaia/utils/object'
import { compareStorageKeys } from './key.js'
import type {
  IQueryNode,
  IQuerySourceSnapshot,
  IQueryCursorSnapshot,
  IRecordExecutionPlan,
  IQueryAdvance,
  IQueryReader,
  IQueryReadResult,
  IQueryReaderInput,
  IRecordQueryKeysetContext
} from './query.js'

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
function sameQueryCursorStep(
  left: IQueryNode['step'],
  right: IQueryNode['step'],
  context: IRecordQueryKeysetContext
): boolean {
  if (left.operation !== right.operation) return false
  switch (left.operation) {
    case QueryOperation.where:
      return context.sameCondition(left.condition, (right as typeof left).condition)
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
class QueryCursor {
  /** Detached ordering facts remain inaccessible even when consumers reflect own properties. */
  #snapshot: IQueryCursorSnapshot
  /** Only the query owner creates a cursor after its original reader supplies a page anchor. */
  constructor(snapshot: IQueryCursorSnapshot) {
    this.#snapshot = snapshot
  }
  /** Rejects forged objects without reading their properties or invoking unknown functions. */
  static snapshot(cursor: IQueryCursor): IQueryCursorSnapshot {
    if (typeof cursor !== 'object' || cursor === null || !(#snapshot in cursor))
      throw new TypeError(StorageContractErrorText.queryArgument)
    /**
     * Private keys/bytes stay internal; only comparator rows need copying before user callbacks can
     * mutate them.
     */
    const value = cursor.#snapshot
    return {
      key: value.key,
      bytes: value.bytes,
      ...('row' in value ? { row: immutableSnapshot(value.row) } : {}),
      matches: value.matches
    }
  }
}

/** Admits an owner-created read-only cursor and captures only detached data before source I/O. */
function snapshotQueryCursor(
  cursor: IQueryCursor,
  context: IRecordQueryKeysetContext
): IQueryCursorSnapshot {
  try {
    return QueryCursor.snapshot(cursor)
  } catch (cause) {
    throw context.invalid(cause, StorageContractErrorText.queryArgument)
  }
}

/** Cursor compatibility retains query facts without source execution or cleanup callbacks. */
class QueryCursorScope {
  /** Pure query comparison stays with the canonical executor helper. */
  readonly #context: IRecordQueryKeysetContext
  /** Exact source identity is an opaque in-process fact, never an executable authority. */
  readonly #identity: object
  /** Source name and index identify the original native row domain. */
  readonly #source: string
  /** Optional source index remains distinct from a full native scan. */
  readonly #index: string | undefined
  /** Organization identity cannot change between pages. */
  readonly #orgId: string | undefined
  /** Primary-key direction fixes canonical tie ordering across all pages. */
  readonly #direction: 'next' | 'prev' | undefined
  /** Compound physical key parts retain their original independent logical-key budgets. */
  readonly #parts: true | undefined
  /** Ground RDF condition identifies the original match without retaining a cursor or source port. */
  readonly #rdf: IQueryCondition | undefined
  /** Relevant condition/order nodes exclude execution-only page and projection controls. */
  readonly #signature: readonly IQueryNode['step'][]

  /** Captures data facts only after the original page reader has supplied its anchor. */
  constructor(
    source: IQuerySourceSnapshot,
    steps: readonly IQueryNode['step'][],
    orgId: string | undefined,
    context: IRecordQueryKeysetContext
  ) {
    this.#context = context
    this.#identity = source.cursorSource
    this.#source = source.pushdown.source
    this.#index = source.pushdown.index
    this.#orgId = orgId
    this.#direction = source.tieBreakByKey?.direction
    this.#parts = source.tieBreakByKey?.parts
    this.#rdf = source.rdf?.condition
    this.#signature = steps.filter(queryCursorStep)
  }

  /** Compares only supported query data identity and returns no source or resource handle. */
  readonly matches: IQueryCursorSnapshot['matches'] = (candidate, candidateSteps, candidateOrg) => {
    if (
      candidate.cursorSource !== this.#identity ||
      candidateOrg !== this.#orgId ||
      candidate.pushdown.source !== this.#source ||
      candidate.pushdown.index !== this.#index ||
      candidate.tieBreakByKey?.direction !== this.#direction ||
      candidate.tieBreakByKey?.parts !== this.#parts
    )
      return false
    if (
      (candidate.rdf === undefined) !== (this.#rdf === undefined) ||
      (candidate.rdf !== undefined &&
        this.#rdf !== undefined &&
        !this.#context.sameCondition(candidate.rdf.condition, this.#rdf))
    )
      return false
    /** Projection and per-page bounds may change while selection and ordering remain fixed. */
    const relevant = candidateSteps.filter(queryCursorStep)
    return (
      relevant.length === this.#signature.length &&
      this.#signature.every((step, index) =>
        sameQueryCursorStep(step, relevant[index]!, this.#context)
      )
    )
  }
}

/** Captures page data before returned rows can be mutated by the caller during the next page await. */
function createQueryCursor(
  context: IRecordQueryKeysetContext,
  source: IQuerySourceSnapshot,
  steps: readonly IQueryNode['step'][],
  row: Awaited<ReturnType<IQueryReader>>,
  orgId: string | undefined
): IQueryCursor {
  /** Only opaque comparator ordering can expose a retained anchor to user callbacks. */
  const comparator = steps.find((step) => step.operation === QueryOperation.comparator)
  /** The cursor anchor must remain independent of mutable page items returned to callers. */
  const anchor = comparator === undefined ? undefined : immutableSnapshot(row.anchor)
  /** Metadata was captured by the reader before the native source could reuse its key buffer. */
  const key = row.key!
  /** Private canonical sort bytes never escape through public page values. */
  const bytes = context.orderingBytes([...(row.ordering ?? []), row.keyBytes!])
  /** Compatibility owns only declarative facts and never captures native execution ports. */
  const scope = new QueryCursorScope(source, steps, orgId, context)
  return new QueryCursor({
    key,
    bytes,
    ...(comparator === undefined ? {} : { row: anchor }),
    matches: scope.matches
  }) as unknown as IQueryCursor
}

/** Applies keyset bounds and bounded-comparator admission to the original ordered nodes. */
function planQuerySteps(
  context: IRecordQueryKeysetContext,
  source: IQuerySourceSnapshot,
  signature: readonly IQueryNode['step'][],
  pageSize?: number
): IQueryNode['step'][] {
  /** Execution-only partitioning never changes the persistent branch or cursor signature. */
  let steps = [...signature]
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
          by: context.orderField.key,
          direction:
            source.tieBreakByKey?.direction === context.keyDirection.prev
              ? context.orderDirection.desc
              : context.orderDirection.asc
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
  return steps
}

/** Keyset filtering borrows the cursor bytes and original opaque comparator. */
type IQueryAfterContext = IQueryReaderInput & {
  readonly step: Pick<
    Extract<IQueryNode['step'], { operation: typeof QueryOperation.after }>,
    'operation' | 'cursor'
  >
  readonly helpers: IRecordQueryKeysetContext
  readonly comparator: ((left: unknown, right: unknown) => number) | undefined
}

/** Runs this named reader stage with explicit state and the original accepted pull. */
async function readAfterQuery(
  context: IQueryAfterContext,
  advance: IQueryAdvance,
  currentScope?: object
): Promise<IQueryReadResult> {
  while (true) {
    /** Keyset filtering seeks by the original full ordering tuple, never an offset counter. */
    /** The original context.upstream advance remains accepted through native EOF and cleanup. */
    const next = await context.upstream(advance, currentScope)
    if (next.done) return next
    /** Comparator callbacks remain opaque; their anchor was detached before page items escaped. */
    const rank =
      context.comparator === undefined
        ? 0
        : context.comparator(next.anchor, context.step.cursor.row)
    /** Canonical bytes include the source primary-key tail and every selector direction. */
    const bytes = context.helpers.orderingBytes([...(next.ordering ?? []), next.keyBytes!])
    if (
      rank > 0 ||
      (!rank &&
        compareStorageKeys(
          bytes.buffer as ArrayBuffer,
          context.step.cursor.bytes.buffer as ArrayBuffer
        ) > 0)
    )
      return next
    context.helpers.active(context.ctx)
  }
}

/** Pagination owns only query data and borrows the original execution and resource owner. */
export class RecordQueryKeysetOwner {
  /** Finite canonical helpers keep errors, ordering and terminal lifetimes in their original owner. */
  readonly #context: IRecordQueryKeysetContext
  /** Select the existing query executor without opening an operation or native cursor. */
  constructor(context: IRecordQueryKeysetContext) {
    this.#context = context
  }
  /** Reorder only this execution view while retaining the immutable signature. */
  plan(
    source: IQuerySourceSnapshot,
    signature: readonly IQueryNode['step'][],
    size?: number
  ): IQueryNode['step'][] {
    return planQuerySteps(this.#context, source, signature, size)
  }
  /** Cursor compatibility is admitted before the original native source opens. */
  assertMatches(
    source: IQuerySourceSnapshot,
    plan: IRecordExecutionPlan,
    ctx: IOperationContext | undefined
  ): void {
    for (const step of [...plan.pushed, ...plan.client])
      if (
        step.operation === QueryOperation.after &&
        !step.cursor.matches(source, plan.signature, ctx?.orgId)
      )
        throw this.#context.invalid(undefined, StorageContractErrorText.queryArgument)
  }
  /** Capture one authenticated anchor and attach its original reader/native transformations. */
  after(
    cursor: IQueryCursor
  ): Extract<IQueryNode['step'], { operation: typeof QueryOperation.after }> {
    /** Opaque cursor authority is captured once before any native source work. */
    const snapshot = snapshotQueryCursor(cursor, this.#context)
    return {
      operation: QueryOperation.after,
      cursor: snapshot,
      compile: (compiler) => {
        const context: IQueryAfterContext = {
          upstream: compiler.read,
          ctx: compiler.owner.ctx,
          step: { operation: QueryOperation.after, cursor: snapshot },
          comparator: compiler.comparator,
          helpers: this.#context
        }
        return (advance, scope) => readAfterQuery(context, advance, scope)
      },
      native: (source): IQueryNativeStep => ({
        operation: QueryOperation.after,
        key: this.#context.sourceKey(
          snapshot.key,
          source.tieBreakByKey ?? { direction: this.#context.keyDirection.next }
        ),
        direction: source.tieBreakByKey?.direction ?? this.#context.keyDirection.next
      })
    }
  }
  /** The page terminal stays inside this query’s original planner, cursor and error owner. */
  async page<R, TContext extends IOperationContext | undefined>(
    source: IQuerySourceSnapshot,
    node: IQueryNode | undefined,
    strict: boolean,
    size: number,
    ctx?: TContext
  ): Promise<{ readonly items: R[]; readonly next?: IQueryCursor }> {
    if (!Number.isSafeInteger(size) || size <= 0)
      throw this.#context.invalid(undefined, StorageContractErrorText.queryPage)
    return this.#context.consume<R, { readonly items: R[]; readonly next?: IQueryCursor }>(
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
            ? createQueryCursor(
                this.#context,
                source,
                plan!.signature,
                rows[size - 1]!,
                captured?.orgId
              )
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
            this.#context.active(captured)
          }
        }
        return { items, ...(next === undefined ? {} : { next }) }
      },
      false,
      size
    )
  }
}
