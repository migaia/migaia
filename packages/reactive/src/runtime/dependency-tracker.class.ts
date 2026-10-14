import type { IObservable, IObserver, IRuntime } from './types.js'
import { internalsOf } from './internals.js'
import { assertReactiveOwnedBy } from './ownership.js'
import { describeObservable, describeObserver, emitTraceSafely } from './diagnostics.js'
import { createReactiveError } from '../errors.js'
import { ReactiveErrorCode } from '../error-code.js'
import { ReactiveErrorText } from '../error-text.js'
import {
  ReactiveDependencyKind,
  ReactiveErrorPhase,
  ReactiveTracePhase,
  ReactiveTraceReason,
  ReactiveTraceType
} from './trace-constants.js'
import {
  mutableSubs as mutableNodeSubs,
  mutableDeps as mutableNodeDeps,
  mutableDepVersions as mutableNodeVersions
} from './node-internals.js'

function mutableSubs(observable: IObservable): Set<IObserver> {
  return mutableNodeSubs(observable, observable.subs)
}

// 一次追踪的临时帧：fn 执行期间读到的依赖先攒在 nextDeps，不碰正式依赖边。
type ITrackingFrame =
  | {
      kind: typeof ReactiveDependencyKind.observer
      observer: IObserver
      nextDeps: Set<IObservable>
    }
  | { kind: typeof ReactiveDependencyKind.capture; nextDeps: Set<IObservable> }

// Capture 的依赖与 Tracker 身份只存在于私有 WeakMap；调用者只能读取结果并交回整个 token。
declare const CAPTURE_TOKEN: unique symbol
export type ICapture<R> = {
  readonly result: R
  readonly [CAPTURE_TOKEN]: true
}

type ICaptureState = {
  dependencies: Map<
    IObservable,
    {
      readonly version: number
      readonly topologyToken: object | undefined
    }
  >
}

// 全局「当前正在追踪的 tracker」——单线程 JS 里同一时刻只有一个求值在进行，用它跨 tracker 检测跨 runtime 依赖。
// track() 被派发到「被读节点所属 runtime 的 tracker」上；若那个 tracker 不是当前活跃 tracker，
// 且当前活跃 tracker 确实在追踪（有 observer），说明是跨 runtime 读取——立即抛错，杜绝静默陈旧数据。
let activeTracker: DependencyTracker | null = null

// 集中管理模块级同步追踪上下文，避免各方法直接写全局槽位。
function swapActiveTracker(next: DependencyTracker): DependencyTracker | null {
  const previous = activeTracker
  activeTracker = next
  return previous
}

// Per-runtime dependency tracking owns evaluation context, staged edges, edge commits, disconnection, and stale checks.
// During `runTracked`, `track()` stages `nextDeps`. Success commits changes; failure discards them and preserves the old graph.
export class DependencyTracker {
  #stack: (ITrackingFrame | null)[] = []
  #captures = new WeakMap<object, ICaptureState>()
  /**
   * Terminal invalidation is deliberately independent from VersionClock.
   *
   * Exhausting the monotonic clock must stop future writes, but it must never prevent graph
   * cleanup. A WeakSet also lets a render captured before disposal fail validation without
   * consuming another global version.
   */
  #terminalObservables = new WeakSet<IObservable>()
  /**
   * Dependency-edge invalidation is topology, not value state. An opaque identity avoids consuming
   * VersionClock and has no numeric exhaustion.
   */
  #topologyTokens = new WeakMap<IObservable, object>()
  #runtime: IRuntime

  constructor(runtime: IRuntime) {
    this.#runtime = runtime
  }

  get #top(): ITrackingFrame | null {
    return this.#stack.length ? this.#stack[this.#stack.length - 1] : null
  }

  #hasActiveObserver(): boolean {
    return this.#top !== null
  }

  /** Whether this tracker is currently collecting dependencies. */
  isTracking(): boolean {
    return activeTracker === this && this.#top !== null
  }

  /** Whether any Runtime is currently collecting a dependency frame. */
  static isAnyTracking(): boolean {
    return activeTracker !== null && activeTracker.#hasActiveObserver()
  }

  /** Stages a dependency in the current frame. Cross-runtime reads throw immediately. */
  track(observable: IObservable): void {
    this.#assertObservableOwner(observable)
    if (activeTracker === this) {
      this.#top?.nextDeps.add(observable)
      return
    }
    // 派发到的是本 observable 所属 runtime 的 tracker；若它不是当前活跃 tracker 而别处正在追踪 → 跨 runtime
    if (activeTracker !== null && activeTracker.#hasActiveObserver()) {
      throw createReactiveError(
        ReactiveErrorCode.crossRuntime,
        ReactiveErrorText.crossRuntimeDependency
      )
    }
    // 无人追踪（或对方处于 untracked）→ 无依赖可建，静默跳过
  }

  /** Disconnects all dependency edges for an observer during disposal. */
  clearDependencies(observer: IObserver): void {
    for (const dep of observer.deps) this.#unsubscribe(dep, observer)
    mutableNodeDeps(observer, observer.deps).clear()
    mutableNodeVersions(observer, observer.depVersions).clear()
  }

  /**
   * Atomically removes every reverse edge of an observable, then notifies downstream nodes of
   * invalidation.
   *
   * `invalidate` keeps the node reusable, for example after an atom override. `dispose` is
   * terminal. Both replace an independent topology token so pending captures become stale. Neither
   * consumes a global value version, so disposal and route removal still work after clock
   * exhaustion.
   */
  disconnectObservable(
    observable: IObservable,
    reason: typeof ReactiveTraceReason.invalidate | typeof ReactiveTraceReason.dispose
  ): void {
    this.#assertObservableOwner(observable)
    const runtime = internalsOf(this.#runtime)
    this.#topologyTokens.set(observable, {})
    if (reason === 'dispose') {
      this.#terminalObservables.add(observable)
    }
    const observers = [...observable.subs]
    mutableSubs(observable).clear()
    for (const observer of observers) {
      mutableNodeDeps(observer, observer.deps).delete(observable)
      mutableNodeVersions(observer, observer.depVersions).delete(observable)
      if (runtime.traceEnabled()) {
        emitTraceSafely(
          {
            timestamp: runtime.timestamp,
            emitTrace: runtime.emitTrace,
            reportError: (error) =>
              observer.runtime.reportError(error, {
                phase: ReactiveErrorPhase.traceListener,
                observer,
                observable
              })
          },
          (timestamp) => ({
            type: ReactiveTraceType.dependency,
            timestamp,
            phase: ReactiveTracePhase.disconnect,
            observable: describeObservable(observable),
            observer: describeObserver(observer),
            reason
          })
        )
      }
    }
    for (const observer of observers) {
      try {
        observer.onDependencyDisconnected(observable)
      } catch (error) {
        observer.runtime.reportError(error, {
          phase: ReactiveErrorPhase.dependencyDisconnect,
          observer: describeObserver(observer),
          observable: describeObservable(observable)
        })
      }
    }
  }

  /**
   * Recomputes transactionally. Success commits dependency changes; failure discards the temporary
   * set.
   */
  runTracked<R>(observer: IObserver, fn: () => R): R {
    const frame: ITrackingFrame = {
      kind: ReactiveDependencyKind.observer,
      observer,
      nextDeps: new Set()
    }
    this.#stack.push(frame)
    const prevTracker = swapActiveTracker(this)
    try {
      const result = fn()
      if (!observer.disposed) this.#commit(observer, frame.nextDeps)
      return result
    } finally {
      this.#stack.pop()
      activeTracker = prevTracker
    }
  }

  /**
   * Captures render dependencies and versions without changing subscription edges. Discarded
   * Concurrent React renders cannot leak subscriptions.
   */
  capture<R>(fn: () => R): ICapture<R> {
    const frame: ITrackingFrame = {
      kind: ReactiveDependencyKind.capture,
      nextDeps: new Set()
    }
    this.#stack.push(frame)
    const prevTracker = swapActiveTracker(this)
    try {
      const result = fn()
      const dependencies: ICaptureState['dependencies'] = new Map()
      for (const dep of frame.nextDeps) {
        dependencies.set(dep, {
          version: dep.version,
          topologyToken: this.#topologyTokens.get(dep)
        })
      }
      const capture = { result } as ICapture<R>
      this.#captures.set(capture, { dependencies })
      return capture
    } finally {
      this.#stack.pop()
      activeTracker = prevTracker
    }
  }

  /**
   * Atomically validates and commits one capture. `false` means dependencies changed and requires
   * reevaluation. Tokens are single-use and require this tracker's observer.
   */
  commitCapture(observer: IObserver, capture: ICapture<unknown>): boolean {
    if (internalsOf(observer.runtime).tracker !== this) {
      throw createReactiveError(
        ReactiveErrorCode.crossRuntime,
        ReactiveErrorText.captureDifferentRuntime
      )
    }
    // A Concurrent render may finish after its committed observer was
    // disposed. Reject before consuming the token so a replacement observer
    // can still validate and commit the same capture.
    if (observer.disposed) {
      throw createReactiveError(
        ReactiveErrorCode.captureInvalid,
        ReactiveErrorText.captureDisposedObserver
      )
    }
    const state = this.#captures.get(capture)
    if (!state) {
      throw createReactiveError(ReactiveErrorCode.captureInvalid, ReactiveErrorText.captureInvalid)
    }
    this.#captures.delete(capture)
    for (const [dep, recorded] of state.dependencies) {
      if (
        this.#terminalObservables.has(dep) ||
        this.#topologyTokens.get(dep) !== recorded.topologyToken ||
        dep.isStale?.() ||
        dep.version !== recorded.version
      ) {
        return false
      }
    }
    this.#commit(observer, new Set(state.dependencies.keys()))
    return true
  }

  #commit(observer: IObserver, nextDeps: Set<IObservable>): void {
    if (observer.deps.size === nextDeps.size) {
      let sameTopology = true
      for (const dep of nextDeps) {
        if (!observer.deps.has(dep)) {
          sameTopology = false
          break
        }
      }
      if (sameTopology) {
        const versions = mutableNodeVersions(observer, observer.depVersions)
        for (const dep of nextDeps) versions.set(dep, dep.version)
        return
      }
    }
    /** Stable pre-commit dependency snapshot; lifecycle callbacks may mutate the live view. */
    const prevDeps = new Set(observer.deps)
    /** Reverse edges added by this commit; terminal rollback removes only these edges. */
    const newSubscriptions: IObservable[] = []
    for (const dep of prevDeps) {
      if (!nextDeps.has(dep)) this.#unsubscribe(dep, observer)
      if (observer.disposed) {
        this.#rollbackTerminalCommit(observer, newSubscriptions)
        return
      }
    }
    for (const dep of nextDeps) {
      if (observer.disposed) {
        this.#rollbackTerminalCommit(observer, newSubscriptions)
        return
      }
      if (!prevDeps.has(dep)) this.#subscribe(dep, observer)
      if (!prevDeps.has(dep)) newSubscriptions.push(dep)
      if (observer.disposed) {
        this.#rollbackTerminalCommit(observer, newSubscriptions)
        return
      }
    }
    if (observer.disposed) {
      this.#rollbackTerminalCommit(observer, newSubscriptions)
      return
    }
    const mutableDeps = mutableNodeDeps(observer, observer.deps)
    mutableDeps.clear()
    for (const dep of nextDeps) mutableDeps.add(dep)
    const versions = new Map<IObservable, number>()
    for (const dep of nextDeps) versions.set(dep, dep.version)
    const mutableVersions = mutableNodeVersions(observer, observer.depVersions)
    mutableVersions.clear()
    for (const [dep, version] of versions) mutableVersions.set(dep, version)
  }

  /**
   * Rolls back newly installed reverse edges after a lifecycle callback terminally disposes
   * observer.
   */
  #rollbackTerminalCommit(observer: IObserver, newSubscriptions: readonly IObservable[]): void {
    for (const observable of newSubscriptions) this.#unsubscribe(observable, observer)
    mutableNodeDeps(observer, observer.deps).clear()
    mutableNodeVersions(observer, observer.depVersions).clear()
  }

  #subscribe(observable: IObservable, observer: IObserver): void {
    this.#assertObservableOwner(observable)
    assertReactiveOwnedBy(observer, this.#runtime, 'observer')
    const runtime = internalsOf(this.#runtime)
    const wasUnobserved = observable.subs.size === 0
    mutableSubs(observable).add(observer)
    if (wasUnobserved) {
      try {
        observable.onObserved?.()
      } catch (error) {
        observer.runtime.reportError(error, {
          phase: ReactiveErrorPhase.lifecycleHook,
          observer: describeObserver(observer),
          observable: describeObservable(observable)
        })
      }
    }
    if (runtime.traceEnabled()) {
      emitTraceSafely(
        {
          timestamp: runtime.timestamp,
          emitTrace: runtime.emitTrace,
          reportError: (error) =>
            observer.runtime.reportError(error, {
              phase: ReactiveErrorPhase.traceListener,
              observer,
              observable
            })
        },
        (timestamp) => ({
          type: ReactiveTraceType.dependency,
          timestamp,
          phase: ReactiveTracePhase.connect,
          observable: describeObservable(observable),
          observer: describeObserver(observer)
        })
      )
    }
  }

  #unsubscribe(observable: IObservable, observer: IObserver): void {
    this.#assertObservableOwner(observable)
    if (!mutableSubs(observable).delete(observer)) return
    const runtime = internalsOf(this.#runtime)
    if (runtime.traceEnabled()) {
      emitTraceSafely(
        {
          timestamp: runtime.timestamp,
          emitTrace: runtime.emitTrace,
          reportError: (error) =>
            observer.runtime.reportError(error, {
              phase: ReactiveErrorPhase.traceListener,
              observer,
              observable
            })
        },
        (timestamp) => ({
          type: ReactiveTraceType.dependency,
          timestamp,
          phase: ReactiveTracePhase.disconnect,
          observable: describeObservable(observable),
          observer: describeObserver(observer),
          reason: ReactiveTraceReason.retrack
        })
      )
    }
    if (observable.subs.size === 0) {
      try {
        observable.onUnobserved?.()
      } catch (error) {
        observer.runtime.reportError(error, {
          phase: ReactiveErrorPhase.lifecycleHook,
          observer: describeObserver(observer),
          observable: describeObservable(observable)
        })
      }
    }
  }

  #assertObservableOwner(observable: IObservable): void {
    assertReactiveOwnedBy(observable, this.#runtime, 'observable')
  }

  /**
   * Disables dependency collection while `fn` runs, for example during actions or cleanup
   * callbacks.
   */
  untracked<R>(fn: () => R): R {
    this.#stack.push(null)
    const prevTracker = swapActiveTracker(this)
    try {
      return fn()
    } finally {
      this.#stack.pop()
      activeTracker = prevTracker
    }
  }

  /** Checks whether dependencies change after lazily pulling them to settle their versions. */
  hasStaleDependencies(observer: IObserver): boolean {
    for (const [dep, recordedVersion] of observer.depVersions) {
      dep.pull?.()
      if (dep.version !== recordedVersion) return true
    }
    return false
  }
}
