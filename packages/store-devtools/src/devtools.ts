import {
  ReactiveErrorPhase,
  ReactiveTracePhase,
  ReactiveTraceType,
  type IReactiveComputed,
  type IReactiveEffect,
  type IReactiveSignal,
  type IRuntimeTraceEvent
} from '@migaia/reactive'
import type { IObservable, IObserver } from '@migaia/reactive/extension'
import type { IReactiveStore } from '@migaia/store-light'
import { ClonePolicy } from '@migaia/store-middleware/tolerant-clone'
import {
  createStoreDevtoolsAggregateError,
  createStoreDevtoolsError,
  createStoreDevtoolsRangeError,
  identifyDevtoolsFailure
} from './errors.ts'
import { StoreDevtoolsErrorCode } from './error-code.ts'
import { StoreDevtoolsLabel, StoreDevtoolsNodeKind } from './devtools-constants.ts'
import { StoreDevtoolsErrorText } from './error-text.ts'

/** Rejects depth values that would silently disable the diagnostic traversal bound. */
function assertDepth(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw createStoreDevtoolsRangeError(
      StoreDevtoolsErrorCode.invalidOption,
      StoreDevtoolsErrorText.invalidDepth(name)
    )
  }
}

/** A newly allocated diagnostic tree node; its object and children array remain mutable. */
export type IDependencyTreeNode = {
  /** Traversal role: dependency roots are observers and reverse-tree roots are observables. */
  kind: (typeof StoreDevtoolsNodeKind)[keyof typeof StoreDevtoolsNodeKind]
  /** DebugName, then constructor.name, then AnonymousReactiveNode; not a stable node identifier. */
  label: string
  /** Current version on observable-role nodes; observer-role nodes omit this field. */
  version?: number
  /** Edges in the graph's current iteration order, truncated at maxDepth or a path cycle. */
  children: IDependencyTreeNode[]
  /** Present as true only when this node repeats on the current path, not for a shared diamond leaf. */
  circular?: boolean
  /**
   * Present as true when this graph node was already expanded earlier in the same tree (a shared
   * diamond node). Its children are listed only at that first occurrence, so each node is expanded
   * once and the tree stays linear in the graph size.
   */
  shared?: boolean
}

/** One published history snapshot; the runtime freezes the entry and state only at the top level. */
export type IStoreHistoryEntry = {
  /** Session-local increasing identifier, starting at 1 and not reset by clear. */
  id: number
  /** Value returned by the configured clock when this entry was prepared. */
  timestamp: number
  /** 'initial', default 'state change', or the caller's manual record label. */
  label: string
  /** Clone of store.$plain(); unsupported subtrees may remain aliased under the diagnostic policy. */
  state: Record<string, unknown>
}

/** Routes snapshot failures to the Runtime reporter, which already contains reporter failures. */
function reportDevtoolsFailure(
  runtime: IReactiveStore<Record<string, unknown>>['$runtime'],
  error: unknown
): void {
  runtime.reportError(error, { phase: ReactiveErrorPhase.traceListener })
}

/** A retained action record; payload/error and nested values are not cloned or deep-frozen. */
export type IActionTrace = {
  /** Configured now() value taken when this action is appended, not the trace event's timestamp. */
  timestamp: number
  /** Runtime action name or a caller-selected manual name. */
  name: string
  /** Optional manual diagnostic payload; automatic action capture does not add one. */
  payload?: unknown
  /** Optional duration supplied by the Runtime trace or manual caller. */
  durationMs?: number
  /** Optional original failure reference, populated automatically for action error events. */
  error?: unknown
}

/** Session-local capture policy; invalid limits/callbacks reject synchronously before subscribing. */
export type IStoreDevToolsOptions = {
  /**
   * Positive safe-integer history capacity, default 100; oldest snapshots are evicted
   * independently.
   */
  maxHistory?: number
  /** Positive safe-integer capacity for each independent actions/trace queue, default 1000. */
  maxTrace?: number
  /**
   * Enabled unless exactly false; captures the entire borrowed Runtime, not only this Store's
   * actions.
   */
  captureRuntimeTrace?: boolean
  /**
   * Optional timestamp source, default Date.now; its result is retained without clock
   * normalization.
   */
  now?: () => number
  /**
   * Optional snapshot/replay clone, default ClonePolicy.diagnostic; it does not redact sensitive
   * fields.
   */
  clone?: (state: Record<string, unknown>) => Record<string, unknown>
}

/** In-memory diagnostics that borrow the Store/Runtime and require explicit synchronous disposal. */
export type IStoreDevTools = {
  /** A fresh frozen chronological array of retained shallow-frozen history entries. */
  readonly history: readonly IStoreHistoryEntry[]
  /** A fresh frozen array; action records and their payload/error references remain mutable. */
  readonly actions: readonly IActionTrace[]
  /** A fresh frozen array of original Runtime event references, with independent maxTrace capacity. */
  readonly trace: readonly IRuntimeTraceEvent[]
  /**
   * Prepare and append a snapshot, default label 'state change'; failure leaves queues/id
   * unchanged.
   */
  record(label?: string): IStoreHistoryEntry
  /**
   * Append a shallow action copy with now(); manual capture remains available when runtime trace is
   * disabled.
   */
  recordAction(trace: Omit<IActionTrace, 'timestamp'>): void
  /**
   * Clone a retained snapshot into Store.$hydrate, suppressing synchronous replay history only.
   * Missing/evicted ids throw UNKNOWN_HISTORY_ENTRY RangeError; this is not external-effect
   * rollback. Unclassified clone failures receive CALLBACK_FAILED; hydrate errors retain their
   * upstream identity. Replay suppression is restored even when either step throws.
   */
  jumpTo(id: number): void
  /**
   * Prepare the current snapshot first, then reset all queues to one new initial entry without
   * resetting ids.
   */
  clear(): void
  /**
   * Mark terminal and attempt both subscriptions once, without disposing the Store/Runtime or
   * clearing retained queues. One cleanup failure is rethrown; multiple failures become
   * CLEANUP_FAILED. Later dispose calls return, while record/recordAction/jumpTo/clear reject
   * SESSION_DISPOSED.
   */
  dispose(): void
}

const nodeLabel = (node: object): string =>
  (node as { debugName?: string }).debugName ??
  node.constructor?.name ??
  StoreDevtoolsLabel.anonymousReactiveNode

// Detects cycles on the current path rather than through a global visited set: only revisiting a
// node still on that path is a cycle. Shared diamond nodes appear on every path but expand once.
/**
 * Inspect the current dependencies of a real Effect/Computed handle or extension observer without
 * changing graph subscriptions. maxDepth defaults to 20, accepts nonnegative safe integers, and
 * zero keeps only the root. The mutable result lists shared nodes on every path but expands them
 * once (later occurrences carry `shared`), marks only a current-path repeat circular, and stops
 * there. Invalid depth throws INVALID_OPTION RangeError.
 */
export function getDependencyTree(
  root: IObserver | IReactiveEffect | IReactiveComputed<unknown>,
  maxDepth = 20
): IDependencyTreeNode {
  assertDepth(maxDepth, 'dependency tree')
  /** Runtime factories return the existing observer node behind the narrow public handle. */
  const observer = root as IObserver
  /** Root node; children are expanded with an explicit stack, not the JavaScript call stack. */
  const tree: IDependencyTreeNode = {
    kind: StoreDevtoolsNodeKind.observer,
    label: nodeLabel(observer),
    children: []
  }
  if (!depth0Exceeds(0, maxDepth))
    expandTree(tree, observer, [...observer.deps], maxDepth, dependencyNode, dependenciesOf)
  return tree
}

/**
 * Inspect the current subscribers of a real Signal/Computed handle or extension observable. The
 * root has observable role/version; descendants have observer role. maxDepth defaults to 20, zero
 * returns a childless root, and invalid depths throw INVALID_OPTION RangeError. The newly allocated
 * mutable tree is a point-in-time view, not a subscription or a live graph index.
 */
export function getObserverTree(
  root: IObservable | IReactiveSignal<unknown> | IReactiveComputed<unknown>,
  maxDepth = 20
): IDependencyTreeNode {
  assertDepth(maxDepth, 'observer tree')
  /** Runtime factories return the existing observable node behind the narrow public handle. */
  const observable = root as IObservable
  /** Root node; children are expanded with an explicit stack, not the JavaScript call stack. */
  const tree: IDependencyTreeNode = {
    kind: StoreDevtoolsNodeKind.observable,
    label: nodeLabel(observable),
    version: observable.version,
    children: []
  }
  if (!depth0Exceeds(0, maxDepth))
    expandTree(tree, observable, [...observable.subs], maxDepth, subscriberNode, subscribersOf)
  return tree
}

/** One node being expanded: its tree node, graph object, child list and next child to visit. */
type ITreeFrame = {
  readonly node: IDependencyTreeNode
  readonly owner: object
  readonly children: readonly object[]
  readonly depth: number
  next: number
}

/**
 * Expand a graph tree depth-first with an explicit stack. A node already on the current path is
 * marked circular and not expanded; a node already expanded elsewhere in the tree is marked shared
 * and not expanded again, so total work is linear in the graph size; nodes at maxDepth stay leaves
 * and are not recorded as expanded. Supported depth does not depend on the JavaScript call stack.
 */
function expandTree(
  root: IDependencyTreeNode,
  rootOwner: object,
  rootChildren: readonly object[],
  maxDepth: number,
  createNode: (owner: object) => IDependencyTreeNode,
  childrenOf: (owner: object) => readonly object[] | undefined
): void {
  /** Graph objects on the current root-to-node path. */
  const path = new Set<object>([rootOwner])
  /** Graph objects whose children were already listed somewhere in this tree. */
  const expanded = new Set<object>([rootOwner])
  /** Frames still being expanded; the last one is the current node. */
  const stack: ITreeFrame[] = [
    { node: root, owner: rootOwner, children: rootChildren, depth: 0, next: 0 }
  ]
  while (stack.length > 0) {
    /** Node whose next child is visited now. */
    const frame = stack[stack.length - 1]!
    if (frame.next >= frame.children.length) {
      path.delete(frame.owner)
      stack.pop()
      continue
    }
    /** Next child graph object of the current node. */
    const child = frame.children[frame.next++]!
    /** Tree node for that child. */
    const node = createNode(child)
    frame.node.children.push(node)
    if (path.has(child)) {
      node.circular = true
      continue
    }
    /** Depth of `child` below the root. */
    const depth = frame.depth + 1
    /** The child's own children, or undefined when it is a leaf at this depth. */
    const grandchildren = depth >= maxDepth ? undefined : childrenOf(child)
    if (grandchildren === undefined || grandchildren.length === 0) continue
    if (expanded.has(child)) {
      node.shared = true
      continue
    }
    expanded.add(child)
    path.add(child)
    stack.push({ node, owner: child, children: grandchildren, depth, next: 0 })
  }
}

/** Tree node for one dependency (an observable) in a dependency tree. */
function dependencyNode(owner: object): IDependencyTreeNode {
  /** The dependency graph object. */
  const current = owner as IObservable
  return {
    kind: StoreDevtoolsNodeKind.observable,
    label: nodeLabel(current),
    version: current.version,
    children: []
  }
}

/** Dependencies of a dependency that is itself an observer; undefined for a plain source. */
function dependenciesOf(owner: object): readonly object[] | undefined {
  return 'deps' in owner ? [...(owner as IObservable & IObserver).deps] : undefined
}

/** Tree node for one subscriber (an observer) in an observer tree. */
function subscriberNode(owner: object): IDependencyTreeNode {
  return {
    kind: StoreDevtoolsNodeKind.observer,
    label: nodeLabel(owner as IObserver),
    children: []
  }
}

/** Subscribers of a subscriber that is itself observable; undefined for a plain observer. */
function subscribersOf(owner: object): readonly object[] | undefined {
  return 'subs' in owner ? [...(owner as IObserver & IObservable).subs] : undefined
}

/** MaxDepth 为 0 时连根的直接边都不展开——把这条边界判断和递归里的写法对齐。 */
const depth0Exceeds = (depth: number, maxDepth: number): boolean => depth >= maxDepth

/** Fixed-capacity chronological queue with O(1) publication after reaching its limit. */
class BoundedQueue<T> {
  /** Maximum number of live values retained by this queue. */
  readonly #capacity: number
  /** Lazily-grown ring storage; avoids allocating an attacker-sized configured capacity upfront. */
  readonly #values: Array<T | undefined> = []
  /** Index containing the oldest retained value. */
  #start = 0
  /** Number of currently retained values. */
  #size = 0

  constructor(capacity: number) {
    this.#capacity = capacity
  }

  /** Publishes one value, evicting the oldest value when full. */
  push(value: T): void {
    if (this.#size < this.#capacity) {
      this.#values[(this.#start + this.#size) % this.#capacity] = value
      this.#size++
      return
    }
    this.#values[this.#start] = value
    this.#start = (this.#start + 1) % this.#capacity
  }

  /** Returns a chronological snapshot without exposing mutable ring storage. */
  values(): T[] {
    const result: T[] = []
    for (let offset = 0; offset < this.#size; offset++) {
      result.push(this.#values[(this.#start + offset) % this.#capacity]!)
    }
    return result
  }

  /** Finds the first chronological value matching `predicate`. */
  find(predicate: (value: T) => boolean): T | undefined {
    for (let offset = 0; offset < this.#size; offset++) {
      const value = this.#values[(this.#start + offset) % this.#capacity]!
      if (predicate(value)) return value
    }
    return undefined
  }

  /** Releases all retained values while keeping reusable fixed storage. */
  clear(): void {
    this.#values.length = 0
    this.#start = 0
    this.#size = 0
  }
}

/**
 * Attach bounded in-memory history and optional Runtime/action capture to an existing reactive
 * Store. Options default to {}; construction records id 1/label 'initial' synchronously before
 * subscribing. History watches this Store, while trace capture observes its whole borrowed Runtime.
 * Configuration or initial preparation failure throws before returning; later automatic snapshot
 * failures go to Runtime.reportError without interrupting the business write. The caller must
 * dispose the session separately from its Store/Runtime, and time travel does not undo external
 * I/O.
 */
export function createStoreDevTools<S extends Record<string, unknown>>(
  store: IReactiveStore<S>,
  options: IStoreDevToolsOptions = {}
): IStoreDevTools {
  return new StoreDevToolsSession(store, readDevtoolsOptions(options))
}

/** Validated devtools options with defaults applied. */
type IResolvedDevtoolsOptions = Readonly<{
  maxHistory: number
  maxTrace: number
  now: () => number
  clone: (state: Record<string, unknown>) => Record<string, unknown>
  captureRuntimeTrace: boolean
}>

/** Reads every option once (a throwing getter is INVALID_OPTION) and applies the defaults. */
function readDevtoolsOptions(options: IStoreDevToolsOptions): IResolvedDevtoolsOptions {
  if (options === null || typeof options !== 'object') {
    throw createStoreDevtoolsError(
      StoreDevtoolsErrorCode.invalidOption,
      StoreDevtoolsErrorText.optionsObject
    )
  }
  /** Raw option values, read once. */
  let optionValues: {
    maxHistory?: number
    maxTrace?: number
    now?: () => number
    clone?: (state: Record<string, unknown>) => Record<string, unknown>
    captureRuntimeTrace?: boolean
  }
  try {
    Object.getOwnPropertyDescriptors(options)
    optionValues = {
      maxHistory: options.maxHistory,
      maxTrace: options.maxTrace,
      now: options.now,
      clone: options.clone,
      captureRuntimeTrace: options.captureRuntimeTrace
    }
  } catch (error) {
    throw createStoreDevtoolsError(
      StoreDevtoolsErrorCode.invalidOption,
      StoreDevtoolsErrorText.optionsObject,
      { cause: error }
    )
  }
  /** Validated bounds, read before callbacks so error order is unchanged. */
  const maxHistory = validateLimit(optionValues.maxHistory, 100, 'maxHistory')
  const maxTrace = validateLimit(optionValues.maxTrace, 1_000, 'maxTrace')
  if (optionValues.now !== undefined && typeof optionValues.now !== 'function') {
    throw createStoreDevtoolsError(
      StoreDevtoolsErrorCode.invalidOption,
      StoreDevtoolsErrorText.callbackOption('now')
    )
  }
  if (optionValues.clone !== undefined && typeof optionValues.clone !== 'function') {
    throw createStoreDevtoolsError(
      StoreDevtoolsErrorCode.invalidOption,
      StoreDevtoolsErrorText.callbackOption('clone')
    )
  }
  return {
    maxHistory,
    maxTrace,
    now: optionValues.now ?? Date.now,
    clone: optionValues.clone ?? ClonePolicy.diagnostic,
    captureRuntimeTrace: optionValues.captureRuntimeTrace !== false
  }
}

/** A queue limit: the value or its fallback must be a positive safe integer. */
function validateLimit(value: number | undefined, fallback: number, name: string): number {
  /** Value after applying the fallback. */
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || resolved < 1)
    throw createStoreDevtoolsError(
      StoreDevtoolsErrorCode.invalidOption,
      StoreDevtoolsErrorText.invalidLimit(name)
    )
  return resolved
}

/**
 * One devtools session over a store: bounded state history, action and runtime-trace queues, and
 * time-travel replay. Members are arrow fields so the session stays destructurable.
 */
class StoreDevToolsSession<S extends Record<string, unknown>> implements IStoreDevTools {
  /** Inspected store. */
  readonly #store: IReactiveStore<S>
  /** Clock for entries and actions. */
  readonly #now: () => number
  /** Snapshot cloner for history and replay. */
  readonly #clone: (state: Record<string, unknown>) => Record<string, unknown>
  /** Bounded state snapshots. */
  readonly #history: BoundedQueue<IStoreHistoryEntry>
  /** Bounded action traces. */
  readonly #actions: BoundedQueue<IActionTrace>
  /** Bounded runtime trace events. */
  readonly #trace: BoundedQueue<IRuntimeTraceEvent>
  /** Next history id. */
  #nextId = 1
  /**
   * Replay nesting depth. 计数而非布尔：回放期间监听器再次 jumpTo 时，内层的 finally 不能提前解除外层的
   * 回放屏蔽，否则外层剩余的通知会被当成用户操作记进历史。
   */
  #replayDepth = 0
  /** Set once disposed; every operation then fails with SESSION_DISPOSED. */
  #disposed = false
  /** Store subscription. */
  #unsubscribe: (() => void) | undefined
  /** Runtime trace subscription. */
  #unsubscribeTrace: (() => void) | undefined

  /** Records the initial snapshot, then subscribes; a failed subscribe rolls back the other. */
  constructor(store: IReactiveStore<S>, options: IResolvedDevtoolsOptions) {
    this.#store = store
    this.#now = options.now
    this.#clone = options.clone
    this.#history = new BoundedQueue<IStoreHistoryEntry>(options.maxHistory)
    this.#actions = new BoundedQueue<IActionTrace>(options.maxTrace)
    this.#trace = new BoundedQueue<IRuntimeTraceEvent>(options.maxTrace)
    this.record(StoreDevtoolsLabel.initial)
    try {
      this.#unsubscribe = store.$subscribe(() => this.#onStoreChange())
      this.#unsubscribeTrace = options.captureRuntimeTrace
        ? store.$runtime.subscribeTrace((event) => this.#onTrace(event))
        : () => {}
    } catch (error) {
      this.#rollbackSubscriptions(error)
    }
  }

  /** Throws SESSION_DISPOSED after dispose. */
  #assertActive(): void {
    if (this.#disposed)
      throw createStoreDevtoolsError(
        StoreDevtoolsErrorCode.sessionDisposed,
        StoreDevtoolsErrorText.sessionDisposed
      )
  }

  /** Prepares one history entry fully before reserving an id, so a failure changes nothing. */
  #createEntry(label: string): IStoreHistoryEntry {
    try {
      /** Timestamp is evaluated before reserving an id so a failing clock leaves queues unchanged. */
      const timestamp = this.#now()
      /** Snapshot is fully cloned before reserving an id or mutating any diagnostic queue. */
      const state = Object.freeze(this.#clone(this.#store.$plain()))
      this.#assertActive()
      /** Fully prepared history entry ready for atomic publication. */
      const entry: IStoreHistoryEntry = Object.freeze({ id: this.#nextId, timestamp, label, state })
      this.#nextId++
      return entry
    } catch (error) {
      throw identifyDevtoolsFailure(error, StoreDevtoolsErrorText.preparationFailed)
    }
  }

  /** Store change: record a snapshot unless replaying; failures are reported, never thrown. */
  #onStoreChange(): void {
    if (this.#replayDepth > 0) return
    try {
      this.record()
    } catch (error) {
      // 诊断工具坏掉不能让业务写入跟着失败：快照/克隆异常在这里就地上报，绝不冒泡进 store 的 flush。
      reportDevtoolsFailure(this.#store.$runtime, error)
    }
  }

  /** Runtime trace event: queue it and turn finished actions into action traces. */
  #onTrace(event: IRuntimeTraceEvent): void {
    if (this.#disposed) return
    try {
      this.#trace.push(event)
      if (event.type === ReactiveTraceType.action && event.phase !== ReactiveTracePhase.start) {
        this.recordAction({
          name: event.name,
          durationMs: event.durationMs,
          error: event.phase === ReactiveTracePhase.error ? event.error : undefined
        })
      }
    } catch (error) {
      reportDevtoolsFailure(this.#store.$runtime, error)
    }
  }

  /** Undoes whichever subscriptions succeeded, then rethrows (aggregated with cleanup failures). */
  #rollbackSubscriptions(error: unknown): never {
    /** Cleanup failures behind the primary error. */
    const cleanupErrors: unknown[] = []
    for (const cleanup of [this.#unsubscribeTrace, this.#unsubscribe]) {
      try {
        cleanup?.()
      } catch (cleanupError) {
        cleanupErrors.push(cleanupError)
      }
    }
    if (cleanupErrors.length > 0) {
      throw createStoreDevtoolsAggregateError(
        StoreDevtoolsErrorCode.cleanupFailed,
        [error, ...cleanupErrors],
        StoreDevtoolsErrorText.cleanupFailed
      )
    }
    throw error
  }

  /** Frozen copy of the state history. */
  get history() {
    return Object.freeze(this.#history.values())
  }

  /** Frozen copy of the action traces. */
  get actions() {
    return Object.freeze(this.#actions.values())
  }

  /** Frozen copy of the runtime trace. */
  get trace() {
    return Object.freeze(this.#trace.values())
  }

  /** Records one state snapshot. */
  readonly record = (label: string = StoreDevtoolsLabel.stateChange): IStoreHistoryEntry => {
    this.#assertActive()
    /** Prepared entry. */
    const entry = this.#createEntry(label)
    this.#history.push(entry)
    return entry
  }

  /** Records one action trace; caller properties and the clock are each read once. */
  readonly recordAction = (action: Omit<IActionTrace, 'timestamp'>): void => {
    this.#assertActive()
    if (action === null || typeof action !== 'object')
      throw createStoreDevtoolsError(
        StoreDevtoolsErrorCode.invalidOption,
        StoreDevtoolsErrorText.actionInvalid
      )
    /** Caller-owned properties and the clock, each read once before publishing to the queue. */
    let entry: IActionTrace
    try {
      entry = { ...action, timestamp: this.#now() }
    } catch (error) {
      throw identifyDevtoolsFailure(error, StoreDevtoolsErrorText.preparationFailed)
    }
    // Validate the copied name, so a getter runs once and its failure keeps its classification.
    if (typeof entry.name !== 'string')
      throw createStoreDevtoolsError(
        StoreDevtoolsErrorCode.invalidOption,
        StoreDevtoolsErrorText.actionInvalid
      )
    this.#assertActive()
    this.#actions.push(entry)
  }

  /** Replays one recorded snapshot into the store without recording it again. */
  readonly jumpTo = (id: number): void => {
    this.#assertActive()
    /** Recorded entry with this id. */
    const entry = this.#history.find((candidate) => candidate.id === id)
    if (!entry)
      throw createStoreDevtoolsRangeError(
        StoreDevtoolsErrorCode.unknownHistoryEntry,
        StoreDevtoolsErrorText.unknownHistoryEntry(id)
      )
    this.#replayDepth++
    try {
      /** Replay cloning uses the same diagnostic error boundary as snapshot recording. */
      let state: Record<string, unknown>
      try {
        state = this.#clone(entry.state)
      } catch (error) {
        throw identifyDevtoolsFailure(error, StoreDevtoolsErrorText.preparationFailed)
      }
      this.#store.$hydrate(state as never)
    } finally {
      this.#replayDepth--
    }
  }

  /** Clears every queue and starts over from a fresh initial snapshot. */
  readonly clear = (): void => {
    this.#assertActive()
    /** Replacement snapshot prepared before any existing queue is truncated. */
    const initial = this.#createEntry(StoreDevtoolsLabel.initial)
    this.#history.clear()
    this.#actions.clear()
    this.#trace.clear()
    this.#history.push(initial)
  }

  /** Unsubscribes both sources once; failures are thrown (aggregated when more than one). */
  readonly dispose = (): void => {
    if (this.#disposed) return
    this.#disposed = true
    /** Unsubscribe failures. */
    const errors: unknown[] = []
    for (const cleanup of [this.#unsubscribe, this.#unsubscribeTrace]) {
      try {
        cleanup?.()
      } catch (error) {
        errors.push(error)
      }
    }
    if (errors.length === 1) throw errors[0]
    if (errors.length > 1)
      throw createStoreDevtoolsAggregateError(
        StoreDevtoolsErrorCode.cleanupFailed,
        errors,
        StoreDevtoolsErrorText.cleanupFailed
      )
  }
}
