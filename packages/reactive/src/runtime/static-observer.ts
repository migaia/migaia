import type {
  IDisposable,
  IObservable,
  IObserver,
  IReactiveNodeOptions,
  IRuntime
} from './types.ts'
import { internalsOf, type IRuntimeInternals } from './internals.ts'
import { claimOwnership } from './ownership.ts'
import { registerDeps, registerDepVersions } from './node-internals.ts'
import { createObserverRunTrace, describeObserver } from './diagnostics.ts'
import { ReactiveErrorPhase } from './trace-constants.ts'
import { runReactiveCallbackWith } from '../errors.ts'

/**
 * An owner's stable source object reads exactly its one graph node. Resolver work may materialize
 * it.
 */
export type IStaticSubscriptionSource = {
  readonly node: IObservable
  read(): unknown
}

/** A known-source subscription keeps graph/lifecycle ownership inside the kernel. */
class StaticObserver implements IObserver, IDisposable {
  /** Registered dependency storage also admits one-time dependencies read by lazy source creation. */
  #deps = new Set<IObservable>()
  /** Successful reads update the same canonical versions exposed through the readonly view. */
  #depVersions = new Map<IObservable, number>()
  readonly deps: ReadonlySet<IObservable>
  readonly depVersions: ReadonlyMap<IObservable, number>
  readonly runtime: IRuntime
  debugName?: string
  /** Runtime services remain private and immutable for the lifetime of this observer. */
  readonly #internals: IRuntimeInternals
  /** Resolves a replacement only during initial admission, dynamic fallback, or invalidation. */
  readonly #resolve: () => IStaticSubscriptionSource
  /** Caller retains its established subscription error policy inside this notification callback. */
  readonly #callback: () => void
  /** Existing source object is retained only until replacement or disposal. */
  #source?: IStaticSubscriptionSource
  /** Initial source admission never sends a change notification. */
  #initialized = false
  /**
   * A disconnected route must notify after resolving its replacement even when values compare
   * equal.
   */
  #forceRun = false
  /** Terminal state prevents callback reentrancy from reconnecting a disposed observer. */
  #disposed = false

  /** Initial admission uses tracking so lazy creation retains its existing incidental dependencies. */
  constructor(
    runtime: IRuntime,
    resolve: () => IStaticSubscriptionSource,
    callback: () => void,
    options: IReactiveNodeOptions
  ) {
    this.runtime = runtime
    this.#internals = internalsOf(runtime)
    this.#resolve = resolve
    this.#callback = callback
    this.debugName = options.debugName
    this.deps = registerDeps(this, this.#deps)
    this.depVersions = registerDepVersions(this, this.#depVersions)
    claimOwnership(this, runtime)
    this.#run(true)
  }

  get disposed(): boolean {
    return this.#disposed
  }

  /** Notification marking never executes user reads before scheduler fan-out completes. */
  markDirty(): void {
    this.#internals.scheduler.enqueue(this)
  }

  /** Route disconnection uses the existing scheduler force-run behavior. */
  onDependencyDisconnected(): void {
    this.#forceRun = true
    this.#internals.scheduler.enqueue(this)
  }

  /** Pure known-source ticks compare one version; incidental creation dependencies use the old path. */
  tick(): void {
    if (this.#disposed) return
    if (this.#forceRun) {
      this.#forceRun = false
      this.#run(true)
      return
    }
    /** Successful admission always supplies this stable source until the next forced resolution. */
    const source = this.#source!
    if (this.#deps.size === 1 && this.#depVersions.size === 1 && this.#deps.has(source.node)) {
      source.node.pull?.()
      if (source.node.version !== this.#depVersions.get(source.node)) this.#run(false)
    } else if (this.#internals.tracker.hasStaleDependencies(this)) this.#run(true)
  }

  /** Dynamic admission preserves lazy factories and the same observed-hook tracking frame. */
  #readTracked(): void {
    this.#source = this.#resolve()
    void this.#source.read()
    if (this.#initialized) this.#callback()
    else this.#initialized = true
  }

  /** Shared callback avoids allocating a frame, Set, or closure during a stable single-source tick. */
  static #readStatic(observer: StaticObserver): void {
    /**
     * Read before notifying, then record the post-callback version exactly as a tracked commit
     * does.
     */
    const source = observer.#source!
    void source.read()
    observer.#callback()
    if (observer.#disposed) return
    if (
      observer.#deps.size === 1 &&
      observer.#depVersions.size === 1 &&
      observer.#deps.has(source.node)
    ) {
      observer.#depVersions.set(source.node, source.node.version)
    } else observer.#internals.tracker.commitKnownDependency(observer, source.node)
  }

  /** Static reads share the established callback error policy without a per-tick closure. */
  static #admitStatic(observer: StaticObserver): void {
    runReactiveCallbackWith(StaticObserver.#readStatic, observer)
  }

  /** Trace spans and failure propagation remain identical to a store subscription's Effect run. */
  #run(tracked: boolean): void {
    if (this.#disposed) return
    /** Trace allocation remains optional, as for the existing Effect implementation. */
    const runtime = this.#internals
    const trace = runtime.traceEnabled()
      ? createObserverRunTrace(describeObserver(this), {
          now: runtime.now,
          timestamp: runtime.timestamp,
          emitTrace: runtime.emitTrace,
          reportError: (error) =>
            this.runtime.reportError(error, {
              phase: ReactiveErrorPhase.traceListener,
              observer: this
            })
        })
      : undefined
    trace?.start()
    try {
      if (this.#disposed) return
      if (tracked) runtime.tracker.runTracked(this, () => this.#readTracked())
      else runtime.tracker.untrackedWith(StaticObserver.#admitStatic, this)
    } catch (error) {
      trace?.error(error)
      throw error
    } finally {
      trace?.end()
    }
  }

  /** Disposal is idempotent and releases both graph edges and the retained resolved source object. */
  dispose(): void {
    if (this.#disposed) return
    this.#disposed = true
    this.#internals.tracker.clearDependencies(this)
    this.#internals.scheduler.dequeue(this)
    this.#source = undefined
  }
}

/**
 * Observes an owner's known single-node read without retracking each stable notification. Source
 * resolution and first admission retain normal tracking for lazy factory reads; an invalidation
 * resolves again. Notifications remain scheduled, ordered and untracked under the caller's existing
 * callback policy. The returned handle exposes disposal only, never mutable graph internals.
 */
export function createStaticObserver(
  runtime: IRuntime,
  resolve: () => IStaticSubscriptionSource,
  callback: () => void,
  options: IReactiveNodeOptions = {}
): IDisposable {
  return new StaticObserver(runtime, resolve, callback, options)
}
