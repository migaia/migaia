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
import { ResourceCachePolicy } from './store-resource-cache-policy.js'
import { ResourceOwnershipRegistry, type IVersionToken } from './store-resource-ownership.js'
import type { IStoreResourceLoadContext } from './store-resource-request.js'
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
import { StoreResourceKind, StoreResourceErrorPhase } from './resource-state-constants.js'
import type { IResourceVersion, IResourceCoreState } from './store-resource-state.js'
import { ResourceVersionRegistry } from './store-resource-versions.js'
import { ResourceCaptureRegistry, type IResourceCapture } from './store-resource-captures.js'
import { createStoreLightError, createStoreLightTypeError, StoreLightErrorCode } from './errors.js'
import { StoreLightErrorText } from './error-text.js'
import { createEventChannel } from '@migaia/event-subscriber'

export type { IStoreResourceLoadContext } from './store-resource-request.js'
export type { IResourceCapture } from './store-resource-captures.js'

export type IStoreResourceSnapshot<T> = {
  readonly value: T
  readonly version: number
  readonly token: IVersionToken
}

/** Readable async value with separate resource and rendered-version leases. */
export type IStoreResource<T> = {
  read(): T
  preload(): void
  retry(): void
  /** @deprecated Use retainResource() or retainVersion(). */
  retain(version?: number | IVersionToken): () => void
  retainResource(): () => void
  retainVersion(version: number | IVersionToken): () => void
  /** Internal React bridge: protect version during render, then commit in layout. */
  captureVersion(version: number): IResourceCapture
  commitCapture(capture: IResourceCapture): () => void
  dispose(): void
  forceDispose(): void
  /** Resolves once this resource reaches its terminal state. Never depends on GC. */
  whenTerminal(): Promise<void>
  subscribe(listener: () => void): () => void
  getSnapshot(): number
  readSnapshot(): IStoreResourceSnapshot<T>
  captureSnapshot(existingLease?: object): {
    snapshot: IStoreResourceSnapshot<T>
    capture?: IResourceCapture
  }
}

export type IStoreResourceErrorPhase = StoreResourceErrorPhase
export type IStoreResourceOptions<T> = {
  /** Owns deferred cleanup and diagnostic reporting; defaults to the lazy shared Runtime. */
  runtime?: IRuntime
  /** Owns cache TTL and provisional capture expiry, captured once at creation. */
  scheduler?: IScheduler
  /** Cache TTL only; React render safety comes from capture/commit leases. */
  keepAliveMs?: number
  dispose?: (value: T) => void | PromiseLike<void>
  onError?: (error: unknown, phase: IStoreResourceErrorPhase) => void
  onTerminal?: () => void
}
export type IStoreResourceFactory<T> = (context: IStoreResourceLoadContext) => Promise<T> | T
/** Object-form Resource factory with the same options accepted by the function overload. */
export type IStoreResourceConfig<T> = IStoreResourceOptions<T> & {
  load: IStoreResourceFactory<T>
}
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
 * Suspense-safe owned async value. Factories transfer ownership to this resource; values with
 * explicit disposers must have reference identity.
 */
export function createStoreResource<T>(
  factory: IStoreResourceFactory<T> | IStoreResourceConfig<T>,
  options?: IStoreResourceOptions<T>
): IStoreResource<T> {
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
  let load: IStoreResourceFactory<T>
  let config: IStoreResourceOptions<T>
  try {
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
  /** Validate one real Runtime and capture the timer scheduler before creating resource state. */
  const runtime = config.runtime ?? getDefaultRuntime()
  internalRuntimeOf(runtime)
  const scheduler = resolveSchedulerOption(config, systemScheduler)
  const cachePolicy = new ResourceCachePolicy(config.keepAliveMs ?? 1000, scheduler)
  /** Value ownership may close while the canonical request finishes for its resource lease. */
  const terminal = createTerminalController()
  /** Closing retains an owned version, not an independent fetch/data state. */
  let closingVersion: IResourceVersion<T> | undefined
  /** Identity of the canonical request used only to bind render captures. */
  let activeContext!: IResourceFetchContext
  /** Resource alone owns pending/data/error/Promise and generation cancellation. */
  const core = new Resource<T>(
    (context) => {
      activeContext = context
      return Promise.resolve()
        .then(() => load(context))
        .then((next) => {
          assertDisposableValue(next)
          if (context.signal.aborted || terminal.lifecycle === LifecycleState.terminal) {
            if (currentState().kind === StoreResourceKind.loading) versions.addSuperseded(next)
            else cleanupUnique([next])
            return next
          }
          if (ownership.isDisposed(next))
            throw createStoreLightError(
              StoreLightErrorCode.resourceDisposed,
              StoreLightErrorText.disposedResourceValue
            )
          versions.addSuperseded(next)
          return next
        })
    },
    runtime,
    { autoStart: false, keepAlive: true, ttl: Infinity, scheduler }
  )
  /** Derives the facade vocabulary; stores no parallel request or data discriminant. */
  const currentState = (): IResourceCoreState<T> => {
    if (terminal.lifecycle === LifecycleState.terminal) return { kind: StoreResourceKind.disposed }
    if (terminal.lifecycle === LifecycleState.closing)
      return {
        kind: StoreResourceKind.closing,
        ...(closingVersion ? { current: closingVersion } : {})
      }
    const state = core.peekState()
    if (core.fetchStatus === ResourceFetchStatus.fetching)
      return {
        kind: StoreResourceKind.loading,
        operation: core.promise,
        ...(versions.stale ? { previous: versions.stale } : {})
      }
    if (state.status === ResourceStatus.success)
      return {
        kind: StoreResourceKind.ready,
        current: { id: version, token: versionToken(version), value: state.data }
      }
    if (state.status === ResourceStatus.error || state.status === ResourceStatus.cancelled)
      return { kind: StoreResourceKind.failed, error: state.error }
    return { kind: StoreResourceKind.idle }
  }
  /** Closes value ownership while allowing an already leased request to finish. */
  const closeOwnership = (current?: IResourceVersion<T>): void => {
    closingVersion = current
    terminal.close()
  }
  /** Terminal ownership hides data before any value disposer or observer can reenter. */
  const terminateOwnership = (): void => {
    terminal.forceTerminal()
    closingVersion = undefined
  }
  /** Physical cleanup completion is tracked separately from logical terminal state. */
  let physicalTerminal = Promise.resolve()
  const ownership = new ResourceOwnershipRegistry<T>()
  const versions = new ResourceVersionRegistry<T>()
  const captures = new ResourceCaptureRegistry(() => {
    deferRuntimeCleanup(runtime, () => {
      for (const id of versions.retiredIds()) releaseRetired(id)
      onOwnersChanged()
    })
  }, scheduler)
  let version = 0
  const versionTokens = new Map<number, IVersionToken>()
  const tokenVersions = new WeakMap<object, number>()
  const versionToken = (id: number): IVersionToken => {
    let token = versionTokens.get(id)
    if (!token) {
      token = {}
      versionTokens.set(id, token)
      tokenVersions.set(token, id)
    }
    return token
  }
  let revision = 0
  /** Owns transient revision notifications while preserving the legacy Set dedupe contract. */
  const listenerChannel = createEventChannel<void>({
    report: ({ error }) => report(error, StoreResourceErrorPhase.listener)
  })
  /** Maps each legacy listener identity to its event-subscriber registration. */
  const listenerRegistrations = new Map<() => void, () => void>()
  const activeLeaseTokens = new WeakMap<object, number>()
  /** Preserve the primary when a diagnostic callback fails, without falling back to host globals. */
  const report = (error: unknown, phase: IStoreResourceErrorPhase) => {
    const context: Parameters<IRuntime['reportError']>[1] = {
      phase:
        phase === StoreResourceErrorPhase.dispose
          ? ReactiveErrorPhase.lifecycleHook
          : phase === StoreResourceErrorPhase.listener
            ? ReactiveErrorPhase.subscriptionListener
            : ReactiveErrorPhase.asyncFlush
    }
    const reportFailure = (reporterError: unknown): void => {
      runtime.reportError(error, context)
      runtime.reportError(reporterError, { phase: ReactiveErrorPhase.asyncFlush })
    }
    if (config.onError === undefined) {
      runtime.reportError(error, context)
      return
    }
    try {
      const result: unknown = config.onError(error, phase)
      const probe = probeThenable(result)
      if (probe.kind === ThenableProbeKind.failed) reportFailure(probe.error)
      else if (probe.kind === ThenableProbeKind.thenable)
        void assimilateCapturedThen(probe.thenFn, result).catch(reportFailure)
    } catch (reporterError) {
      reportFailure(reporterError)
    }
  }
  const notify = () => {
    revision++
    try {
      listenerChannel.publish(undefined)
    } catch (error) {
      if (error instanceof AggregateError) {
        for (const failure of error.errors) report(failure, StoreResourceErrorPhase.listener)
      } else {
        report(error, StoreResourceErrorPhase.listener)
      }
    }
  }
  // Pending observations are excluded by ResourceCaptureRegistry.hasAny();
  // only a resolved version reservation can bridge render → layout. This keeps
  // initial Suspense renders safe without letting a never-settling operation
  // keep a closing resource alive forever.
  const hasOwners = () => ownership.hasOwners || captures.hasAny()
  const hasCommittedOwners = () => ownership.hasOwners
  const hasVersionReservations = () => captures.hasAny()
  const assertDisposableValue = (value: T) => {
    if (
      config.dispose &&
      (value == null || (typeof value !== 'object' && typeof value !== 'function'))
    )
      throw createStoreLightTypeError(
        StoreLightErrorCode.identityRequired,
        StoreLightErrorText.disposableIdentity
      )
  }
  const resolveDisposer = (value: T): (() => void | PromiseLike<void>) | undefined => {
    if (config.dispose) return () => config.dispose?.(value)
    if (value == null || (typeof value !== 'object' && typeof value !== 'function'))
      return undefined
    try {
      const candidate = value as { $dispose?: () => void | PromiseLike<void> }
      const dispose = candidate.$dispose
      return typeof dispose === 'function' ? () => Reflect.apply(dispose, candidate, []) : undefined
    } catch (error) {
      report(error, StoreResourceErrorPhase.dispose)
      return undefined
    }
  }
  /** A value held by any visible or retired version cannot be released yet. */
  const heldElsewhere = (value: T): boolean => {
    const current = currentState()
    return (
      versions.holds(value) ||
      ((current.kind === StoreResourceKind.ready || current.kind === StoreResourceKind.closing) &&
        current.current !== undefined &&
        Object.is(current.current.value, value))
    )
  }
  const cleanupOnce = (value: T, ledger?: ISyncStartedDisposalLedger) => {
    if (ownership.isDisposed(value)) return
    const disposer = resolveDisposer(value)
    if (!disposer) return
    ownership.markDisposed(value)
    if (ledger) {
      ledger.start('store-resource', disposer)
      return
    }
    try {
      // Non-terminal eviction remains fire-and-forget, but every thenable rejection is observed.
      const result = disposer()
      const probe = probeThenable(result)
      if (probe.kind === ThenableProbeKind.failed)
        report(probe.error, StoreResourceErrorPhase.dispose)
      else if (probe.kind === ThenableProbeKind.thenable)
        void assimilateCapturedThen(probe.thenFn, result).catch((error: unknown) =>
          report(error, StoreResourceErrorPhase.dispose)
        )
    } catch (error) {
      report(error, StoreResourceErrorPhase.dispose)
    }
  }
  const cleanupUnique = (values: T[], ledger?: ISyncStartedDisposalLedger) => {
    const seen: T[] = []
    for (const value of values) {
      if (seen.some((item) => Object.is(item, value)) || heldElsewhere(value)) continue
      seen.push(value)
      cleanupOnce(value, ledger)
    }
  }
  const cancelEviction = () => cachePolicy.cancelEviction()
  const releaseRetired = (id: number) => {
    // Peek, don't mint: `versionToken(id)` creates one on a miss, which would
    // silently revive an already-pruned entry just to ask whether it has
    // owners (it never does, having just been minted) — self-correcting but
    // pointless, and it defeats the point of asking in the first place.
    const existingToken = versionTokens.get(id)
    if (
      (existingToken && ownership.versionOwnerCountToken(existingToken) !== 0) ||
      captures.has(id)
    )
      return
    const retired = versions.takeRetired(id) ?? versions.takeClosing(id)
    if (retired) cleanupUnique([retired.value])
    pruneVersionToken(id)
  }
  /**
   * Release the token minted for a version once nothing can reach it anymore.
   *
   * `version` (the monotonic counter) only tracks the _last produced_ id, not the _currently
   * visible_ one — after the ready value at that id is evicted to idle, `version` still equals it,
   * so a plain `id !== version` guard would refuse to prune the very token that just became
   * unreachable. Check the actual current state instead, plus the version registry (stale/
   * retired/closing) and any live ownership lease. `.get` only peeks: `versionToken(id)` itself
   * mints on miss, which would be wrong inside a "can we forget this" check.
   */
  const pruneVersionToken = (id: number) => {
    const current = currentState()
    const stillVisible = current.kind === StoreResourceKind.ready && current.current.id === id
    if (stillVisible || versions.has(id)) return
    const token = versionTokens.get(id)
    if (token && ownership.versionOwnerCountToken(token) > 0) return
    versionTokens.delete(id)
  }
  const retire = (retiredVersion: number, value: T) => {
    versions.retire({ id: retiredVersion, token: versionToken(retiredVersion), value })
    releaseRetired(retiredVersion)
  }
  const scheduleEviction = () =>
    cachePolicy.scheduleEviction(() => {
      if (hasOwners()) return
      // A first-load dispose can leave a value in `closing` after its
      // provisional resource owner releases before settlement. That value has
      // no version lease, so TTL must terminate the closing resource too.
      if (currentState().kind === StoreResourceKind.closing) {
        forceDisposeResource()
        return
      }
      const stale = versions.takeStale()
      if (stale) {
        cleanupUnique([stale.value])
        pruneVersionToken(stale.id)
      }
      const current = currentState()
      if (current.kind === StoreResourceKind.ready) {
        const evicted = current.current
        core.reset()
        notify()
        cleanupUnique([evicted.value])
        pruneVersionToken(evicted.id)
      }
    })
  const forceDisposeResource = () => {
    const wasDisposed = currentState().kind === StoreResourceKind.disposed
    cachePolicy.dispose()
    ownership.forceReset()
    captures.clear()
    const visible = currentState()
    core.dispose()
    const values = [
      ...versions.clear(),
      ...(visible.kind === StoreResourceKind.ready ? [visible.current.value] : []),
      ...(visible.kind === StoreResourceKind.closing && visible.current
        ? [visible.current.value]
        : [])
    ]
    terminateOwnership()
    if (!wasDisposed) notify()
    listenerChannel.clear()
    listenerRegistrations.clear()
    const physicalLedger = createSyncStartedDisposalLedger()
    cleanupUnique(values, physicalLedger)
    const physicalOutcome = physicalLedger.seal()
    physicalTerminal = physicalOutcome.physicalCompletion.then(({ cleanupErrors }) => {
      for (const item of cleanupErrors) {
        report(item.error, StoreResourceErrorPhase.dispose)
      }
    })
    for (const item of physicalOutcome.cleanupErrors)
      report(item.error, StoreResourceErrorPhase.dispose)
    versionTokens.clear()
    try {
      config.onTerminal?.()
    } catch (error) {
      report(error, StoreResourceErrorPhase.dispose)
    }
  }
  const finalizeClosingFailure = (error: unknown, superseded: T[], stale?: IResourceVersion<T>) => {
    // Closing has no legal failed state. Transition to terminal first so
    // observers cannot see a half-closed resource, then report the original
    // load failure and release every value that was waiting on settlement.
    // Never call failed()/ready() here: both reject a closing controller. Keep
    // cleanup/report in finally-style guards so a notification or disposer
    // failure cannot strand the resource in an empty closing state.
    try {
      terminateOwnership()
      notify()
    } catch (transitionError) {
      report(transitionError, StoreResourceErrorPhase.load)
    }
    try {
      cleanupUnique([...superseded, ...(stale ? [stale.value] : [])])
    } finally {
      report(error, StoreResourceErrorPhase.load)
      forceDisposeResource()
    }
  }
  const onOwnersChanged = () => {
    if (hasCommittedOwners()) return
    if (
      (currentState().kind === StoreResourceKind.closing && !hasVersionReservations()) ||
      (currentState().kind === StoreResourceKind.disposed && versions.hasPending)
    ) {
      forceDisposeResource()
      return
    }
    if (currentState().kind === StoreResourceKind.ready) scheduleEviction()
  }
  const start = () => {
    if (
      currentState().kind === StoreResourceKind.disposed ||
      currentState().kind === StoreResourceKind.closing
    )
      throw createStoreLightError(
        StoreLightErrorCode.resourceDisposed,
        StoreLightErrorText.resourceDisposed
      )
    if (currentState().kind !== StoreResourceKind.idle) return
    const operation = core.refetch()
    const context = activeContext
    captures.bind(context.generation, operation)
    void operation
      .then(
        (next) => {
          if (context.signal.aborted || terminal.lifecycle === LifecycleState.terminal) return
          const stale = versions.takeStale()
          const sameIdentity = stale !== undefined && Object.is(next, stale.value)
          if (!sameIdentity) version++
          if (stale && !sameIdentity) retire(stale.id, stale.value)
          try {
            captures.resolve(context.generation, version)
          } catch (error) {
            // Capture housekeeping cannot replace a successfully loaded canonical value.
            report(error, StoreResourceErrorPhase.dispose)
          }
          if (terminal.lifecycle === LifecycleState.closing)
            closeOwnership({ id: version, token: versionToken(version), value: next })
          notify()
          cleanupUnique(versions.takeSuperseded())
          if (!hasOwners()) scheduleEviction()
        },
        (error: unknown) => {
          captures.discard(context.generation)
          if (context.signal.aborted || terminal.lifecycle === LifecycleState.terminal) return
          const superseded = versions.takeSuperseded()
          const stale = versions.takeStale()
          if (terminal.lifecycle === LifecycleState.closing) {
            finalizeClosingFailure(error, superseded, stale)
            return
          }
          if (stale) core.hydrate({ version: 1, data: stale.value, updatedAt: 0, expiresAt: null })
          notify()
          cleanupUnique(superseded)
          if (stale && !hasOwners()) scheduleEviction()
          report(error, StoreResourceErrorPhase.load)
        }
      )
      .catch((error: unknown) => report(error, StoreResourceErrorPhase.load))
  }
  const snapshot = (value: T, id: number): IStoreResourceSnapshot<T> => ({
    value,
    version: id,
    token: versionToken(id)
  })
  const readSnapshot = (): IStoreResourceSnapshot<T> => {
    const current = currentState()
    if (current.kind === StoreResourceKind.ready)
      return snapshot(current.current.value, current.current.id)
    if (current.kind === StoreResourceKind.closing) {
      if (current.current && ownership.hasResourceOwners)
        return snapshot(current.current.value, current.current.id)
      throw createStoreLightError(
        StoreLightErrorCode.resourceDisposed,
        StoreLightErrorText.resourceDisposed
      )
    }
    if (current.kind === StoreResourceKind.failed) throw current.error
    if (current.kind === StoreResourceKind.loading && current.previous)
      return snapshot(current.previous.value, current.previous.id)
    start()
    const loading = currentState()
    if (loading.kind === StoreResourceKind.loading) throw loading.operation
    throw createStoreLightError(
      StoreLightErrorCode.resourceDisposed,
      StoreLightErrorText.resourceDisposed
    )
  }
  const captureSnapshot = (existingLease?: object) => {
    const current = currentState()
    if (current.kind === StoreResourceKind.ready) {
      const rendered = snapshot(current.current.value, current.current.id)
      if (
        existingLease !== undefined &&
        activeLeaseTokens.get(existingLease) === current.current.id
      )
        return { snapshot: rendered, capture: undefined }
      return {
        snapshot: rendered,
        capture: captures.capture(current.current.id) as IResourceCapture
      }
    }
    if (current.kind === StoreResourceKind.closing && current.current) {
      if (
        existingLease === undefined ||
        activeLeaseTokens.get(existingLease) !== current.current.id
      )
        throw createStoreLightError(
          StoreLightErrorCode.resourceDisposed,
          StoreLightErrorText.resourceDisposed
        )
      return { snapshot: snapshot(current.current.value, current.current.id), capture: undefined }
    }
    if (current.kind === StoreResourceKind.failed) throw current.error
    if (current.kind === StoreResourceKind.loading) {
      if (current.previous) {
        const rendered = snapshot(current.previous.value, current.previous.id)
        if (
          existingLease !== undefined &&
          activeLeaseTokens.get(existingLease) === current.previous.id
        )
          return { snapshot: rendered, capture: undefined }
        return {
          snapshot: rendered,
          capture: captures.capture(current.previous.id) as IResourceCapture
        }
      }
      captures.capturePending(activeContext.generation, current.operation)
      throw current.operation
    }
    captures.capture()
    start()
    const loading = currentState()
    if (loading.kind === StoreResourceKind.loading) throw loading.operation
    throw createStoreLightError(
      StoreLightErrorCode.resourceDisposed,
      StoreLightErrorText.resourceDisposed
    )
  }
  const retainResourceLease = () => {
    if (
      currentState().kind === StoreResourceKind.disposed ||
      currentState().kind === StoreResourceKind.closing
    )
      throw createStoreLightError(
        StoreLightErrorCode.resourceDisposed,
        StoreLightErrorText.resourceDisposed
      )
    cancelEviction()
    start()
    return ownership.retainResource(() => onOwnersChanged())
  }
  const releaseVersionLease = (id: number) => {
    releaseRetired(id)
    onOwnersChanged()
  }
  const createVersionLease = (id: number) => {
    const releaseOwnership = ownership.retainVersionToken(versionToken(id), () =>
      releaseVersionLease(id)
    )
    let active = true
    const token = () => {
      if (!active) return
      active = false
      activeLeaseTokens.delete(token)
      releaseOwnership()
    }
    activeLeaseTokens.set(token, id)
    return token
  }
  const retainVersionLease = (versionInput: number | IVersionToken) => {
    const id = typeof versionInput === 'number' ? versionInput : tokenVersions.get(versionInput)
    if (id === undefined)
      throw createStoreLightError(
        StoreLightErrorCode.unknownVersion,
        StoreLightErrorText.unknownResourceVersion
      )
    if (
      currentState().kind === StoreResourceKind.disposed ||
      currentState().kind === StoreResourceKind.closing
    )
      throw createStoreLightError(
        StoreLightErrorCode.resourceDisposed,
        StoreLightErrorText.resourceDisposed
      )
    if (id !== version && !versions.hasRetired(id) && versions.stale?.id !== id)
      throw createStoreLightError(
        StoreLightErrorCode.unknownVersion,
        StoreLightErrorText.unknownResourceVersion
      )
    cancelEviction()
    start()
    return createVersionLease(id)
  }
  const captureVersion = (id: number) => {
    if (
      currentState().kind === StoreResourceKind.disposed ||
      currentState().kind === StoreResourceKind.closing
    )
      throw createStoreLightError(
        StoreLightErrorCode.resourceDisposed,
        StoreLightErrorText.resourceDisposed
      )
    if (id !== version && !versions.hasRetired(id) && versions.stale?.id !== id)
      throw createStoreLightError(
        StoreLightErrorCode.unknownVersion,
        StoreLightErrorText.unknownResourceVersion
      )
    return captures.capture(id)
  }
  const commitCapture = (capture: IResourceCapture) => {
    const id = captures.inspect(capture)
    if (currentState().kind === StoreResourceKind.disposed)
      throw createStoreLightError(
        StoreLightErrorCode.resourceDisposed,
        StoreLightErrorText.resourceDisposed
      )
    if (
      id !== version &&
      !versions.hasRetired(id) &&
      versions.stale?.id !== id &&
      !versions.hasClosing(id)
    )
      throw createStoreLightError(
        StoreLightErrorCode.unknownVersion,
        StoreLightErrorText.unknownResourceVersion
      )
    captures.commit(capture)
    cancelEviction()
    return createVersionLease(id)
  }
  const api: IStoreResource<T> = {
    read: () => readSnapshot().value,
    readSnapshot,
    captureSnapshot,
    preload() {
      if (currentState().kind === StoreResourceKind.closing)
        throw createStoreLightError(
          StoreLightErrorCode.resourceDisposed,
          StoreLightErrorText.resourceDisposed
        )
      start()
    },
    retry() {
      const previous = currentState()
      if (
        previous.kind === StoreResourceKind.disposed ||
        previous.kind === StoreResourceKind.closing
      )
        throw createStoreLightError(
          StoreLightErrorCode.resourceDisposed,
          StoreLightErrorText.resourceDisposed
        )
      cancelEviction()
      if (previous.kind === StoreResourceKind.ready) versions.setStale(previous.current)
      core.reset()
      notify()
      start()
    },
    retain(leaseVersion?: number) {
      return leaseVersion === undefined ? retainResourceLease() : retainVersionLease(leaseVersion)
    },
    retainResource: retainResourceLease,
    retainVersion: retainVersionLease,
    captureVersion: (id) => captureVersion(id) as IResourceCapture,
    commitCapture,
    dispose() {
      const previous = currentState()
      if (
        previous.kind === StoreResourceKind.disposed ||
        previous.kind === StoreResourceKind.closing
      )
        return
      cancelEviction()
      const keepPendingLoad =
        previous.kind === StoreResourceKind.loading && ownership.hasResourceOwners
      if (!keepPendingLoad) core.cancel()
      const moved = versions.moveToClosing()
      if (previous.kind === StoreResourceKind.ready) moved.versions.push(previous.current)
      versions.beginClosing(moved.versions)
      cleanupUnique(moved.superseded)
      if (
        previous.kind === StoreResourceKind.ready &&
        (hasCommittedOwners() || hasVersionReservations())
      ) {
        closeOwnership(previous.current)
        return
      }
      if (
        previous.kind === StoreResourceKind.loading &&
        previous.previous &&
        hasCommittedOwners()
      ) {
        closeOwnership(previous.previous)
        return
      }
      if (previous.kind === StoreResourceKind.loading && keepPendingLoad) {
        closeOwnership()
        return
      }
      terminateOwnership()
      notify()
      if (!hasOwners() && !ownership.hasVersionOwners) forceDisposeResource()
    },
    forceDispose() {
      if (
        currentState().kind === StoreResourceKind.disposed &&
        !hasOwners() &&
        !versions.hasPending
      )
        return
      forceDisposeResource()
    },
    whenTerminal: () => terminal.whenTerminal().then(() => physicalTerminal),
    getSnapshot: () => revision,
    subscribe(listener) {
      if (currentState().kind === StoreResourceKind.disposed) return () => {}
      const existing = listenerRegistrations.get(listener)
      if (existing) {
        return () => {
          if (listenerRegistrations.get(listener) !== existing) return
          listenerRegistrations.delete(listener)
          existing()
        }
      }
      const registration = listenerChannel.subscribe(() => listener())
      listenerRegistrations.set(listener, registration)
      return () => {
        const current = listenerRegistrations.get(listener)
        if (current !== registration) return
        listenerRegistrations.delete(listener)
        registration()
      }
    }
  }
  return api
}
