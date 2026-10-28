/**
 * Owns synchronous dependency frames, speculative capture tokens, and transactional forward-edge
 * commits. Reverse-edge lifecycle and notification snapshots belong to subscriber-graph.ts.
 */
import type { IObservable, IObserver, IRuntime } from './types.ts'
import { internalsOf } from './internals.ts'
import { assertReactiveOwnedBy } from './ownership.ts'
import { createReactiveError, runReactiveCallback } from '../errors.ts'
import { ReactiveErrorCode } from '../error-code.ts'
import { ReactiveErrorText } from '../error-text.ts'
import { ReactiveNodeKind, ReactiveDependencyKind, ReactiveTraceReason } from './trace-constants.ts'
import {
  mutableDeps as mutableNodeDeps,
  mutableDepVersions as mutableNodeVersions
} from './node-internals.ts'
import {
  disconnectSubscribers,
  subscribeObservable,
  unsubscribeObservable
} from './subscriber-graph.ts'

/** One evaluation stages first-read dependencies without touching the committed graph. */
type ITrackingFrame =
  | {
      kind: typeof ReactiveDependencyKind.observer
      observer: IObserver
      nextDeps: Set<IObservable>
    }
  | {
      kind: typeof ReactiveDependencyKind.capture
      nextDeps: Set<IObservable>
      derivations: Map<IObservable, ICapturedDerivation>
    }

/** The type-only brand keeps captured dependencies and tracker identity out of the public token. */
declare const CAPTURE_TOKEN: unique symbol
/**
 * Opaque token returned by `IObserverBinding.capture`: `result` is what the read returned; the
 * captured dependencies stay private until `commit` installs them.
 */
export type ICapture<R> = {
  readonly result: R
  readonly [CAPTURE_TOKEN]: true
}

/** Private version and topology snapshots retained only while an opaque capture token is live. */
type ICaptureState = {
  /** Lazy derivations already evaluated in render, admitted only with this token's graph. */
  derivations: ReadonlyMap<IObservable, ICapturedDerivation>
  dependencies: Map<
    IObservable,
    {
      readonly version: number
      readonly topologyToken: object | undefined
    }
  >
}

/** One speculative lazy node reuses its existing capture rather than evaluating during commit. */
type ICapturedDerivation = {
  readonly observer: IObservable & IObserver
  readonly capture: ICapture<unknown>
  readonly state: ICaptureState
  readonly publish: () => void
  /** Existing lazy-node idle policy runs after all downstream edges have been admitted. */
  readonly afterCommit: () => void
}

/** The synchronous active tracker rejects cross-runtime reads while another graph is collecting. */
let activeTracker: DependencyTracker | null = null

/** Installs one synchronous tracking context and returns the previous owner for finally restoration. */
function swapActiveTracker(next: DependencyTracker): DependencyTracker | null {
  /** Nested evaluation restores exactly the tracker that owned its caller. */
  const previous = activeTracker
  activeTracker = next
  return previous
}

/** Owns evaluation frames and commits only successful reads, preserving the old graph on failure. */
export class DependencyTracker {
  /** Nested frames stage dependencies; a null frame temporarily disables collection. */
  #stack: (ITrackingFrame | null)[] = []
  /** Opaque tokens retain speculative snapshots without keeping abandoned renders alive. */
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
  /**
   * Topology snapshot of each suspended observer: dependency to its topology token at suspension.
   *
   * A suspended observer holds no reverse edges, so `disconnectObservable` cannot notify it. The
   * snapshot lets `revalidate` reject a dependency that was invalidated or disposed meanwhile. Weak
   * keys keep only forward references, which `depVersions` already holds; any non-fast-path commit
   * or `clearDependencies` deletes the entry.
   */
  #suspendedTopology = new WeakMap<IObserver, Map<IObservable, object | undefined>>()
  /** Canonical runtime authority used to reject foreign nodes and resolve graph services. */
  #runtime: IRuntime

  /** Binds one independent graph to its owning runtime without installing any edges. */
  constructor(runtime: IRuntime) {
    this.#runtime = runtime
  }

  /** Reads the innermost collection frame without changing nested evaluation state. */
  get #top(): ITrackingFrame | null {
    return this.#stack.length ? this.#stack[this.#stack.length - 1] : null
  }

  /** A capture or observer frame counts as active; an untracked frame suppresses collection. */
  #hasActiveObserver(): boolean {
    return this.#top !== null
  }

  /** Whether this tracker is currently collecting dependencies. */
  isTracking(): boolean {
    return activeTracker === this && this.#top !== null
  }

  /** Whether a lazy value must use its existing speculative evaluator instead of publishing. */
  isCapturing(): boolean {
    return activeTracker === this && this.#top?.kind === ReactiveDependencyKind.capture
  }

  /** Retains an evaluated lazy node with its enclosing render token; no graph is installed here. */
  stageDerivation(
    observer: IObservable & IObserver,
    capture: ICapture<unknown>,
    publish: () => void,
    afterCommit: () => void
  ): void {
    /** Only the enclosing capture owns speculative graph admission. */
    const frame = this.#top
    /** The node's existing token remains authoritative for versions and topology. */
    const state = this.#captures.get(capture)
    if (frame?.kind === ReactiveDependencyKind.capture && state)
      frame.derivations.set(observer, { observer, capture, state, publish, afterCommit })
  }

  /** Whether any Runtime is currently collecting a dependency frame. */
  static isAnyTracking(): boolean {
    return activeTracker !== null && activeTracker.#hasActiveObserver()
  }

  /** Stages a dependency in the current frame. Cross-runtime reads throw immediately. */
  track(observable: IObservable): void {
    if (activeTracker === this) {
      if (this.#top !== null) {
        assertReactiveOwnedBy(observable, this.#runtime, ReactiveNodeKind.observable)
        this.#top.nextDeps.add(observable)
      }
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
    this.#suspendedTopology.delete(observer)
    /** Kernel traversal uses the registered Set rather than the public readonly view. */
    const dependencies = mutableNodeDeps(observer, observer.deps)
    for (const dep of dependencies) unsubscribeObservable(this.#runtime, dep, observer)
    dependencies.clear()
    mutableNodeVersions(observer, observer.depVersions).clear()
  }

  /**
   * Suspends an idle observer: removes every reverse edge but keeps `depVersions` as a snapshot.
   *
   * The observer then holds no subscription, so it cannot leak through its dependencies. A later
   * `revalidate` decides from the snapshot whether the cached result is still current. An observer
   * without dependency edges (never attached or already suspended) is left unchanged.
   */
  suspendDependencies(observer: IObserver): void {
    /** Suspension reads the canonical Set once without exposing it to its owner. */
    const dependencies = mutableNodeDeps(observer, observer.deps)
    if (dependencies.size === 0) return
    /** Topology tokens at suspension, compared by `revalidate`. */
    const topology = new Map<IObservable, object | undefined>()
    for (const dep of dependencies) topology.set(dep, this.#topologyTokens.get(dep))
    this.#suspendedTopology.set(observer, topology)
    for (const dep of topology.keys()) unsubscribeObservable(this.#runtime, dep, observer)
    mutableNodeDeps(observer, observer.deps).clear()
  }

  /** Whether `suspendDependencies` detached this observer and no later commit has reattached it. */
  isSuspended(observer: IObserver): boolean {
    return this.#suspendedTopology.has(observer)
  }

  /**
   * Returns whether every recorded dependency still has its recorded version, so the observer's
   * cached result is current. Dependencies are pulled in recorded order and the check stops at the
   * first change, like `hasStaleDependencies`. `isStale()` also counts as a change, so a source
   * with an unsynchronized remote write still forces the observer's own read.
   *
   * For a suspended observer, a dependency invalidated or disposed since suspension is a change.
   * When the snapshot is still current, the observer is subscribed to its recorded dependencies
   * again.
   *
   * A dependency `pull()` failure returns `false`: the caller re-evaluates the observer, and that
   * evaluation reads the dependency again and owns its failure (rethrows it or handles it).
   */
  revalidate(observer: IObserver): boolean {
    /** Only suspended observers need topology validation before reconnecting their recorded graph. */
    const topology = this.#suspendedTopology.get(observer)
    try {
      for (const [dep, recordedVersion] of mutableNodeVersions(observer, observer.depVersions)) {
        if (
          topology !== undefined &&
          (this.#terminalObservables.has(dep) ||
            this.#topologyTokens.get(dep) !== topology.get(dep))
        ) {
          return false
        }
        dep.pull?.()
        if (dep.isStale?.() || dep.version !== recordedVersion) return false
      }
    } catch {
      // A dependency evaluation failure is reproduced by the caller's re-evaluation, not lost.
      return false
    }
    if (topology !== undefined)
      this.#commit(observer, new Set(mutableNodeVersions(observer, observer.depVersions).keys()))
    return true
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
    assertReactiveOwnedBy(observable, this.#runtime, ReactiveNodeKind.observable)
    /** Resolve trace services before invalidating topology, retaining the original mutation order. */
    const runtime = internalsOf(this.#runtime)
    this.#topologyTokens.set(observable, {})
    if (reason === ReactiveTraceReason.dispose) {
      this.#terminalObservables.add(observable)
    }
    disconnectSubscribers(runtime, observable, reason)
  }

  /**
   * Recomputes transactionally. Success commits dependency changes; failure discards the temporary
   * set.
   */
  runTracked<R>(observer: IObserver, fn: () => R): R {
    /** A fresh frame isolates this evaluation from reentrant reads and failed staging. */
    const frame: ITrackingFrame = {
      kind: ReactiveDependencyKind.observer,
      observer,
      nextDeps: new Set()
    }
    this.#stack.push(frame)
    /** The caller may belong to another untracked runtime and must regain its exact context. */
    const prevTracker = swapActiveTracker(this)
    try {
      /** Callback admission preserves the original synchronous result and error identity. */
      const result = runReactiveCallback(fn)
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
    /** A fresh frame isolates this evaluation from reentrant reads and failed staging. */
    const frame: ITrackingFrame = {
      kind: ReactiveDependencyKind.capture,
      nextDeps: new Set(),
      derivations: new Map()
    }
    this.#stack.push(frame)
    /** The caller may belong to another untracked runtime and must regain its exact context. */
    const prevTracker = swapActiveTracker(this)
    try {
      /** Callback admission preserves the original synchronous result and error identity. */
      const result = runReactiveCallback(fn)
      /** Captured first-read order is retained alongside each value version and topology identity. */
      const dependencies: ICaptureState['dependencies'] = new Map()
      for (const dep of frame.nextDeps) {
        dependencies.set(dep, {
          version: dep.version,
          topologyToken: this.#topologyTokens.get(dep)
        })
      }
      /** The public token exposes only the read result; graph metadata stays in the WeakMap. */
      const capture = { result } as ICapture<R>
      this.#captures.set(capture, { dependencies, derivations: frame.derivations })
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
    /** Only this tracker can redeem its still-live single-use token. */
    const state = this.#captures.get(capture)
    if (!state) {
      throw createReactiveError(ReactiveErrorCode.captureInvalid, ReactiveErrorText.captureInvalid)
    }
    this.#captures.delete(capture)
    /** One commit validates each shared speculative state once, retaining every recorded edge. */
    const validated = new Set<ICaptureState>()
    if (!this.#validateCapture(state, validated)) return false
    /** Lazy idle checks must see the complete graph, including when the idle channel is synchronous. */
    const applied = new Map<IObservable, ICapturedDerivation>()
    try {
      this.#applyCapture(observer, state, applied)
    } finally {
      for (const derivation of applied.values()) derivation.afterCommit()
    }
    return true
  }

  /**
   * Validates every speculative state and its recorded edges once before installing any graph
   * edges. Shared derivations reuse successful validation, keeping work O(captured edges).
   */
  #validateCapture(state: ICaptureState, validated: Set<ICaptureState>): boolean {
    if (validated.has(state)) return true
    for (const [dep, recorded] of state.dependencies) {
      if (
        this.#terminalObservables.has(dep) ||
        this.#topologyTokens.get(dep) !== recorded.topologyToken ||
        dep.version !== recorded.version
      ) {
        return false
      }
      if (dep.isStale?.()) {
        /** A dirty lazy node is admissible only through the exact evaluated child token. */
        const derivation = state.derivations.get(dep)
        if (
          !derivation ||
          this.#captures.get(derivation.capture) !== derivation.state ||
          !this.#validateCapture(derivation.state, validated)
        )
          return false
      }
    }
    validated.add(state)
    return true
  }

  /** Adopts validated lazy graphs from leaves upward, then commits the host observer once. */
  #applyCapture(
    observer: IObserver,
    state: ICaptureState,
    applied: Map<IObservable, ICapturedDerivation>
  ): void {
    for (const [dep, derivation] of state.derivations) {
      if (applied.has(dep) || !dep.isStale?.()) continue
      applied.set(dep, derivation)
      this.#captures.delete(derivation.capture)
      this.#applyCapture(derivation.observer, derivation.state, applied)
      derivation.publish()
    }
    this.#commit(observer, new Set(state.dependencies.keys()))
  }

  /** Reconciles changed memberships in O(old + next), preserving stable native iteration order. */
  #commit(observer: IObserver, nextDeps: Set<IObservable>): void {
    /** Capture raw collections once; readonly views remain the external diagnostic boundary. */
    const dependencies = mutableNodeDeps(observer, observer.deps)
    /** Version updates and membership checks share this canonical Map. */
    const depVersions = mutableNodeVersions(observer, observer.depVersions)
    // A suspended observer has no `deps` but keeps its `depVersions` snapshot; the size check
    // sends it through the full path, which subscribes again and replaces the snapshot.
    if (dependencies.size === nextDeps.size && depVersions.size === nextDeps.size) {
      /** Equal memberships preserve historical insertion order even when read order changes. */
      let sameTopology = true
      for (const dep of nextDeps) {
        if (!dependencies.has(dep)) {
          sameTopology = false
          break
        }
      }
      if (sameTopology) {
        for (const dep of nextDeps) depVersions.set(dep, dep.version)
        return
      }
    }
    this.#suspendedTopology.delete(observer)
    /** Stable pre-commit dependency snapshot; lifecycle callbacks may mutate the live view. */
    const prevDeps = new Set(dependencies)
    /** Reverse edges added by this commit; terminal rollback removes only these edges. */
    const newSubscriptions: IObservable[] = []
    for (const dep of prevDeps) {
      if (!nextDeps.has(dep)) unsubscribeObservable(this.#runtime, dep, observer)
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
      if (!prevDeps.has(dep)) subscribeObservable(this.#runtime, dep, observer)
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
    dependencies.clear()
    for (const dep of nextDeps) dependencies.add(dep)
    /** Snapshot versions before replacing the live Map, preserving reentrant getter read order. */
    const versions = new Map<IObservable, number>()
    for (const dep of nextDeps) versions.set(dep, dep.version)
    depVersions.clear()
    for (const [dep, version] of versions) depVersions.set(dep, version)
  }

  /**
   * Rolls back newly installed reverse edges after a lifecycle callback terminally disposes
   * observer.
   */
  #rollbackTerminalCommit(observer: IObserver, newSubscriptions: readonly IObservable[]): void {
    for (const observable of newSubscriptions)
      unsubscribeObservable(this.#runtime, observable, observer)
    mutableNodeDeps(observer, observer.deps).clear()
    mutableNodeVersions(observer, observer.depVersions).clear()
  }

  /**
   * Disables dependency collection while `fn` runs, for example during actions or cleanup
   * callbacks.
   */
  untracked<R>(fn: () => R): R {
    return this.#runUntracked(fn, undefined, false)
  }

  /** Executes a bound operation with one argument without allocating an untracked closure. */
  untrackedWith<TArg, R>(fn: (arg: TArg) => R, arg: TArg): R {
    return this.#runUntracked(fn, arg, true)
  }

  /** Owns tracking-context restoration for both public callbacks and argument-bound operations. */
  #runUntracked<TArg, R>(fn: (arg: TArg) => R, arg: TArg, withArgument: boolean): R {
    this.#stack.push(null)
    /** The caller may belong to another untracked runtime and must regain its exact context. */
    const prevTracker = swapActiveTracker(this)
    try {
      return withArgument ? fn(arg) : (fn as () => R)()
    } finally {
      this.#stack.pop()
      activeTracker = prevTracker
    }
  }

  /** Reattaches a known single dependency after callback-triggered invalidation or route release. */
  commitKnownDependency(observer: IObserver, observable: IObservable): void {
    this.#commit(observer, new Set([observable]))
  }

  /** Checks whether dependencies change after lazily pulling them to settle their versions. */
  hasStaleDependencies(observer: IObserver): boolean {
    for (const [dep, recordedVersion] of mutableNodeVersions(observer, observer.depVersions)) {
      dep.pull?.()
      if (dep.version !== recordedVersion) return true
    }
    return false
  }
}
