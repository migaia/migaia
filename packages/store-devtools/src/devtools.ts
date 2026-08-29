import {
  ReactiveErrorPhase,
  ReactiveTracePhase,
  ReactiveTraceType,
  type IObservable,
  type IObserver,
  type IRuntimeTraceEvent
} from '@migaia/reactive/runtime'
import type { IReactiveStore } from '@migaia/store-light'
import { ClonePolicy } from '@migaia/store-middleware/tolerant-clone'
import {
  createStoreDevtoolsAggregateError,
  createStoreDevtoolsError,
  createStoreDevtoolsRangeError
} from './errors.js'
import { StoreDevtoolsErrorCode } from './error-code.js'
import { StoreDevtoolsLabel, StoreDevtoolsNodeKind } from './devtools-constants.js'
import { StoreDevtoolsErrorText } from './error-text.js'

/** Rejects depth values that would silently disable the diagnostic traversal bound. */
function assertDepth(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw createStoreDevtoolsRangeError(
      StoreDevtoolsErrorCode.invalidOption,
      StoreDevtoolsErrorText.invalidDepth(name)
    )
  }
}

export type IDependencyTreeNode = {
  kind: (typeof StoreDevtoolsNodeKind)[keyof typeof StoreDevtoolsNodeKind]
  label: string
  version?: number
  children: IDependencyTreeNode[]
  circular?: boolean
}

export type IStoreHistoryEntry = {
  id: number
  timestamp: number
  label: string
  state: Record<string, unknown>
}

/** Reports diagnostic snapshot failures without allowing a hostile runtime sink to affect writes. */
function reportDevtoolsFailure(
  runtime: IReactiveStore<Record<string, unknown>>['$runtime'],
  error: unknown
): void {
  try {
    runtime.reportError(error, { phase: ReactiveErrorPhase.traceListener })
    return
  } catch (reporterError) {
    const host = (globalThis as { reportError?: (value: unknown) => void }).reportError
    try {
      if (host) host(reporterError)
      else console.error(reporterError)
    } catch {
      // Diagnostic sinks are best effort and must not break the business mutation.
    }
  }
}

export type IActionTrace = {
  timestamp: number
  name: string
  payload?: unknown
  durationMs?: number
  error?: unknown
}

export type IStoreDevToolsOptions = {
  maxHistory?: number
  maxTrace?: number
  captureRuntimeTrace?: boolean
  now?: () => number
  clone?: (state: Record<string, unknown>) => Record<string, unknown>
}

export type IStoreDevTools = {
  readonly history: readonly IStoreHistoryEntry[]
  readonly actions: readonly IActionTrace[]
  readonly trace: readonly IRuntimeTraceEvent[]
  record(label?: string): IStoreHistoryEntry
  recordAction(trace: Omit<IActionTrace, 'timestamp'>): void
  jumpTo(id: number): void
  clear(): void
  dispose(): void
}

const nodeLabel = (node: object): string =>
  (node as { debugName?: string }).debugName ??
  node.constructor?.name ??
  StoreDevtoolsLabel.anonymousReactiveNode

// 环判定按「当前这条路径」，不是全局访问集：菱形里的共享节点会被两条路径各展开一次——
// 那是共享，不是环。只有重新踩到仍在当前路径上的节点才是环，因此进入时入栈、返回时出栈。
export function getDependencyTree(observer: IObserver, maxDepth = 20): IDependencyTreeNode {
  assertDepth(maxDepth, 'dependency tree')
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

export function getObserverTree(observable: IObservable, maxDepth = 20): IDependencyTreeNode {
  assertDepth(maxDepth, 'observer tree')
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
  const history: IStoreHistoryEntry[] = []
  const actions: IActionTrace[] = []
  const trace: IRuntimeTraceEvent[] = []
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
    /** Timestamp is evaluated before reserving an id so a failing clock leaves queues unchanged. */
    const timestamp = now()
    /** Snapshot is fully cloned before reserving an id or mutating any diagnostic queue. */
    const state = Object.freeze(clone(store.$plain()))
    /** Fully prepared history entry ready for atomic publication. */
    const entry: IStoreHistoryEntry = Object.freeze({ id: nextId, timestamp, label, state })
    nextId++
    return entry
  }
  const record = (label: string = StoreDevtoolsLabel.stateChange): IStoreHistoryEntry => {
    assertActive()
    const entry = createEntry(label)
    history.push(entry)
    if (history.length > maxHistory) history.splice(0, history.length - maxHistory)
    return entry
  }
  const recordAction = (action: Omit<IActionTrace, 'timestamp'>): void => {
    assertActive()
    actions.push({ ...action, timestamp: now() })
    if (actions.length > maxTrace) {
      actions.splice(0, actions.length - maxTrace)
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
              if (trace.length > maxTrace) {
                trace.splice(0, trace.length - maxTrace)
              }
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
      return Object.freeze([...history])
    },
    get actions() {
      return Object.freeze([...actions])
    },
    get trace() {
      return Object.freeze([...trace])
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
        store.$hydrate(clone(entry.state))
      } finally {
        replayDepth--
      }
    },
    clear() {
      assertActive()
      /** Replacement snapshot prepared before any existing queue is truncated. */
      const initial = createEntry(StoreDevtoolsLabel.initial)
      history.length = 0
      actions.length = 0
      trace.length = 0
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
