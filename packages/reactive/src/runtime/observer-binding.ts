/** Owns controlled custom graph participation and host render/commit observer lifecycles. */
import type { DependencyTracker, ICapture } from './dependency-tracker.class.ts'
import { internalsOf, type IRuntimeInternals } from './internals.ts'
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

/** Registers one custom observer while keeping mutable graph services on its private owner. */
class TrackedObserver {
  /** Exact observer identity admitted to the canonical dependency tracker. */
  readonly #observer: IObserver
  /** Captured owning runtime supplies the existing admitted idle channel. */
  readonly #runtime: IRuntime
  /** Captured kernel services remain private while their read-only edge views are published. */
  readonly #services: IRuntimeInternals
  /** Frozen ordinary-object port preserves detached calls and the original own property order. */
  readonly binding: ITrackedObserverBinding

  /** Registers canonical collections before exposing operations that can enter a dependency frame. */
  constructor(observer: IObserver) {
    this.#observer = observer
    this.#runtime = observer.runtime
    this.#services = internalsOf(this.#runtime)
    assertGraphNodeUnregistered(observer)
    claimOwnership(observer, this.#runtime)
    /** Read-only dependencies share the tracker's private writable collection. */
    const deps = registerDeps(observer, new Set<IObservable>())
    /** Version snapshots remain owned and maintained by the canonical tracker. */
    const depVersions = registerDepVersions(observer, new Map<IObservable, number>())
    this.binding = Object.freeze({
      deps,
      depVersions,
      runTracked: <T>(read: () => T): T => this.#services.tracker.runTracked(this.#observer, read),
      clear: () => this.#services.tracker.clearDependencies(this.#observer),
      suspend: () => this.#services.tracker.suspendDependencies(this.#observer),
      isSuspended: () => this.#services.tracker.isSuspended(this.#observer),
      revalidate: () => this.#services.tracker.revalidate(this.#observer),
      hasStaleDependencies: () => this.#services.tracker.hasStaleDependencies(this.#observer),
      deferIdle: (task: () => void) => deferRuntimeCleanup(this.#runtime, task)
    })
  }
}

/**
 * Registers a fresh custom observer and binds only its required graph operations. Assign the
 * returned readonly edge views before invoking any operation or exposing the observer.
 * Resource/request ownership and scheduling decisions remain with the caller.
 */
export function createTrackedObserver(observer: IObserver): ITrackedObserverBinding {
  return new TrackedObserver(observer).binding
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

/** Stable results consumed by host adapters when admitting or refreshing captured dependencies. */
const ObserverBindingResult = {
  /** A capture's validated dependencies have entered this binding's observer graph. */
  committed: 'committed',
  /** Captured dependencies changed; the consumed token requires a fresh render capture. */
  stale: 'stale',
  /** No live observer exists, so captures remain available for a later subscription. */
  noObserver: 'no-observer',
  /** A forced observer run changes at least one dependency or its recorded version. */
  changed: 'changed',
  /** A forced observer run retains the same dependencies and recorded versions. */
  unchanged: 'unchanged'
} as const

/** Compares every retained version in O(n); execution may replace any dependency in the snapshot. */
function dependenciesChanged(
  before: ReadonlyMap<object, number>,
  after: ReadonlyMap<object, number>
): boolean {
  if (before.size !== after.size) return true
  for (const [dependency, version] of after) {
    if (before.get(dependency) !== version) return true
  }
  return false
}

/** Owns one render/commit binding's observer without exposing Effect or mutable dependency state. */
class ObserverBinding {
  /** Tracker identity is captured once when the public binding is constructed. */
  readonly #tracker: DependencyTracker
  /** Runtime identity stays fixed across successive observe/dispose lifecycles. */
  readonly #runtime: IRuntime
  /**
   * Current Effect is replaced only after construction succeeds and removed after disposal
   * succeeds.
   */
  #observer: Effect | undefined
  /** Mutable ordinary-object port retains the original four own methods and detached-call behavior. */
  readonly binding: IObserverBinding

  /** Captures graph authority once and publishes the same capture/observe/commit/retrack port. */
  constructor(runtime: IRuntime) {
    this.#tracker = internalsOf(runtime).tracker
    this.#runtime = runtime
    this.binding = {
      capture: (read) => this.#tracker.capture(read),
      observe: (fn, options) => this.#observe(fn, options),
      commit: (capture) => this.#commit(capture),
      retrack: () => this.#retrack()
    }
  }

  /** Removes only the successfully disposed observation; a reentrant replacement retains ownership. */
  release(current: Effect): void {
    if (this.#observer === current) this.#observer = undefined
  }

  /** Installs a successfully constructed Effect and returns its independently idempotent disposal. */
  #observe(fn: () => void | IDisposer, options?: IReactiveNodeOptions): IDisposer {
    if (this.#observer && !this.#observer.disposed) {
      throw createReactiveError(
        ReactiveErrorCode.bindingDuplicate,
        ReactiveErrorText.observerBindingAlreadyObserved
      )
    }
    /** Effect construction runs the callback synchronously before ownership changes. */
    const current = new Effect(fn, this.#runtime, options)
    this.#observer = current
    return new Observation(this, current).dispose
  }

  /** Admits a capture only into the current live observer and preserves the missing-observer token. */
  #commit(capture: ICapture<unknown>): IObserverCommitResult {
    /** Reentrant work must not redirect this operation to a later observation. */
    const current = this.#observer
    if (!current || current.disposed) return ObserverBindingResult.noObserver
    return this.#tracker.commitCapture(current, capture)
      ? ObserverBindingResult.committed
      : ObserverBindingResult.stale
  }

  /** Snapshots and compares O(n) dependency versions across one forced, potentially terminal run. */
  #retrack(): IObserverRetrackResult {
    /** The forced run may dispose or replace the binding's observer reentrantly. */
    const current = this.#observer
    if (!current || current.disposed) return ObserverBindingResult.noObserver
    /** A single snapshot is necessary because the run mutates the canonical version map in place. */
    const before = new Map(current.depVersions)
    current.run()
    if (current.disposed) return ObserverBindingResult.noObserver
    return dependenciesChanged(before, current.depVersions)
      ? ObserverBindingResult.changed
      : ObserverBindingResult.unchanged
  }
}

/** Owns the active bit and exact Effect retained by one returned host subscription disposer. */
class Observation {
  /** Binding clears its current observation only after this Effect disposes successfully. */
  readonly #binding: ObserverBinding
  /** Exact observation remains retained by its disposer even if the binding later observes again. */
  readonly #effect: Effect
  /** Consumed before cleanup to preserve idempotency during reentrant or throwing disposal. */
  #active = true
  /** Detached callback exposes no state or receiver requirement to the host adapter. */
  readonly dispose: IDisposer

  /** Associates one independently idempotent disposer with an already installed observation. */
  constructor(binding: ObserverBinding, effect: Effect) {
    this.#binding = binding
    this.#effect = effect
    this.dispose = () => this.#dispose()
  }

  /** Retires first, then disposes and releases in the original failure-sensitive order. */
  #dispose(): void {
    if (!this.#active) return
    this.#active = false
    this.#effect.dispose()
    this.#binding.release(this.#effect)
  }
}

/**
 * Creates a binding for one observer.
 *
 * Capture runs during render; the observer exists only during host subscription. The binding owns
 * its `Effect` and exposes `capture`, `observe`, `commit`, and `retrack`. Adapters cannot access
 * dependencies, versions, or forced scheduling ports.
 */
export function createObserverBinding(runtime: IRuntime): IObserverBinding {
  return new ObserverBinding(runtime).binding
}
