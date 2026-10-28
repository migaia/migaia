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

// Detects cycles on the current path rather than through a global visited set. Shared diamond nodes expand once per path.
// Only revisiting a node still on that path is a cycle. Push on entry and remove on return.
/**
 * Inspect the current dependencies of a real Effect/Computed handle or extension observer without
 * changing graph subscriptions. maxDepth defaults to 20, accepts nonnegative safe integers, and
 * zero keeps only the root. The mutable result expands shared nodes once per path, marks only a
 * current-path repeat circular, and stops there. Invalid depth throws INVALID_OPTION RangeError.
 */
export function getDependencyTree(
  root: IObserver | IReactiveEffect | IReactiveComputed<unknown>,
  maxDepth = 20
): IDependencyTreeNode {
  assertDepth(maxDepth, 'dependency tree')
  /** Runtime factories return the existing observer node behind the narrow public handle. */
  const observer = root as IObserver
  const path = new Set<object>()
  const visitObservable = (current: IObservable, depth: number): IDependencyTreeNode => {
    const node: IDependencyTreeNode = {
      kind: StoreDevtoolsNodeKind.observable,
      label: nodeLabel(current),
      version: current.version,
      children: []
    }
    // 成环的那个节点自己带上标记——早期版本只取下游的 children，circular 被顺手丢掉了
    if (path.has(current)) {
      node.circular = true
      return node
    }
    if (depth >= maxDepth || !('deps' in current)) return node
    path.add(current)
    try {
      node.children = [...(current as IObservable & IObserver).deps].map((dependency) =>
        visitObservable(dependency, depth + 1)
      )
    } finally {
      path.delete(current)
    }
    return node
  }
  path.add(observer)
  return {
    kind: StoreDevtoolsNodeKind.observer,
    label: nodeLabel(observer),
    children: depth0Exceeds(0, maxDepth)
      ? []
      : [...observer.deps].map((dependency) => visitObservable(dependency, 1))
  }
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
  const path = new Set<object>()
  const visitObserver = (current: IObserver, depth: number): IDependencyTreeNode => {
    const node: IDependencyTreeNode = {
      kind: StoreDevtoolsNodeKind.observer,
      label: nodeLabel(current),
      children: []
    }
    if (path.has(current)) {
      node.circular = true
      return node
    }
    if (depth >= maxDepth || !('subs' in current)) return node
    path.add(current)
    try {
      node.children = [...(current as IObserver & IObservable).subs].map((subscriber) =>
        visitObserver(subscriber, depth + 1)
      )
    } finally {
      path.delete(current)
    }
    return node
  }
  path.add(observable)
  return {
    kind: StoreDevtoolsNodeKind.observable,
    label: nodeLabel(observable),
    version: observable.version,
    children: depth0Exceeds(0, maxDepth)
      ? []
      : [...observable.subs].map((subscriber) => visitObserver(subscriber, 1))
  }
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
  if (options === null || typeof options !== 'object') {
    throw createStoreDevtoolsError(
      StoreDevtoolsErrorCode.invalidOption,
      StoreDevtoolsErrorText.optionsObject
    )
  }
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
  const validateLimit = (value: number | undefined, fallback: number, name: string): number => {
    const resolved = value ?? fallback
    if (!Number.isSafeInteger(resolved) || resolved < 1)
      throw createStoreDevtoolsError(
        StoreDevtoolsErrorCode.invalidOption,
        StoreDevtoolsErrorText.invalidLimit(name)
      )
    return resolved
  }
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
  const now = optionValues.now ?? Date.now
  const clone = optionValues.clone ?? ClonePolicy.diagnostic
  const history = new BoundedQueue<IStoreHistoryEntry>(maxHistory)
  const actions = new BoundedQueue<IActionTrace>(maxTrace)
  const trace = new BoundedQueue<IRuntimeTraceEvent>(maxTrace)
  let nextId = 1
  // 计数而非布尔：回放期间监听器再次 jumpTo 时，内层的 finally 不能提前解除外层的回放屏蔽，
  // 否则外层剩余的通知会被当成用户操作记进历史。
  let replayDepth = 0
  let disposed = false

  const assertActive = () => {
    if (disposed)
      throw createStoreDevtoolsError(
        StoreDevtoolsErrorCode.sessionDisposed,
        StoreDevtoolsErrorText.sessionDisposed
      )
  }
  const createEntry = (label: string): IStoreHistoryEntry => {
    try {
      /** Timestamp is evaluated before reserving an id so a failing clock leaves queues unchanged. */
      const timestamp = now()
      /** Snapshot is fully cloned before reserving an id or mutating any diagnostic queue. */
      const state = Object.freeze(clone(store.$plain()))
      assertActive()
      /** Fully prepared history entry ready for atomic publication. */
      const entry: IStoreHistoryEntry = Object.freeze({ id: nextId, timestamp, label, state })
      nextId++
      return entry
    } catch (error) {
      throw identifyDevtoolsFailure(error, StoreDevtoolsErrorText.preparationFailed)
    }
  }
  const record = (label: string = StoreDevtoolsLabel.stateChange): IStoreHistoryEntry => {
    assertActive()
    const entry = createEntry(label)
    history.push(entry)
    return entry
  }
  const recordAction = (action: Omit<IActionTrace, 'timestamp'>): void => {
    assertActive()
    try {
      /** Prepare all caller-owned properties and the clock before publishing to the queue. */
      const entry = { ...action, timestamp: now() }
      assertActive()
      actions.push(entry)
    } catch (error) {
      throw identifyDevtoolsFailure(error, StoreDevtoolsErrorText.preparationFailed)
    }
  }
  record(StoreDevtoolsLabel.initial)
  let unsubscribe: (() => void) | undefined
  let unsubscribeTrace: (() => void) | undefined
  try {
    unsubscribe = store.$subscribe(() => {
      if (replayDepth > 0) return
      try {
        record()
      } catch (error) {
        // 诊断工具坏掉不能让业务写入跟着失败：快照/克隆异常在这里就地上报，
        // 绝不冒泡进 store 的 flush（那会让一次普通赋值抛错）。
        reportDevtoolsFailure(store.$runtime, error)
      }
    })
    unsubscribeTrace =
      optionValues.captureRuntimeTrace === false
        ? () => {}
        : store.$runtime.subscribeTrace((event) => {
            if (disposed) return
            try {
              trace.push(event)
              if (
                event.type === ReactiveTraceType.action &&
                event.phase !== ReactiveTracePhase.start
              ) {
                recordAction({
                  name: event.name,
                  durationMs: event.durationMs,
                  error: event.phase === ReactiveTracePhase.error ? event.error : undefined
                })
              }
            } catch (error) {
              reportDevtoolsFailure(store.$runtime, error)
            }
          })
  } catch (error) {
    const cleanupErrors: unknown[] = []
    for (const cleanup of [unsubscribeTrace, unsubscribe]) {
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

  return {
    get history() {
      return Object.freeze(history.values())
    },
    get actions() {
      return Object.freeze(actions.values())
    },
    get trace() {
      return Object.freeze(trace.values())
    },
    record,
    recordAction,
    jumpTo(id) {
      assertActive()
      const entry = history.find((candidate) => candidate.id === id)
      if (!entry)
        throw createStoreDevtoolsRangeError(
          StoreDevtoolsErrorCode.unknownHistoryEntry,
          StoreDevtoolsErrorText.unknownHistoryEntry(id)
        )
      replayDepth++
      try {
        /** Replay cloning uses the same diagnostic error boundary as snapshot recording. */
        let state: Record<string, unknown>
        try {
          state = clone(entry.state)
        } catch (error) {
          throw identifyDevtoolsFailure(error, StoreDevtoolsErrorText.preparationFailed)
        }
        store.$hydrate(state)
      } finally {
        replayDepth--
      }
    },
    clear() {
      assertActive()
      /** Replacement snapshot prepared before any existing queue is truncated. */
      const initial = createEntry(StoreDevtoolsLabel.initial)
      history.clear()
      actions.clear()
      trace.clear()
      history.push(initial)
    },
    dispose() {
      if (disposed) return
      disposed = true
      const errors: unknown[] = []
      for (const cleanup of [unsubscribe, unsubscribeTrace]) {
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
}
