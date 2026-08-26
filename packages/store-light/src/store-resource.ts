import { ResourceCachePolicy } from './store-resource-cache-policy.js'
import { ResourceOwnershipRegistry, type IVersionToken } from './store-resource-ownership.js'
import type { IStoreResourceLoadContext } from './store-resource-request.js'
import {
  assimilateCapturedThen,
  createGenerationController,
  probeThenable,
  ThenableProbeKind
} from '@migaia/lifecycle'
import { ResourceStateController } from './store-resource-state.js'
import { StoreResourceKind } from './resource-state-constants.js'
import type { IResourceVersion } from './store-resource-state.js'
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

export type IStoreResourceErrorPhase = 'load' | 'dispose' | 'listener'
export type IStoreResourceOptions<T> = {
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
const RESOURCE_OPTION_KEYS = ['keepAliveMs', 'dispose', 'onError', 'onTerminal'] as const

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
  const requests = createGenerationController()
  const state = new ResourceStateController<T>()
  const ownership = new ResourceOwnershipRegistry<T>()
  const versions = new ResourceVersionRegistry<T>()
  const captures = new ResourceCaptureRegistry(() => {
    queueMicrotask(() => {
      for (const id of versions.retiredIds()) releaseRetired(id)
      onOwnersChanged()
    })
  })
  const cachePolicy = new ResourceCachePolicy(config.keepAliveMs ?? 1000)
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
    report: ({ error }) => report(error, 'listener')
  })
  /** Maps each legacy listener identity to its event-subscriber registration. */
  const listenerRegistrations = new Map<() => void, () => void>()
  const activeLeaseTokens = new WeakMap<object, number>()
  const report = (error: unknown, phase: IStoreResourceErrorPhase) => {
    try {
      config.onError?.(error, phase)
    } catch (reporterError) {
      // A reporter is diagnostic-only, but its own failure must remain
      // observable. Prefer the host's standard reportError sink and fall back
      // to console.error without allowing either sink to affect resource state.
      try {
        const reportError = (globalThis as { reportError?: (error: unknown) => void }).reportError
        if (reportError) reportError(reporterError)
        else console.error(reporterError)
      } catch {
        // No reporting sink is available; preserve state and avoid recursion.
      }
    }
  }
  const notify = () => {
    revision++
    try {
      listenerChannel.publish(undefined)
    } catch (error) {
      if (error instanceof AggregateError) {
        for (const failure of error.errors) report(failure, 'listener')
      } else {
        report(error, 'listener')
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
      report(error, 'dispose')
      return undefined
    }
  }
  const heldElsewhere = (value: T) =>
    versions.holds(value) ||
    ((state.current.kind === StoreResourceKind.ready ||
      state.current.kind === StoreResourceKind.closing) &&
      state.current.current !== undefined &&
      Object.is(state.current.current.value, value))
  const cleanupOnce = (value: T) => {
    if (ownership.isDisposed(value)) return
    const disposer = resolveDisposer(value)
    if (!disposer) return
    ownership.markDisposed(value)
    try {
      // Callers of cleanupOnce run in fire-and-forget contexts (dispose
      // paths declared sync, .then() settlement handlers); an async
      // disposer's rejection has nobody positioned to await it, but must
      // still be reported instead of becoming an unhandled rejection.
      const result = disposer()
      const probe = probeThenable(result)
      if (probe.kind === ThenableProbeKind.failed) report(probe.error, 'dispose')
      else if (probe.kind === ThenableProbeKind.thenable)
        void assimilateCapturedThen(probe.thenFn, result).catch((error: unknown) =>
          report(error, 'dispose')
        )
    } catch (error) {
      report(error, 'dispose')
    }
  }
  const cleanupUnique = (values: T[]) => {
    const seen: T[] = []
    for (const value of values) {
      if (seen.some((item) => Object.is(item, value)) || heldElsewhere(value)) continue
      seen.push(value)
      cleanupOnce(value)
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
    const stillVisible =
      state.current.kind === StoreResourceKind.ready && state.current.current.id === id
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
      if (state.current.kind === StoreResourceKind.closing) {
        forceDisposeResource()
        return
      }
      const stale = versions.takeStale()
      if (stale) {
        cleanupUnique([stale.value])
        pruneVersionToken(stale.id)
      }
      if (state.current.kind === StoreResourceKind.ready) {
        const evicted = state.current.current
        state.idle()
        notify()
        cleanupUnique([evicted.value])
        pruneVersionToken(evicted.id)
      }
    })
  const forceDisposeResource = () => {
    const wasDisposed = state.current.kind === StoreResourceKind.disposed
    cachePolicy.dispose()
    requests.dispose()
    ownership.forceReset()
    captures.clear()
    const visible = state.current
    const values = [
      ...versions.clear(),
      ...(visible.kind === StoreResourceKind.ready ? [visible.current.value] : []),
      ...(visible.kind === StoreResourceKind.closing && visible.current
        ? [visible.current.value]
        : [])
    ]
    state.dispose()
    if (!wasDisposed) notify()
    listenerChannel.clear()
    listenerRegistrations.clear()
    cleanupUnique(values)
    versionTokens.clear()
    try {
      config.onTerminal?.()
    } catch (error) {
      report(error, 'dispose')
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
      state.dispose()
      notify()
    } catch (transitionError) {
      report(transitionError, 'load')
    }
    try {
      cleanupUnique([...superseded, ...(stale ? [stale.value] : [])])
    } finally {
      report(error, 'load')
      forceDisposeResource()
    }
  }
  const onOwnersChanged = () => {
    if (hasCommittedOwners()) return
    if (
      (state.current.kind === StoreResourceKind.closing && !hasVersionReservations()) ||
      (state.current.kind === StoreResourceKind.disposed && versions.hasPending)
    ) {
      forceDisposeResource()
      return
    }
    if (state.current.kind === StoreResourceKind.ready) scheduleEviction()
  }
  const start = () => {
    if (
      state.current.kind === StoreResourceKind.disposed ||
      state.current.kind === StoreResourceKind.closing
    )
      throw createStoreLightError(
        StoreLightErrorCode.resourceDisposed,
        StoreLightErrorText.resourceDisposed
      )
    if (state.current.kind !== StoreResourceKind.idle) return
    const context = requests.begin()
    const operation = Promise.resolve()
      .then(() => load(context))
      .then((next) => {
        assertDisposableValue(next)
        if (state.current.kind === StoreResourceKind.disposed) {
          if (!heldElsewhere(next)) cleanupUnique([next])
          return next
        }
        if (!requests.isCurrent(context.token)) {
          captures.discard(context.generation)
          if (state.current.kind === StoreResourceKind.loading) versions.addSuperseded(next)
          else cleanupUnique([next])
          return next
        }
        if (ownership.isDisposed(next))
          throw createStoreLightError(
            StoreLightErrorCode.resourceDisposed,
            StoreLightErrorText.disposedResourceValue
          )
        const stale = versions.takeStale()
        const sameIdentity = stale !== undefined && Object.is(next, stale.value)
        if (stale && !sameIdentity) retire(version, stale.value)
        if (!sameIdentity) version++
        captures.resolve(context.generation, version)
        const published = { id: version, token: versionToken(version), value: next }
        if (state.current.kind === StoreResourceKind.closing) state.close(published)
        else state.ready(published)
        notify()
        cleanupUnique(versions.takeSuperseded())
        if (!hasOwners()) scheduleEviction()
        return next
      })
      .catch((error) => {
        if (requests.isCurrent(context.token)) {
          captures.discard(context.generation)
          const superseded = versions.takeSuperseded()
          const stale = versions.takeStale()
          if (state.current.kind === StoreResourceKind.closing) {
            finalizeClosingFailure(error, superseded, stale)
            throw error
          }
          if (stale) {
            state.ready(stale)
            notify()
            cleanupUnique(superseded)
            if (!hasOwners()) scheduleEviction()
          } else {
            state.failed(error)
            notify()
            cleanupUnique(superseded)
          }
          report(error, 'load')
        }
        throw error
      })
    captures.bind(context.generation, operation)
    state.loading(operation, versions.stale)
    void operation.catch(() => undefined)
  }
  const snapshot = (value: T, id: number): IStoreResourceSnapshot<T> => ({
    value,
    version: id,
    token: versionToken(id)
  })
  const readSnapshot = (): IStoreResourceSnapshot<T> => {
    const current = state.current
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
    const loading = state.current
    if (loading.kind === StoreResourceKind.loading) throw loading.operation
    throw createStoreLightError(
      StoreLightErrorCode.resourceDisposed,
      StoreLightErrorText.resourceDisposed
    )
  }
  const captureSnapshot = (existingLease?: object) => {
    const current = state.current
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
      captures.capturePending(requests.generation, current.operation)
      throw current.operation
    }
    captures.capture()
    start()
    const loading = state.current
    if (loading.kind === StoreResourceKind.loading) throw loading.operation
    throw createStoreLightError(
      StoreLightErrorCode.resourceDisposed,
      StoreLightErrorText.resourceDisposed
    )
  }
  const retainResourceLease = () => {
    if (
      state.current.kind === StoreResourceKind.disposed ||
      state.current.kind === StoreResourceKind.closing
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
      state.current.kind === StoreResourceKind.disposed ||
      state.current.kind === StoreResourceKind.closing
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
      state.current.kind === StoreResourceKind.disposed ||
      state.current.kind === StoreResourceKind.closing
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
    if (state.current.kind === StoreResourceKind.disposed)
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
      if (state.current.kind === StoreResourceKind.closing)
        throw createStoreLightError(
          StoreLightErrorCode.resourceDisposed,
          StoreLightErrorText.resourceDisposed
        )
      start()
    },
    retry() {
      const previous = state.current
      if (
        previous.kind === StoreResourceKind.disposed ||
        previous.kind === StoreResourceKind.closing
      )
        throw createStoreLightError(
          StoreLightErrorCode.resourceDisposed,
          StoreLightErrorText.resourceDisposed
        )
      cancelEviction()
      requests.supersede()
      if (previous.kind === StoreResourceKind.ready) versions.setStale(previous.current)
      state.idle()
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
      const previous = state.current
      if (
        previous.kind === StoreResourceKind.disposed ||
        previous.kind === StoreResourceKind.closing
      )
        return
      cancelEviction()
      const keepPendingLoad =
        previous.kind === StoreResourceKind.loading && ownership.hasResourceOwners
      if (!keepPendingLoad) requests.supersede()
      const moved = versions.moveToClosing()
      if (previous.kind === StoreResourceKind.ready) moved.versions.push(previous.current)
      versions.beginClosing(moved.versions)
      cleanupUnique(moved.superseded)
      if (
        previous.kind === StoreResourceKind.ready &&
        (hasCommittedOwners() || hasVersionReservations())
      ) {
        state.close(previous.current)
        return
      }
      if (
        previous.kind === StoreResourceKind.loading &&
        previous.previous &&
        hasCommittedOwners()
      ) {
        state.close(previous.previous)
        return
      }
      if (previous.kind === StoreResourceKind.loading && keepPendingLoad) {
        state.close()
        return
      }
      state.dispose()
      notify()
      if (!hasOwners() && !ownership.hasVersionOwners) forceDisposeResource()
    },
    forceDispose() {
      if (state.current.kind === StoreResourceKind.disposed && !hasOwners() && !versions.hasPending)
        return
      forceDisposeResource()
    },
    whenTerminal: () => state.whenTerminal(),
    getSnapshot: () => revision,
    subscribe(listener) {
      if (state.current.kind === StoreResourceKind.disposed) return () => {}
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
