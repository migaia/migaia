/**
 * Public Resource boundary; modules own option admission, request execution and settlement, cache,
 * graph and cleanup.
 */
import type { IDisposable, IReactiveComputed, IRuntime } from '@migaia/reactive'
import {
  internalRuntimeOf,
  createTrackedObserver,
  type IObservable,
  type IObserver
} from '@migaia/reactive/extension'
import { LifecycleState } from '@migaia/lifecycle'
import { createResourceError } from './errors.ts'
import { ResourceErrorCode } from './error-code.ts'
import { ResourceErrorText } from './error-text.ts'
import { ResourceDiagnosticText } from './diagnostic-text.ts'
import { ResourceStatus, ResourceFetchStatus } from './state-constants.ts'
import { createResourceContext } from './resource-context.ts'
import { snapshotResourceOptions, snapshotInitialSnapshot } from './resource-options.ts'
import { abortError, createResourceOptionTypeError } from './resource-failure.ts'
import {
  calculateExpiresAt,
  readResourceSchedulerNow,
  resourceIsFresh,
  recordPassiveSchedulerFailure
} from './resource-cache.ts'
import {
  abortResourceRequest,
  observeResourcePromise,
  startResourceRequest
} from './resource-request.ts'
import {
  attachResourceObservationHooks,
  ensureResourceFresh,
  scheduleResourceDependencyRefresh
} from './resource-graph.ts'
import { ResourceSubscription, createResourceSelection } from './resource-subscription.ts'
import { disposeResourceContext } from './resource-cleanup.ts'
import type {
  IResourceState,
  IResourceFetcher,
  IResourceOptions,
  IResourceUpdater,
  IResourceCacheSnapshot
} from './resource-types.ts'

/** Internal setup-cleanup admission; assigned once without adding a public mutation method. */
export let registerResourceCleanup: <T>(resource: Resource<T>, cleanup: () => void) => void

/** Cancellable async derivation; public operations preserve the existing cache and request contract. */
export class Resource<T> implements IObserver, IDisposable {
  /** Explicit Resource state shared by the internal responsibility modules. */
  #context = createResourceContext<T>(this)
  /** Reactive nodes read synchronously by the last fetcher run. */
  readonly deps: ReadonlySet<IObservable>
  /** Dependency versions retained by the canonical reactive tracker. */
  readonly depVersions: ReadonlyMap<IObservable, number>
  /** Runtime that owns this Resource; disposing the Resource leaves it running. */
  readonly runtime: IRuntime
  /** Diagnostic label retained as an existing public own property. */
  debugName?: string

  static {
    registerResourceCleanup = (resource, cleanup) => {
      resource.#context.cleanups.push(cleanup)
    }
  }

  /**
   * Validates every option once, restores `initialSnapshot` when given, and starts the first
   * request unless `autoStart` is false or the snapshot is still fresh. Invalid options throw
   * `INVALID_OPTION`; an invalid snapshot throws `INVALID_SNAPSHOT`.
   */
  constructor(fetcher: IResourceFetcher<T>, runtime: IRuntime, options: IResourceOptions<T> = {}) {
    /** Single-read admission finishes before runtime graph and state ownership. */
    const admittedOptions = snapshotResourceOptions(options)
    this.runtime = runtime
    this.#context.runtime = runtime
    this.#context.tracking = createTrackedObserver(this)
    this.deps = this.#context.tracking.deps
    this.depVersions = this.#context.tracking.depVersions
    this.debugName = admittedOptions.debugName
    this.#context.fetcher = fetcher
    this.#context.ttl = admittedOptions.ttl
    this.#context.retry = admittedOptions.retry
    this.#context.retryDelay = admittedOptions.retryDelay
    this.#context.staleWhileRevalidate = admittedOptions.staleWhileRevalidate
    this.#context.keepAlive = admittedOptions.keepAlive
    this.#context.scheduler = admittedOptions.scheduler
    this.#context.stateSignal = internalRuntimeOf(runtime).signal<IResourceState<T>>(
      { status: ResourceStatus.idle },
      {
        debugName: admittedOptions.debugName
          ? ResourceDiagnosticText.state(admittedOptions.debugName)
          : undefined
      }
    )
    attachResourceObservationHooks(this.#context)
    if (admittedOptions.initialSnapshot !== undefined) this.hydrate(admittedOptions.initialSnapshot)
    if (
      admittedOptions.autoStart &&
      (admittedOptions.initialSnapshot === undefined || !resourceIsFresh(this.#context))
    ) {
      observeResourcePromise(startResourceRequest(this.#context))
    }
  }

  /** Reactive state-machine snapshot. Expired success values revalidate. */
  get state(): IResourceState<T> {
    this.#assertUsable()
    ensureResourceFresh(this.#context)
    return this.#context.stateSignal.value
  }

  /**
   * Shared promise for the current request or fresh cached value. Multiple readers receive the same
   * promise; it starts work only when idle/stale.
   */
  get promise(): Promise<T> {
    this.#assertUsable()
    ensureResourceFresh(this.#context)
    if (!this.#context.currentPromise) {
      throw createResourceError(
        ResourceErrorCode.noActivePromise,
        ResourceErrorText.noActivePromise
      )
    }
    return this.#context.currentPromise
  }

  /** Whether `dispose()` has run; readable after disposal. */
  get disposed(): boolean {
    return this.#context.terminal.lifecycle === LifecycleState.terminal
  }

  /** True while a fresh request runs without hiding an existing success value. */
  get refreshing(): boolean {
    if (this.#context.terminal.lifecycle !== LifecycleState.open) return false
    /** Nontracking visible state preserves current cache/error identity. */
    const state = this.#context.stateSignal.peek()
    return state.status === ResourceStatus.success && state.refreshing === true
  }

  /** Transport status, separate from the visible data/error state. */
  get fetchStatus(): ResourceFetchStatus {
    this.#assertUsable()
    return this.#context.requestPending ? ResourceFetchStatus.fetching : ResourceFetchStatus.idle
  }

  /** Whether the currently cached success value has crossed its TTL. */
  get isStale(): boolean {
    this.#assertUsable()
    /** Nontracking visible state preserves current cache/error identity. */
    const state = this.#context.stateSignal.peek()
    if (state.status !== ResourceStatus.success) return false
    try {
      return !resourceIsFresh(this.#context)
    } catch (error) {
      recordPassiveSchedulerFailure(this.#context, error)
      return false
    }
  }

  /** Whether reactive consumers currently observe this resource's state. */
  get observed(): boolean {
    return this.#context.stateSignal.subs.size > 0
  }

  /**
   * Suspense-compatible read: returns cached data, throws the active Promise while pending, and
   * throws the fetch error after failure.
   */
  read(): T {
    this.#assertUsable()
    ensureResourceFresh(this.#context)
    /** Tracked visible state supplies the Suspense materialization decision. */
    const state = this.#context.stateSignal.value
    return this.#materialize(state)
  }

  /**
   * Reads without tracking, with the same result semantics as `read()`. Success returns data,
   * pending throws a Promise, and failure throws the error. It creates no dependency edges and does
   * not check freshness or start a request. `React` snapshot reads and external diagnostics can
   * inspect current state without entering another consumer's tracking window.
   */
  peek(): T {
    this.#assertUsable()
    return this.#materialize(this.#context.stateSignal.peek())
  }

  /** Inspects the canonical state without tracking, starting work or revalidating TTL. */
  peekState(): IResourceState<T> {
    this.#assertUsable()
    return this.#context.stateSignal.peek()
  }

  /** Cancels this generation and drops its cache; the same Resource can start again from idle. */
  reset(): void {
    this.#assertUsable()
    this.#context.requests.supersede(abortError())
    this.#context.requestPending = false
    this.#context.paused = false
    this.#context.refreshScheduled = false
    this.#context.forceRefresh = false
    this.#context.settlementExpiry = undefined
    this.#context.currentPromise = undefined
    this.#context.expiresAt = 0
    this.#context.updatedAt = 0
    this.#context.tracking.clear()
    this.#context.stateSignal.value = { status: ResourceStatus.idle }
  }

  /**
   * Force a new request. Explicit refetches do not reuse a fresh cache entry; passive
   * `promise`/`read()` consumers do.
   */
  refetch(): Promise<T> {
    this.#assertUsable()
    return startResourceRequest(this.#context)
  }

  /** Mark cached data stale and immediately start a replacement request. */
  invalidate(): Promise<T> {
    this.#assertUsable()
    this.#context.expiresAt = 0
    return startResourceRequest(this.#context)
  }

  /** Cancel only the active generation; the Resource remains reusable. */
  cancel(): void {
    this.#assertUsable()
    abortResourceRequest(this.#context, true)
  }

  /** Captures duration metadata without serializing or copying the caller-owned data. */
  dehydrate(): IResourceCacheSnapshot<T> | undefined {
    this.#assertUsable()
    /** Nontracking visible state preserves current cache/error identity. */
    const state = this.#context.stateSignal.peek()
    if (state.status !== ResourceStatus.success) return undefined
    /** One clock sample makes cache age and remaining lifetime describe the same instant. */
    const now = readResourceSchedulerNow(this.#context)
    return snapshotInitialSnapshot<T>({
      version: 2,
      data: state.data,
      ageMs: now - this.#context.updatedAt,
      remainingTtlMs:
        this.#context.ttl === 0 || this.#context.expiresAt === Infinity
          ? null
          : Math.max(0, this.#context.expiresAt - now)
    })
  }

  /** Rebases captured durations into this scheduler; transport/storage elapsed time is caller-owned. */
  hydrate(snapshot: IResourceCacheSnapshot<T>): void {
    this.#assertUsable()
    /** Hydration shares constructor admission; unlike an omitted option, its value is required. */
    const admitted = snapshotInitialSnapshot<T>(snapshot)
    if (admitted === undefined) {
      throw createResourceError(
        ResourceErrorCode.invalidSnapshot,
        ResourceErrorText.invalidSnapshot
      )
    }
    /** Reject unrepresentable rebasing before superseding any live request. */
    const { data, ageMs, remainingTtlMs } = admitted
    /** Receiving clock origin has no relationship to the sending scheduler. */
    const now = readResourceSchedulerNow(this.#context)
    /** Internal timestamps remain local, while public snapshots contain durations only. */
    const updatedAt = now - ageMs
    /** Rebased deadline is validated before cancelling the current generation. */
    const expiresAt = remainingTtlMs === null ? Infinity : now + remainingTtlMs
    if (!Number.isFinite(updatedAt) || (remainingTtlMs !== null && !Number.isFinite(expiresAt))) {
      throw createResourceError(
        ResourceErrorCode.invalidSnapshot,
        ResourceErrorText.invalidSnapshot
      )
    }
    this.#context.requests.supersede(abortError())
    this.#context.requestPending = false
    this.#context.paused = false
    this.#context.tracking.clear()
    this.#context.updatedAt = updatedAt
    this.#context.expiresAt = expiresAt ?? Infinity
    this.#context.stateSignal.value = {
      status: ResourceStatus.success,
      data
    }
    this.#context.currentPromise = Promise.resolve(data)
  }

  /**
   * Replaces the visible data locally (optimistic update, server push, cache write). Supersedes any
   * in-flight request so its late result cannot overwrite this value, and starts a fresh TTL
   * window. An updater receives the current success data (or `undefined`). Function-typed data must
   * be passed through an updater. Returns `this` for chaining.
   *
   * @example
   *   ;```ts
   *   todos.mutate((list = []) => [...list, draft])
   *   ```
   */
  mutate(next: T | IResourceUpdater<T>): this {
    this.#assertUsable()
    /** Current visible state, read without tracking. */
    const current = this.#context.stateSignal.peek()
    /** Success data passed to an updater. */
    const previous = current.status === ResourceStatus.success ? current.data : undefined
    /** New data; an updater runs before any state changes, so its throw leaves state intact. */
    const data = typeof next === 'function' ? (next as IResourceUpdater<T>)(previous) : next
    /** One clock sample for both timestamps; overflow throws before state changes. */
    const now = readResourceSchedulerNow(this.#context)
    /** Finite TTL arithmetic is admitted before any cache mutation. */
    const expiresAt = calculateExpiresAt(now, this.#context.ttl)
    this.#context.requests.supersede(abortError())
    this.#context.requestPending = false
    this.#context.paused = false
    this.#context.refreshScheduled = false
    this.#context.forceRefresh = false
    this.#context.settlementExpiry = undefined
    this.#context.updatedAt = now
    this.#context.expiresAt = expiresAt
    this.#context.stateSignal.value = { status: ResourceStatus.success, data }
    this.#context.currentPromise = Promise.resolve(data)
    return this
  }

  /**
   * Calls `listener` with the current state now and after every state change, for consumers that do
   * not run inside the reactive graph. Subscribing counts as observation (it can start and keep
   * requests alive). Listener throws are reported through `runtime.reportError` and do not stop
   * delivery. Returns an idempotent unsubscribe; `dispose()` unsubscribes automatically.
   *
   * @example
   *   ;```ts
   *   const stop = user.subscribe((state) => render(state))
   *   ```
   */
  subscribe(listener: (state: IResourceState<T>) => void): () => void {
    this.#assertUsable()
    if (typeof listener !== 'function')
      throw createResourceOptionTypeError(ResourceErrorText.listenerInvalid)
    return new ResourceSubscription(this, this.#context, listener).subscribe()
  }

  /**
   * Derived reactive value from the success data; `undefined` while not in success. The computed is
   * disposed together with this resource.
   *
   * @example
   *   ;```ts
   *   const count = todos.select((list) => list.length)
   *   count.value // number | undefined
   *   ```
   */
  select<R>(selector: (data: T) => R): IReactiveComputed<R | undefined> {
    this.#assertUsable()
    if (typeof selector !== 'function')
      throw createResourceOptionTypeError(ResourceErrorText.selectorInvalid)
    return createResourceSelection(this, this.#context, selector)
  }

  /** Same as `dispose()`; enables `using resource = createResource(...)`. */
  [Symbol.dispose](): void {
    this.dispose()
  }

  /** A reactive dependency changed. Coalesce diamond/batched invalidations. */
  markDirty(): void {
    scheduleResourceDependencyRefresh(this.#context, false)
  }

  /** A dependency was disposed; force re-evaluation so failure is observable. */
  onDependencyDisconnected(): void {
    scheduleResourceDependencyRefresh(this.#context, true)
  }

  /**
   * Ends the resource: aborts the running request, clears dependencies and releases the state node.
   * Idempotent. Later reads and requests throw `RESOURCE_DISPOSED`; the first cleanup failure is
   * thrown with any later ones attached to its `errors`.
   */
  dispose(): void {
    disposeResourceContext(this.#context)
  }

  /** Rejects new public operations after closing starts, retaining the canonical error. */
  #assertUsable(): void {
    if (this.#context.terminal.lifecycle !== LifecycleState.open) {
      throw createResourceError(
        ResourceErrorCode.resourceDisposed,
        ResourceErrorText.resourceDisposed
      )
    }
  }

  /** Returns success or throws the exact current failure/Promise for Suspense consumers. */
  #materialize(state: IResourceState<T>): T {
    switch (state.status) {
      case ResourceStatus.success:
        return state.data
      case ResourceStatus.error:
        throw state.error
      case ResourceStatus.cancelled:
        throw state.error
      case ResourceStatus.pending:
      case ResourceStatus.idle:
        if (!this.#context.currentPromise) {
          throw createResourceError(
            ResourceErrorCode.noActivePromise,
            ResourceErrorText.noActivePromise
          )
        }
        throw this.#context.currentPromise
    }
  }
}
