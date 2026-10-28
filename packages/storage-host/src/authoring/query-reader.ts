// Compiled query readers: filter, projection, traversal, ordering and heap stages (see ./query.ts).
import {
  QueryOperation,
  type IVectorHit,
  type IRecordQuerySource,
  type IRdfQueryTraversal,
  StorageContractError,
  StorageContractErrorCode,
  StorageContractErrorText,
  type IOperationContext,
  type IStorageKey,
  type IStorageIterator,
  RdfTermType,
  type IQuad,
  type IRdfNamedNode
} from '@migaia/storage-contract'
import { attachSecondaryErrors } from '@migaia/utils/error'
import { runTransactionIteratorOperation } from './transaction.js'
import {
  compareStorageKeys,
  snapshotStorageKey,
  encodeOrderedStorageKey,
  orderStorageKeysByBytes
} from './key.js'
import { snapshotStorageRdfPattern } from './rdf.js'
import { invalidQueryCondition, compileQueryCondition } from './query-condition.js'
import { queryExecutionFailure, QueryOrderDirection, QueryKeyDirection } from './query-plan.js'
import type { IQueryNode, IQuerySourceSnapshot } from './query-plan.js'

/** External cancellation is observed around accepted work without abandoning a native cursor. */
export function assertQueryActive(ctx: IOperationContext | undefined): void {
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
export type ICompiledQueryReader = {
  readonly read: IQueryReader
  readonly close: (() => Promise<void>) | undefined
  readonly report: (() => Promise<void>) | undefined
}

/**
 * Attempts later-created source cleanup first and retains both failures through the same error
 * owner.
 */
export function completeQueryCleanup(
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
export function snapshotQuerySourceKey(
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
export function queryOrderingBytes(parts: readonly Uint8Array[]): Uint8Array {
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
export function snapshotQueryOrder(
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
export type IVectorReaderCompiler = (
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

export function compileVectorGroupReader(
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
export function compileQueryTraversal(
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
export function compileRecordQueryReader(
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
