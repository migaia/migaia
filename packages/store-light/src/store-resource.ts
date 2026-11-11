import type { IRuntime } from '@migaia/reactive'
import {
  getDefaultRuntime,
  internalRuntimeOf,
  deferRuntimeCleanup,
  ReactiveErrorPhase
} from '@migaia/reactive/extension'
import { resolveSchedulerOption } from '@migaia/lifecycle/scheduler'
import { systemScheduler, type IScheduler } from '@migaia/utils/scheduler'
import { assimilateCapturedThen, probeThenable, ThenableProbeKind } from '@migaia/utils/function'
import { ResourceCachePolicy } from './store-resource-cache-policy.ts'
import { ResourceOwnershipRegistry, type IVersionToken } from './store-resource-ownership.ts'
import type { IStoreResourceLoadContext } from './store-resource-request.ts'
import {
  createTerminalController,
  createSyncStartedDisposalLedger,
  LifecycleState
} from '@migaia/lifecycle'
import {
  Resource,
  ResourceStatus,
  ResourceFetchStatus,
  type IResourceFetchContext
} from '@migaia/resource'
import type { ISyncStartedDisposalLedger } from '@migaia/lifecycle'
import { StoreResourceKind, StoreResourceErrorPhase } from './resource-state-constants.ts'
import type { IResourceVersion, IResourceCoreState } from './store-resource-state.ts'
import { ResourceVersionRegistry } from './store-resource-versions.ts'
import { ResourceCaptureRegistry, type IResourceCapture } from './store-resource-captures.ts'
import { createStoreLightError, createStoreLightTypeError, StoreLightErrorCode } from './errors.ts'
import { StoreLightErrorText } from './error-text.ts'
import { createEventChannel } from '@migaia/event-subscriber'

export type { IStoreResourceLoadContext } from './store-resource-request.ts'
export type { IResourceCapture } from './store-resource-captures.ts'

/** A readable value with the version number and token that identify it for leases. */
export type IStoreResourceSnapshot<T> = {
  readonly value: T
  readonly version: number
  readonly token: IVersionToken
}

/** Readable async value with separate resource and rendered-version leases. */
export type IStoreResource<T> = {
  /** Returns the value; throws the pending Promise while loading and the error after a failure. */
  read(): T
  /** Starts loading if it has not started; takes no lease. */
  preload(): void
  /** Loads again, keeping the current value readable until the new one is published. */
  retry(): void
  /** Holds the resource until the returned function is called; returns the release function. */
  retainResource(): () => void
  /** Keeps one version from being released until the returned function is called. */
  retainVersion(version: number | IVersionToken): () => void
  /** Internal React bridge: protect version during render, then commit in layout. */
  captureVersion(version: number): IResourceCapture
  commitCapture(capture: IResourceCapture): () => void
  /** Releases the resource once no holder remains; with holders left it waits in `closing`. */
  dispose(): void
  /** Releases the resource now, ignoring holders. */
  forceDispose(): void
  /** Resolves once this resource reaches its terminal state. Never depends on GC. */
  whenTerminal(): Promise<void>
  /** Calls `listener` after every state change; returns the unsubscribe function. */
  subscribe(listener: () => void): () => void
  /** Revision number that increases on every state change, for `useSyncExternalStore`. */
  getSnapshot(): number
  /** Like `read()`, but also returns the version and its token. */
  readSnapshot(): IStoreResourceSnapshot<T>
  /** Reads a snapshot and captures its version for render; reuses `existingLease` when given. */
  captureSnapshot(existingLease?: object): {
    snapshot: IStoreResourceSnapshot<T>
    capture?: IResourceCapture
  }
}

/** Phase reported to `onError`: `load`, `dispose` or `listener`. */
export type IStoreResourceErrorPhase = StoreResourceErrorPhase
/** Options of `createStoreResource()`, read once at creation. */
export type IStoreResourceOptions<T> = {
  /** Owns deferred cleanup and diagnostic reporting; defaults to the lazy shared Runtime. */
  runtime?: IRuntime
  /** Owns cache TTL and provisional capture expiry, captured once at creation. */
  scheduler?: IScheduler
  /** Cache TTL only; React render safety comes from capture/commit leases. */
  keepAliveMs?: number
  /**
   * Releases one loaded value, called exactly once per value. When omitted, a value's own
   * `$dispose` method is used; when given, values must be objects or functions.
   */
  dispose?: (value: T) => void | PromiseLike<void>
  /** Observes load, dispose and listener failures; without it they go to the Runtime. */
  onError?: (error: unknown, phase: IStoreResourceErrorPhase) => void
  /** Called once when the resource reaches its end state. */
  onTerminal?: () => void
}
/** Loads one value; `context.signal` aborts when the load is superseded or the resource closes. */
export type IStoreResourceFactory<T> = (context: IStoreResourceLoadContext) => Promise<T> | T
/** Object-form Resource factory with the same options accepted by the function overload. */
export type IStoreResourceConfig<T> = IStoreResourceOptions<T> & {
  load: IStoreResourceFactory<T>
}
/** A group of resources released together by `dispose()`. */
export type IStoreResourceScope = {
  resource<T>(
    factory: IStoreResourceFactory<T> | IStoreResourceConfig<T>,
    options?: IStoreResourceOptions<T>
  ): IStoreResource<T>
  dispose(): void
}

/** Known option keys copied from hostile inputs without enumerating unrelated user properties. */
const RESOURCE_OPTION_KEYS = [
  'runtime',
  'scheduler',
  'keepAliveMs',
  'dispose',
  'onError',
  'onTerminal'
] as const

/** Reads each own enumerable Resource option at most once, preserving object-spread precedence. */
function snapshotResourceOptions<T>(source: object): IStoreResourceOptions<T> {
  const snapshot = {} as Record<string, unknown>
  for (const key of RESOURCE_OPTION_KEYS) {
    if (Object.getOwnPropertyDescriptor(source, key)?.enumerable)
      snapshot[key] = Reflect.get(source, key, source)
  }
  return snapshot as IStoreResourceOptions<T>
}

/**
 * Creates a scope whose `resource()` delegates to `createStoreResource()` and whose `dispose()`
 * force-releases every resource still in the group, without waiting for holders.
 */
export function createStoreResourceScope(): IStoreResourceScope {
  const resources = new Set<IStoreResource<unknown>>()
  return {
    resource(factory, options) {
      const resource = createStoreResource(factory, options)
      resources.add(resource)
      void resource.whenTerminal().then(() => {
        resources.delete(resource)
      })
      return resource
    },
    dispose() {
      for (const resource of resources) resource.forceDispose()
      resources.clear()
    }
  }
}

/**
 * Suspense-safe owned async value. Factories transfer ownership of each loaded value to this
 * resource, which releases it exactly once after the last holder leaves and `keepAliveMs` passes,
 * or when a reload publishes its replacement. Values with explicit disposers must have reference
 * identity. Invalid options throw `INVALID_OPTION`.
 */
export function createStoreResource<T>(
  factory: IStoreResourceFactory<T> | IStoreResourceConfig<T>,
  options?: IStoreResourceOptions<T>
): IStoreResource<T> {
  /** Loader and merged options, read once. */
  const { load, config } = readStoreResourceConfig(factory, options)
  return new StoreResource(load, config)
}

/** Reads the factory and options once: a function or `{ load }` config, plus explicit options. */
function readStoreResourceConfig<T>(
  factory: IStoreResourceFactory<T> | IStoreResourceConfig<T>,
  options: IStoreResourceOptions<T> | undefined
): { load: IStoreResourceFactory<T>; config: IStoreResourceOptions<T> } {
  /** Whether the factory is the loader itself. */
  const factoryIsFunction = typeof factory === 'function'
  try {
    if (!factoryIsFunction && (factory === null || typeof factory !== 'object')) {
      throw createStoreLightTypeError(
        StoreLightErrorCode.invalidOption,
        StoreLightErrorText.resourceFactory
      )
    }
  } catch (error) {
    if (error instanceof Error && 'code' in error) throw error
    throw createStoreLightTypeError(
      StoreLightErrorCode.invalidOption,
      StoreLightErrorText.resourceFactory,
      { cause: error }
    )
  }
  if (options !== undefined && (options === null || typeof options !== 'object')) {
    throw createStoreLightTypeError(
      StoreLightErrorCode.invalidOption,
      StoreLightErrorText.optionsObject
    )
  }
  /** Explicit options, snapshotted once. */
  let explicitOptions: IStoreResourceOptions<T> = {}
  if (options !== undefined) {
    try {
      explicitOptions = snapshotResourceOptions<T>(options)
    } catch (error) {
      throw createStoreLightTypeError(
        StoreLightErrorCode.invalidOption,
        StoreLightErrorText.optionsObject,
        { cause: error }
      )
    }
  }
  /** Loader. */
  let load: IStoreResourceFactory<T>
  /** Factory options overridden by explicit options. */
  let config: IStoreResourceOptions<T>
  try {
    /** Loader candidate read once from the factory. */
    const loadCandidate = factoryIsFunction
      ? factory
      : Reflect.get(factory as object, 'load', factory as object)
    if (typeof loadCandidate !== 'function') {
      throw createStoreLightTypeError(
        StoreLightErrorCode.invalidOption,
        StoreLightErrorText.resourceFactory
      )
    }
    load = loadCandidate as IStoreResourceFactory<T>
    /** Options carried on a config object. */
    const factoryOptions = factoryIsFunction ? {} : snapshotResourceOptions<T>(factory as object)
    config = { ...factoryOptions, ...explicitOptions }
  } catch (error) {
    if (error instanceof Error && 'code' in error) throw error
    throw createStoreLightTypeError(
      StoreLightErrorCode.invalidOption,
      StoreLightErrorText.optionsObject,
      { cause: error }
    )
  }
  if (
    (config.dispose !== undefined && typeof config.dispose !== 'function') ||
    (config.onError !== undefined && typeof config.onError !== 'function') ||
    (config.onTerminal !== undefined && typeof config.onTerminal !== 'function')
  ) {
    throw createStoreLightTypeError(
      StoreLightErrorCode.invalidOption,
      StoreLightErrorText.optionsInvalid
    )
  }
  return { load, config }
}

/** Throws RESOURCE_DISPOSED. */
function resourceDisposedError(): Error {
  return createStoreLightError(
    StoreLightErrorCode.resourceDisposed,
    StoreLightErrorText.resourceDisposed
  )
}

/** Throws UNKNOWN_VERSION. */
function unknownVersionError(): Error {
  return createStoreLightError(
    StoreLightErrorCode.unknownVersion,
    StoreLightErrorText.unknownResourceVersion
  )
}

/** One version lease; its release function is the lease token and runs once. */
class VersionLease {
  /** Live lease tokens and their versions, shared with the resource. */
  readonly #activeLeaseTokens: WeakMap<object, number>
  /** Releases the ownership retained for this lease. */
  #releaseOwnership: (() => void) | undefined
  /** True until released. */
  #active = true
  /** Binds the resource's lease-token table. */
  constructor(activeLeaseTokens: WeakMap<object, number>) {
    this.#activeLeaseTokens = activeLeaseTokens
  }
  /** Records the ownership release and registers this lease's token for `id`. */
  attach(releaseOwnership: () => void, id: number): () => void {
    this.#releaseOwnership = releaseOwnership
    this.#activeLeaseTokens.set(this.release, id)
    return this.release
  }
  /** Releases once and forgets the token. */
  readonly release = (): void => {
    if (!this.#active) return
    this.#active = false
    this.#activeLeaseTokens.delete(this.release)
    this.#releaseOwnership?.()
  }
}

/**
 * Readable async value with separate resource and rendered-version leases. The Resource core owns
 * pending/data/error/Promise and generation cancellation; this owner adds versions, leases, render
 * captures, eviction and value disposal. Only the public API members are visible.
 */
class StoreResource<T> implements IStoreResource<T> {
  /** Loader. */
  readonly #load: IStoreResourceFactory<T>
  /** Merged options. */
  readonly #config: IStoreResourceOptions<T>
  /** Owning runtime. */
  readonly #runtime: IRuntime
  /** Idle eviction timer policy. */
  readonly #cachePolicy: ResourceCachePolicy
  /** Value ownership may close while the canonical request finishes for its resource lease. */
  readonly #terminal = createTerminalController()
  /** Closing retains an owned version, not an independent fetch/data state. */
  #closingVersion: IResourceVersion<T> | undefined
  /** Identity of the canonical request used only to bind render captures. */
  #activeContext!: IResourceFetchContext
  /** Resource alone owns pending/data/error/Promise and generation cancellation. */
  readonly #core: Resource<T>
  /** Physical cleanup completion is tracked separately from logical terminal state. */
  #physicalTerminal = Promise.resolve()
  /** Resource and version leases. */
  readonly #ownership = new ResourceOwnershipRegistry<T>()
  /** Stale, retired, closing and superseded versions. */
  readonly #versions = new ResourceVersionRegistry<T>()
  /** Render captures bridging render to layout. */
  readonly #captures: ResourceCaptureRegistry
  /** Last produced version id. */
  #version = 0
  /** Token minted per version id. */
  readonly #versionTokens = new Map<number, IVersionToken>()
  /** Version id of each token. */
  readonly #tokenVersions = new WeakMap<object, number>()
  /** Revision for `useSyncExternalStore`. */
  #revision = 0
  /** Owns transient revision notifications while preserving the legacy Set dedupe contract. */
  readonly #listenerChannel: ReturnType<typeof createEventChannel<void>>
  /** Maps each legacy listener identity to its event-subscriber registration. */
  readonly #listenerRegistrations = new Map<() => void, () => void>()
  /** Live lease tokens and their version ids. */
  readonly #activeLeaseTokens = new WeakMap<object, number>()

  /** Validates the runtime, captures the scheduler, and creates the core and registries. */
  constructor(load: IStoreResourceFactory<T>, config: IStoreResourceOptions<T>) {
    this.#load = load
    this.#config = config
    /** Validate one real Runtime and capture the timer scheduler before creating resource state. */
    this.#runtime = config.runtime ?? getDefaultRuntime()
    internalRuntimeOf(this.#runtime)
    /** Timer scheduler shared by the core, eviction and captures. */
    const scheduler = resolveSchedulerOption(config, systemScheduler)
    this.#cachePolicy = new ResourceCachePolicy(config.keepAliveMs ?? 1000, scheduler)
    this.#core = new Resource<T>((context) => this.#runLoad(context), this.#runtime, {
      autoStart: false,
      keepAlive: true,
      ttl: Infinity,
      scheduler
    })
    this.#captures = new ResourceCaptureRegistry(() => this.#onCapturesChanged(), scheduler)
    this.#listenerChannel = createEventChannel<void>({
      report: ({ error }) => this.#report(error, StoreResourceErrorPhase.listener)
    })
  }

  /** Canonical load: run the loader, then classify the value against cancellation and disposal. */
  #runLoad(context: IResourceFetchContext): Promise<T> {
    this.#activeContext = context
    return Promise.resolve()
      .then(() => this.#load(context))
      .then((next) => this.#acceptLoaded(context, next))
  }

  /** A late value is released (or kept as superseded while loading); a disposed value is rejected. */
  #acceptLoaded(context: IResourceFetchContext, next: T): T {
    this.#assertDisposableValue(next)
    if (context.signal.aborted || this.#terminal.lifecycle === LifecycleState.terminal) {
      if (this.#currentState().kind === StoreResourceKind.loading)
        this.#versions.addSuperseded(next)
      else this.#cleanupUnique([next])
      return next
    }
    if (this.#ownership.isDisposed(next))
      throw createStoreLightError(
        StoreLightErrorCode.resourceDisposed,
        StoreLightErrorText.disposedResourceValue
      )
    this.#versions.addSuperseded(next)
    return next
  }

  /** Capture changes are reconciled after the current commit turn. */
  #onCapturesChanged(): void {
    deferRuntimeCleanup(this.#runtime, () => this.#reconcileCaptures())
  }

  /** Releases retired versions no capture needs anymore, then rechecks ownership. */
  #reconcileCaptures(): void {
    for (const id of this.#versions.retiredIds()) this.#releaseRetired(id)
    this.#onOwnersChanged()
  }

  /** Derives the facade vocabulary; stores no parallel request or data discriminant. */
  #currentState(): IResourceCoreState<T> {
    if (this.#terminal.lifecycle === LifecycleState.terminal)
      return { kind: StoreResourceKind.disposed }
    if (this.#terminal.lifecycle === LifecycleState.closing)
      return {
        kind: StoreResourceKind.closing,
        ...(this.#closingVersion ? { current: this.#closingVersion } : {})
      }
    /** Core state. */
    const state = this.#core.peekState()
    if (this.#core.fetchStatus === ResourceFetchStatus.fetching)
      return {
        kind: StoreResourceKind.loading,
        operation: this.#core.promise,
        ...(this.#versions.stale ? { previous: this.#versions.stale } : {})
      }
    if (state.status === ResourceStatus.success)
      return {
        kind: StoreResourceKind.ready,
        current: { id: this.#version, token: this.#versionToken(this.#version), value: state.data }
      }
    if (state.status === ResourceStatus.error || state.status === ResourceStatus.cancelled)
      return { kind: StoreResourceKind.failed, error: state.error }
    return { kind: StoreResourceKind.idle }
  }

  /** Whether the resource is disposed or closing. */
  #isEnding(): boolean {
    /** Current kind. */
    const kind = this.#currentState().kind
    return kind === StoreResourceKind.disposed || kind === StoreResourceKind.closing
  }

  /** Closes value ownership while allowing an already leased request to finish. */
  #closeOwnership(current?: IResourceVersion<T>): void {
    this.#closingVersion = current
    this.#terminal.close()
  }

  /** Terminal ownership hides data before any value disposer or observer can reenter. */
  #terminateOwnership(): void {
    this.#terminal.forceTerminal()
    this.#closingVersion = undefined
  }

  /** Token of a version id, minted on first use. */
  #versionToken(id: number): IVersionToken {
    /** Existing token. */
    let token = this.#versionTokens.get(id)
    if (!token) {
      token = {}
      this.#versionTokens.set(id, token)
      this.#tokenVersions.set(token, id)
    }
    return token
  }

  /** Preserve the primary when a diagnostic callback fails, without falling back to host globals. */
  readonly #report = (error: unknown, phase: IStoreResourceErrorPhase): void => {
    /** Runtime error phase of this resource phase. */
    const context: Parameters<IRuntime['reportError']>[1] = {
      phase:
        phase === StoreResourceErrorPhase.dispose
          ? ReactiveErrorPhase.lifecycleHook
          : phase === StoreResourceErrorPhase.listener
            ? ReactiveErrorPhase.subscriptionListener
            : ReactiveErrorPhase.asyncFlush
    }
    if (this.#config.onError === undefined) {
      this.#runtime.reportError(error, context)
      return
    }
    try {
      /** Reporter result; a thenable is observed for rejection. */
      const result: unknown = this.#config.onError(error, phase)
      const probe = probeThenable(result)
      if (probe.kind === ThenableProbeKind.failed)
        this.#reportReporterFailure(error, context, probe.error)
      else if (probe.kind === ThenableProbeKind.thenable)
        void assimilateCapturedThen(probe.thenFn, result).catch((reporterError: unknown) =>
          this.#reportReporterFailure(error, context, reporterError)
        )
    } catch (reporterError) {
      this.#reportReporterFailure(error, context, reporterError)
    }
  }

  /** The reporter failed: report the original, then the reporter's own failure. */
  #reportReporterFailure(
    error: unknown,
    context: Parameters<IRuntime['reportError']>[1],
    reporterError: unknown
  ): void {
    this.#runtime.reportError(error, context)
    this.#runtime.reportError(reporterError, { phase: ReactiveErrorPhase.asyncFlush })
  }

  /** Bumps the revision and notifies listeners; listener failures are reported one by one. */
  #notify(): void {
    this.#revision++
    try {
      this.#listenerChannel.publish(undefined)
    } catch (error) {
      if (error instanceof AggregateError) {
        for (const failure of error.errors) this.#report(failure, StoreResourceErrorPhase.listener)
      } else {
        this.#report(error, StoreResourceErrorPhase.listener)
      }
    }
  }

  // Pending observations are excluded by ResourceCaptureRegistry.hasAny(); only a resolved version
  // reservation can bridge render → layout. This keeps initial Suspense renders safe without
  // letting a never-settling operation keep a closing resource alive forever.
  /** Any committed owner or version reservation. */
  #hasOwners(): boolean {
    return this.#ownership.hasOwners || this.#captures.hasAny()
  }

  /** A value-disposing resource requires object identity for every value. */
  #assertDisposableValue(value: T): void {
    if (
      this.#config.dispose &&
      (value == null || (typeof value !== 'object' && typeof value !== 'function'))
    )
      throw createStoreLightTypeError(
        StoreLightErrorCode.identityRequired,
        StoreLightErrorText.disposableIdentity
      )
  }

  /** Disposer of one value: the configured `dispose`, or the value's own `$dispose`. */
  #resolveDisposer(value: T): (() => void | PromiseLike<void>) | undefined {
    if (this.#config.dispose) return () => this.#config.dispose?.(value)
    if (value == null || (typeof value !== 'object' && typeof value !== 'function'))
      return undefined
    try {
      /** Value carrying an optional `$dispose`. */
      const candidate = value as { $dispose?: () => void | PromiseLike<void> }
      /** Its `$dispose`, read once. */
      const dispose = candidate.$dispose
      return typeof dispose === 'function' ? () => Reflect.apply(dispose, candidate, []) : undefined
    } catch (error) {
      this.#report(error, StoreResourceErrorPhase.dispose)
      return undefined
    }
  }

  /** A value held by any visible or retired version cannot be released yet. */
  #heldElsewhere(value: T): boolean {
    /** Current state. */
    const current = this.#currentState()
    return (
      this.#versions.holds(value) ||
      ((current.kind === StoreResourceKind.ready || current.kind === StoreResourceKind.closing) &&
        current.current !== undefined &&
        Object.is(current.current.value, value))
    )
  }

  /** Disposes one value once; with a ledger the start is recorded for physical completion. */
  #cleanupOnce(value: T, ledger?: ISyncStartedDisposalLedger): void {
    if (this.#ownership.isDisposed(value)) return
    /** Disposer of this value. */
    const disposer = this.#resolveDisposer(value)
    if (!disposer) return
    this.#ownership.markDisposed(value)
    if (ledger) {
      ledger.start('store-resource', disposer)
      return
    }
    try {
      // Non-terminal eviction remains fire-and-forget, but every thenable rejection is observed.
      const result = disposer()
      const probe = probeThenable(result)
      if (probe.kind === ThenableProbeKind.failed)
        this.#report(probe.error, StoreResourceErrorPhase.dispose)
      else if (probe.kind === ThenableProbeKind.thenable)
        void assimilateCapturedThen(probe.thenFn, result).catch((error: unknown) =>
          this.#report(error, StoreResourceErrorPhase.dispose)
        )
    } catch (error) {
      this.#report(error, StoreResourceErrorPhase.dispose)
    }
  }

  /** Disposes each distinct value not still held elsewhere. */
  #cleanupUnique(values: T[], ledger?: ISyncStartedDisposalLedger): void {
    /** Values already handled, with Object.is identity (a Set alone would merge -0 and +0). */
    const seen = new SameValueSet<T>()
    for (const value of values) {
      if (seen.has(value) || this.#heldElsewhere(value)) continue
      seen.add(value)
      this.#cleanupOnce(value, ledger)
    }
  }

  /**
   * Releases one retired version unless a lease or capture still needs it. Peek, don't mint:
   * `versionToken(id)` creates one on a miss, which would silently revive an already-pruned entry
   * just to ask whether it has owners.
   */
  #releaseRetired(id: number): void {
    /** Existing token, if any. */
    const existingToken = this.#versionTokens.get(id)
    if (
      (existingToken && this.#ownership.versionOwnerCountToken(existingToken) !== 0) ||
      this.#captures.has(id)
    )
      return
    /** Retired or closing version to release. */
    const retired = this.#versions.takeRetired(id) ?? this.#versions.takeClosing(id)
    if (retired) this.#cleanupUnique([retired.value])
    this.#pruneVersionToken(id)
  }

  /**
   * Release the token minted for a version once nothing can reach it anymore. `version` (the
   * monotonic counter) only tracks the _last produced_ id, not the _currently visible_ one, so
   * check the actual current state, the version registry and any live ownership lease. `.get` only
   * peeks.
   */
  #pruneVersionToken(id: number): void {
    /** Current state. */
    const current = this.#currentState()
    /** Whether `id` is still the visible ready version. */
    const stillVisible = current.kind === StoreResourceKind.ready && current.current.id === id
    if (stillVisible || this.#versions.has(id)) return
    /** Token of `id`, if minted. */
    const token = this.#versionTokens.get(id)
    if (token && this.#ownership.versionOwnerCountToken(token) > 0) return
    this.#versionTokens.delete(id)
  }

  /** Retires one version and releases it if nothing needs it. */
  #retire(retiredVersion: number, value: T): void {
    this.#versions.retire({
      id: retiredVersion,
      token: this.#versionToken(retiredVersion),
      value
    })
    this.#releaseRetired(retiredVersion)
  }

  /** Schedules idle eviction. */
  #scheduleEviction(): void {
    this.#cachePolicy.scheduleEviction(() => this.#evict())
  }

  /**
   * Idle eviction. A first-load dispose can leave a value in `closing` after its provisional
   * resource owner releases before settlement; that value has no version lease, so TTL must
   * terminate the closing resource too.
   */
  #evict(): void {
    if (this.#hasOwners()) return
    if (this.#currentState().kind === StoreResourceKind.closing) {
      this.#forceDisposeResource()
      return
    }
    /** Stale version to release. */
    const stale = this.#versions.takeStale()
    if (stale) {
      this.#cleanupUnique([stale.value])
      this.#pruneVersionToken(stale.id)
    }
    /** State after releasing stale. */
    const current = this.#currentState()
    if (current.kind === StoreResourceKind.ready) {
      /** Evicted visible version. */
      const evicted = current.current
      this.#core.reset()
      this.#notify()
      this.#cleanupUnique([evicted.value])
      this.#pruneVersionToken(evicted.id)
    }
  }

  /** Terminates now: drops leases and captures, disposes every value and reports cleanup failures. */
  #forceDisposeResource(): void {
    /** Whether the resource was already terminal. */
    const wasDisposed = this.#currentState().kind === StoreResourceKind.disposed
    this.#cachePolicy.dispose()
    this.#ownership.forceReset()
    this.#captures.clear()
    /** State before the core is disposed. */
    const visible = this.#currentState()
    this.#core.dispose()
    /** Every value still owned. */
    const values = [
      ...this.#versions.clear(),
      ...(visible.kind === StoreResourceKind.ready ? [visible.current.value] : []),
      ...(visible.kind === StoreResourceKind.closing && visible.current
        ? [visible.current.value]
        : [])
    ]
    this.#terminateOwnership()
    if (!wasDisposed) this.#notify()
    this.#listenerChannel.clear()
    this.#listenerRegistrations.clear()
    /** Ledger recording physical cleanup starts. */
    const physicalLedger = createSyncStartedDisposalLedger()
    this.#cleanupUnique(values, physicalLedger)
    /** Sealed physical outcome. */
    const physicalOutcome = physicalLedger.seal()
    this.#physicalTerminal = physicalOutcome.physicalCompletion.then(({ cleanupErrors }) => {
      for (const item of cleanupErrors) this.#report(item.error, StoreResourceErrorPhase.dispose)
    })
    for (const item of physicalOutcome.cleanupErrors)
      this.#report(item.error, StoreResourceErrorPhase.dispose)
    this.#versionTokens.clear()
    try {
      this.#config.onTerminal?.()
    } catch (error) {
      this.#report(error, StoreResourceErrorPhase.dispose)
    }
  }

  /**
   * Closing has no legal failed state. Transition to terminal first so observers cannot see a
   * half-closed resource, then report the original load failure and release every value that was
   * waiting on settlement. Never call failed()/ready() here: both reject a closing controller. Keep
   * cleanup/report in finally-style guards so a notification or disposer failure cannot strand the
   * resource in an empty closing state.
   */
  #finalizeClosingFailure(error: unknown, superseded: T[], stale?: IResourceVersion<T>): void {
    try {
      this.#terminateOwnership()
      this.#notify()
    } catch (transitionError) {
      this.#report(transitionError, StoreResourceErrorPhase.load)
    }
    try {
      this.#cleanupUnique([...superseded, ...(stale ? [stale.value] : [])])
    } finally {
      this.#report(error, StoreResourceErrorPhase.load)
      this.#forceDisposeResource()
    }
  }

  /** Owner count changed: terminate an abandoned closing resource or schedule idle eviction. */
  #onOwnersChanged(): void {
    if (this.#ownership.hasOwners) return
    if (
      (this.#currentState().kind === StoreResourceKind.closing && !this.#captures.hasAny()) ||
      (this.#currentState().kind === StoreResourceKind.disposed && this.#versions.hasPending)
    ) {
      this.#forceDisposeResource()
      return
    }
    if (this.#currentState().kind === StoreResourceKind.ready) this.#scheduleEviction()
  }

  /** Starts the canonical load when idle; ended resources reject. */
  #start(): void {
    if (this.#isEnding()) throw resourceDisposedError()
    if (this.#currentState().kind !== StoreResourceKind.idle) return
    /** Canonical load operation. */
    const operation = this.#core.refetch()
    /** Its request context. */
    const context = this.#activeContext
    this.#captures.bind(context.generation, operation)
    void operation
      .then(
        (next) => this.#onLoaded(context, next),
        (error: unknown) => this.#onLoadFailed(context, error)
      )
      .catch((error: unknown) => this.#report(error, StoreResourceErrorPhase.load))
  }

  /** Publishes a loaded value as a new version (same identity keeps the stale version id). */
  #onLoaded(context: IResourceFetchContext, next: T): void {
    if (context.signal.aborted || this.#terminal.lifecycle === LifecycleState.terminal) return
    /** Previous visible version kept while loading. */
    const stale = this.#versions.takeStale()
    /** Whether the loaded value is the stale value itself. */
    const sameIdentity = stale !== undefined && Object.is(next, stale.value)
    if (!sameIdentity) this.#version++
    if (stale && !sameIdentity) this.#retire(stale.id, stale.value)
    try {
      this.#captures.resolve(context.generation, this.#version)
    } catch (error) {
      // Capture housekeeping cannot replace a successfully loaded canonical value.
      this.#report(error, StoreResourceErrorPhase.dispose)
    }
    if (this.#terminal.lifecycle === LifecycleState.closing)
      this.#closeOwnership({
        id: this.#version,
        token: this.#versionToken(this.#version),
        value: next
      })
    this.#notify()
    this.#cleanupUnique(this.#versions.takeSuperseded())
    if (!this.#hasOwners()) this.#scheduleEviction()
  }

  /** A failed load restores the stale value, or finishes closing, and reports the failure. */
  #onLoadFailed(context: IResourceFetchContext, error: unknown): void {
    this.#captures.discard(context.generation)
    if (context.signal.aborted || this.#terminal.lifecycle === LifecycleState.terminal) return
    /** Values produced by superseded loads. */
    const superseded = this.#versions.takeSuperseded()
    /** Previous visible version. */
    const stale = this.#versions.takeStale()
    if (this.#terminal.lifecycle === LifecycleState.closing) {
      this.#finalizeClosingFailure(error, superseded, stale)
      return
    }
    if (stale) this.#core.hydrate({ version: 2, data: stale.value, ageMs: 0, remainingTtlMs: null })
    this.#notify()
    this.#cleanupUnique(superseded)
    if (stale && !this.#hasOwners()) this.#scheduleEviction()
    this.#report(error, StoreResourceErrorPhase.load)
  }

  /** Snapshot of one value and version. */
  #snapshot(value: T, id: number): IStoreResourceSnapshot<T> {
    return { value, version: id, token: this.#versionToken(id) }
  }

  /** Throws the pending operation, or RESOURCE_DISPOSED when loading did not start. */
  #throwLoading(): never {
    /** State after starting. */
    const loading = this.#currentState()
    if (loading.kind === StoreResourceKind.loading) throw loading.operation
    throw resourceDisposedError()
  }

  /** Like `read()`, but also returns the version and its token. */
  readonly readSnapshot = (): IStoreResourceSnapshot<T> => {
    /** Current state. */
    const current = this.#currentState()
    if (current.kind === StoreResourceKind.ready)
      return this.#snapshot(current.current.value, current.current.id)
    if (current.kind === StoreResourceKind.closing) {
      if (current.current && this.#ownership.hasResourceOwners)
        return this.#snapshot(current.current.value, current.current.id)
      throw resourceDisposedError()
    }
    if (current.kind === StoreResourceKind.failed) throw current.error
    if (current.kind === StoreResourceKind.loading && current.previous)
      return this.#snapshot(current.previous.value, current.previous.id)
    this.#start()
    return this.#throwLoading()
  }

  /** Snapshot of a version plus a render capture, unless `existingLease` already holds it. */
  #capturedVersion(
    value: T,
    id: number,
    existingLease: object | undefined
  ): { snapshot: IStoreResourceSnapshot<T>; capture?: IResourceCapture } {
    /** Rendered snapshot. */
    const rendered = this.#snapshot(value, id)
    if (existingLease !== undefined && this.#activeLeaseTokens.get(existingLease) === id)
      return { snapshot: rendered, capture: undefined }
    return { snapshot: rendered, capture: this.#captures.capture(id) as IResourceCapture }
  }

  /** Reads a snapshot and captures its version for render; reuses `existingLease` when given. */
  readonly captureSnapshot = (
    existingLease?: object
  ): { snapshot: IStoreResourceSnapshot<T>; capture?: IResourceCapture } => {
    /** Current state. */
    const current = this.#currentState()
    if (current.kind === StoreResourceKind.ready)
      return this.#capturedVersion(current.current.value, current.current.id, existingLease)
    if (current.kind === StoreResourceKind.closing && current.current) {
      if (
        existingLease === undefined ||
        this.#activeLeaseTokens.get(existingLease) !== current.current.id
      )
        throw resourceDisposedError()
      return {
        snapshot: this.#snapshot(current.current.value, current.current.id),
        capture: undefined
      }
    }
    if (current.kind === StoreResourceKind.failed) throw current.error
    if (current.kind === StoreResourceKind.loading) {
      if (current.previous)
        return this.#capturedVersion(current.previous.value, current.previous.id, existingLease)
      this.#captures.capturePending(this.#activeContext.generation, current.operation)
      throw current.operation
    }
    this.#captures.capture()
    this.#start()
    return this.#throwLoading()
  }

  /** Returns the value; throws the pending Promise while loading and the error after a failure. */
  readonly read = (): T => this.readSnapshot().value

  /** Starts loading if it has not started; takes no lease. */
  readonly preload = (): void => {
    if (this.#currentState().kind === StoreResourceKind.closing) throw resourceDisposedError()
    this.#start()
  }

  /** Loads again, keeping the current value readable until the new one is published. */
  readonly retry = (): void => {
    /** State before retrying. */
    const previous = this.#currentState()
    if (previous.kind === StoreResourceKind.disposed || previous.kind === StoreResourceKind.closing)
      throw resourceDisposedError()
    this.#cachePolicy.cancelEviction()
    if (previous.kind === StoreResourceKind.ready) this.#versions.setStale(previous.current)
    this.#core.reset()
    this.#notify()
    this.#start()
  }

  /** Holds the resource until the returned function is called. */
  readonly retainResource = (): (() => void) => {
    if (this.#isEnding()) throw resourceDisposedError()
    this.#cachePolicy.cancelEviction()
    this.#start()
    return this.#ownership.retainResource(() => this.#onOwnersChanged())
  }

  /** A released version lease releases its retired version and rechecks ownership. */
  #releaseVersionLease(id: number): void {
    this.#releaseRetired(id)
    this.#onOwnersChanged()
  }

  /** Creates one version lease whose token is its release function. */
  #createVersionLease(id: number): () => void {
    /** The new lease. */
    const lease = new VersionLease(this.#activeLeaseTokens)
    return lease.attach(
      this.#ownership.retainVersionToken(this.#versionToken(id), () =>
        this.#releaseVersionLease(id)
      ),
      id
    )
  }

  /** The generation counter survives eviction; only a visible or owned value can accept a lease. */
  #hasVisibleVersion(id: number): boolean {
    /** Current state. */
    const state = this.#currentState()
    return (
      ((state.kind === StoreResourceKind.ready || state.kind === StoreResourceKind.closing) &&
        state.current?.id === id) ||
      ((state.kind === StoreResourceKind.loading || state.kind === StoreResourceKind.failed) &&
        state.previous?.id === id)
    )
  }

  /** Whether `id` is visible, retired or stale. */
  #isKnownVersion(id: number): boolean {
    return (
      this.#hasVisibleVersion(id) ||
      this.#versions.hasRetired(id) ||
      this.#versions.stale?.id === id
    )
  }

  /** Keeps one version from being released until the returned function is called. */
  readonly retainVersion = (versionInput: number | IVersionToken): (() => void) => {
    /** Version id of the input. */
    const id =
      typeof versionInput === 'number' ? versionInput : this.#tokenVersions.get(versionInput)
    if (id === undefined) throw unknownVersionError()
    if (this.#isEnding()) throw resourceDisposedError()
    if (!this.#isKnownVersion(id)) throw unknownVersionError()
    this.#cachePolicy.cancelEviction()
    this.#start()
    return this.#createVersionLease(id)
  }

  /** Internal React bridge: protect a version during render. */
  readonly captureVersion = (id: number): IResourceCapture => {
    if (this.#isEnding()) throw resourceDisposedError()
    if (!this.#isKnownVersion(id)) throw unknownVersionError()
    return this.#captures.capture(id) as IResourceCapture
  }

  /** Internal React bridge: commit a render capture in layout as a version lease. */
  readonly commitCapture = (capture: IResourceCapture): (() => void) => {
    /** Captured version id. */
    const id = this.#captures.inspect(capture)
    if (this.#currentState().kind === StoreResourceKind.disposed) throw resourceDisposedError()
    if (!this.#isKnownVersion(id) && !this.#versions.hasClosing(id)) throw unknownVersionError()
    this.#captures.commit(capture)
    this.#cachePolicy.cancelEviction()
    return this.#createVersionLease(id)
  }

  /** Releases the resource once no holder remains; with holders left it waits in `closing`. */
  readonly dispose = (): void => {
    /** State before disposal. */
    const previous = this.#currentState()
    if (previous.kind === StoreResourceKind.disposed || previous.kind === StoreResourceKind.closing)
      return
    this.#cachePolicy.cancelEviction()
    /** Whether a pending load continues for its resource owners. */
    const keepPendingLoad =
      previous.kind === StoreResourceKind.loading && this.#ownership.hasResourceOwners
    if (!keepPendingLoad) this.#core.cancel()
    /** Versions moved to closing. */
    const moved = this.#versions.moveToClosing()
    if (previous.kind === StoreResourceKind.ready) moved.versions.push(previous.current)
    this.#versions.beginClosing(moved.versions)
    this.#cleanupUnique(moved.superseded)
    if (
      previous.kind === StoreResourceKind.ready &&
      (this.#ownership.hasOwners || this.#captures.hasAny())
    ) {
      this.#closeOwnership(previous.current)
      return
    }
    if (
      previous.kind === StoreResourceKind.loading &&
      previous.previous &&
      this.#ownership.hasOwners
    ) {
      this.#closeOwnership(previous.previous)
      return
    }
    if (previous.kind === StoreResourceKind.loading && keepPendingLoad) {
      this.#closeOwnership()
      return
    }
    this.#terminateOwnership()
    this.#notify()
    if (!this.#hasOwners() && !this.#ownership.hasVersionOwners) this.#forceDisposeResource()
  }

  /** Releases the resource now, ignoring holders. */
  readonly forceDispose = (): void => {
    if (
      this.#currentState().kind === StoreResourceKind.disposed &&
      !this.#hasOwners() &&
      !this.#versions.hasPending
    )
      return
    this.#forceDisposeResource()
  }

  /** Resolves once this resource reaches its terminal state and physical cleanup finished. */
  readonly whenTerminal = (): Promise<void> => this.#whenTerminal()

  /** Logical terminal, then physical cleanup completion. */
  #whenTerminal(): Promise<void> {
    return this.#terminal.whenTerminal().then(() => this.#physicalTerminal)
  }

  /** Revision number that increases on every state change. */
  readonly getSnapshot = (): number => this.#revision

  /** Calls `listener` after every state change; a repeated listener shares one registration. */
  readonly subscribe = (listener: () => void): (() => void) => {
    if (this.#currentState().kind === StoreResourceKind.disposed) return () => {}
    /** Existing registration of this listener. */
    const existing = this.#listenerRegistrations.get(listener)
    if (existing) return () => this.#unsubscribe(listener, existing)
    /** New registration. */
    const registration = this.#listenerChannel.subscribe(() => listener())
    this.#listenerRegistrations.set(listener, registration)
    return () => this.#unsubscribe(listener, registration)
  }

  /** Removes one listener registration if it is still the current one. */
  #unsubscribe(listener: () => void, registration: () => void): void {
    if (this.#listenerRegistrations.get(listener) !== registration) return
    this.#listenerRegistrations.delete(listener)
    registration()
  }
}

/** Set with `Object.is` membership: like `Set` (SameValueZero) but keeps -0 apart from +0. */
class SameValueSet<T> {
  /** Members other than -0. */
  readonly #values = new Set<T>()
  /** Whether -0 is a member. */
  #negativeZero = false
  /** Membership by `Object.is`. */
  has(value: T): boolean {
    return Object.is(value, -0) ? this.#negativeZero : this.#values.has(value)
  }
  /** Adds one member. */
  add(value: T): void {
    if (Object.is(value, -0)) this.#negativeZero = true
    else this.#values.add(value)
  }
}
