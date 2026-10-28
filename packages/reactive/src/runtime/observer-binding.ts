import type { ICapture } from './dependency-tracker.class.ts'
import { internalsOf } from './internals.ts'
import type { IDisposer, IReactiveNodeOptions, IRuntime } from './types.ts'
import { Effect } from '../reactive/effect.class.ts'
import { createReactiveError } from '../errors.ts'
import { ReactiveErrorCode } from '../error-code.ts'
import { ReactiveErrorText } from '../error-text.ts'
import type { IObservable, IObserver } from './types.ts'
import { assertGraphNodeUnregistered, registerDeps, registerDepVersions } from './node-internals.ts'
import { claimOwnership } from './ownership.ts'
import { deferRuntimeCleanup } from './deferred-cleanup.ts'

/** Graph participation for one custom observer; the tracker and mutable edge sets stay private. */
export type ITrackedObserverBinding = Readonly<{
  /** Read-only current dependencies maintained by the tracker. */
  readonly deps: ReadonlySet<IObservable>
  /** Read-only versions recorded during the last tracked execution. */
  readonly depVersions: ReadonlyMap<IObservable, number>
  /** Runs synchronous reads in this observer's dependency frame and preserves callback errors. */
  runTracked<T>(read: () => T): T
  /** Disconnects this observer while keeping lifecycle policy with its owner. */
  clear(): void
  /** Removes reverse edges while retaining the dependency version snapshot. */
  suspend(): void
  /** Reports whether this observer has a retained suspended snapshot. */
  isSuspended(): boolean
  /** Pulls and compares the retained snapshot, reattaching unchanged dependencies. */
  revalidate(): boolean
  /** Pulls upstream dependencies and reports whether any recorded version changed. */
  hasStaleDependencies(): boolean
  /** Uses the runtime's admitted idle channel for this observer owner's work. */
  deferIdle(task: () => void): void
}>

/**
 * Registers a fresh custom observer and binds only its required graph operations. Assign the
 * returned readonly edge views before invoking any operation or exposing the observer.
 * Resource/request ownership and scheduling decisions remain with the caller.
 */
export function createTrackedObserver(observer: IObserver): ITrackedObserverBinding {
  /** Capture the owning services before creating graph bookkeeping. */
  const runtime = observer.runtime
  /** Methods close over this one tracker but never return the tracker itself. */
  const services = internalsOf(runtime)
  assertGraphNodeUnregistered(observer)
  claimOwnership(observer, runtime)
  /** Canonical read-only views share the kernel's private writable edge collections. */
  const deps = registerDeps(observer, new Set<IObservable>())
  /** Version snapshots remain owned by the tracker rather than by the extension. */
  const depVersions = registerDepVersions(observer, new Map<IObservable, number>())
  return Object.freeze({
    deps,
    depVersions,
    runTracked: <T>(read: () => T): T => services.tracker.runTracked(observer, read),
    clear: () => services.tracker.clearDependencies(observer),
    suspend: () => services.tracker.suspendDependencies(observer),
    isSuspended: () => services.tracker.isSuspended(observer),
    revalidate: () => services.tracker.revalidate(observer),
    hasStaleDependencies: () => services.tracker.hasStaleDependencies(observer),
    deferIdle: (task: () => void) => deferRuntimeCleanup(runtime, task)
  })
}

/**
 * Outcome of a capture commit.
 *
 * - `committed`: dependency edges are installed.
 * - `stale`: dependencies change after capture; the token is consumed and requires a fresh capture.
 * - `no-observer`: the target does not exist yet; the token remains reusable when the observer is
 *   ready.
 */
export type IObserverCommitResult = 'committed' | 'stale' | 'no-observer'
/**
 * Result of `retrack()`: whether the observer's dependencies or versions changed, or no observer
 * exists.
 */
export type IObserverRetrackResult = 'changed' | 'unchanged' | 'no-observer'

/**
 * Public interface for capture, observation, and commit.
 *
 * Concurrent host adapters capture dependencies read-only during render and install them during
 * commit. React can discard an intermediate render, so capture cannot create edges. Dependencies
 * can change before commit, so commit can fail and request a fresh capture.
 *
 * This replaces privileged access to `runtime/internals` in the repository's React adapter.
 * Third-party Vue, Solid, Svelte, or React adapters can use the same concurrent-safe path without
 * creating edges at subscription time and reopening the tearing window.
 *
 * `capture` records reads and versions without creating edges, enqueueing work, or changing
 * versions. `ICapture` is an opaque branded token whose dependencies stay in the tracker's private
 * WeakMap. Token holders cannot inspect those dependencies or modify versions. `commit` installs
 * the token only on this binding's observer, never on another observer or as a one-sided edge.
 */
export type IObserverBinding = {
  /**
   * Captures dependencies during render.
   *
   * Records the nodes read and their versions without creating dependency edges. Discarded renders
   * therefore leave no subscriptions.
   */
  capture<R>(read: () => R): ICapture<R>
  /**
   * Install the binding-owned observer. Keeping the concrete Effect private prevents adapters from
   * mutating deps/versions or calling run/markDirty.
   */
  observe(fn: () => void | IDisposer, options?: IReactiveNodeOptions): IDisposer
  /**
   * Installs captured dependencies during commit.
   *
   * Three outcomes distinguish a required fresh capture from a missing observer. Invalidate the
   * snapshot and reread only for `stale`. Do not pull dirty nodes during commit, because evaluation
   * errors would bypass the Error Boundary.
   */
  commit(capture: ICapture<unknown>): IObserverCommitResult
  /** Force one committed observer run and report whether its dependency set changed. */
  retrack(): IObserverRetrackResult
}

/**
 * Creates a binding for one observer.
 *
 * Capture runs during render; the observer exists only during host subscription. The binding owns
 * its `Effect` and exposes `capture`, `observe`, `commit`, and `retrack`. Adapters cannot access
 * dependencies, versions, or forced scheduling ports.
 */
export function createObserverBinding(runtime: IRuntime): IObserverBinding {
  const tracker = internalsOf(runtime).tracker
  let observer: Effect | undefined
  const dependenciesChanged = (
    before: ReadonlyMap<object, number>,
    after: ReadonlyMap<object, number>
  ): boolean => {
    if (before.size !== after.size) return true
    for (const [dependency, version] of after) {
      if (before.get(dependency) !== version) return true
    }
    return false
  }
  return {
    capture: (read) => tracker.capture(read),
    observe: (fn, options) => {
      if (observer && !observer.disposed) {
        throw createReactiveError(
          ReactiveErrorCode.bindingDuplicate,
          ReactiveErrorText.observerBindingAlreadyObserved
        )
      }
      const current = new Effect(fn, runtime, options)
      observer = current
      let active = true
      return () => {
        if (!active) return
        active = false
        current.dispose()
        if (observer === current) observer = undefined
      }
    },
    commit: (capture) => {
      const current = observer
      if (!current || current.disposed) return 'no-observer'
      return tracker.commitCapture(current, capture) ? 'committed' : 'stale'
    },
    retrack: () => {
      const current = observer
      if (!current || current.disposed) return 'no-observer'
      const before = new Map(current.depVersions)
      current.run()
      if (current.disposed) return 'no-observer'
      return dependenciesChanged(before, current.depVersions) ? 'changed' : 'unchanged'
    }
  }
}
