import {
  ReactiveErrorPhase,
  type IDisposable,
  type IObservable,
  type IObserver,
  type IRuntime
} from '@migaia/reactive/runtime'
import type { Signal } from '@migaia/reactive/reactive/signal.class'
import { internalsOf } from '@migaia/reactive/internals'
import { internalRuntimeOf } from '@migaia/reactive/node-factories'
import { claimOwnership } from '@migaia/reactive/ownership'
import { registerDeps, registerDepVersions } from '@migaia/reactive/node-internals'
import { attachSecondaryErrors } from '@migaia/utils/error'
import {
  assimilateCapturedThen,
  createGenerationController,
  createTerminalController,
  probeThenable,
  systemScheduler,
  snapshotScheduler,
  LifecycleState,
  ThenableProbeKind,
  type IGenerationToken,
  type ILifecycleScheduler,
  type IScheduledTask
} from '@migaia/lifecycle'
import { observeAbortSubscription, type IAbortSignal } from '@migaia/lifecycle/abort'
import {
  createResourceError,
  RESOURCE_SOURCE,
  tagResourceError,
  type IResourceError
} from './errors.js'
import { ResourceErrorCode } from './error-code.js'
import { ResourceErrorText } from './error-text.js'
import { ResourceStatus } from './state-constants.js'
export { ResourceStatus, type IResourceStatus } from './state-constants.js'

export type IResourceState<T> =
  | { status: typeof ResourceStatus.idle }
  | { status: typeof ResourceStatus.pending }
  | { status: typeof ResourceStatus.success; data: T; refreshing?: boolean }
  | { status: typeof ResourceStatus.error; error: unknown }
  | { status: typeof ResourceStatus.cancelled; error: DOMException }

export type IResourceFetchStatus = typeof ResourceStatus.idle | typeof ResourceStatus.fetching

export type IResourceFetcher<T> = (ctx: { signal: IAbortSignal }) => T | PromiseLike<T>

export type IResourceCacheSnapshot<T> = {
  readonly version: 1
  readonly data: T
  readonly updatedAt: number
  /** `null` represents an infinite lifetime in JSON-safe form. */
  readonly expiresAt: number | null
}

export type IResourceRetryPolicy = number | ((failureCount: number, error: unknown) => boolean)

type IResourceExpiry = {
  readonly updatedAt: number
  readonly expiresAt: number
}

/** Normalized, validated constructor options retained after the single admission snapshot. */
type IResourceOptionSnapshot<T> = {
  readonly debugName: string | undefined
  readonly ttl: number
  readonly autoStart: boolean
  readonly staleWhileRevalidate: boolean
  readonly retry: IResourceRetryPolicy
  readonly retryDelay: number | ((failureCount: number, error: unknown) => number)
  readonly keepAlive: boolean
  readonly initialSnapshot: IResourceCacheSnapshot<T> | undefined
  readonly scheduler: ILifecycleScheduler
}

export type IResourceOptions<T = unknown> = {
  debugName?: string
  /**
   * Successful values remain fresh for this many milliseconds. `Infinity` keeps them fresh until a
   * dependency changes or `refetch()` is called.
   */
  ttl?: number
  /** Start the first request in the constructor. Defaults to true. */
  autoStart?: boolean
  /** Keep stale success data visible while a background refresh runs. */
  staleWhileRevalidate?: boolean
  /** Retry count or predicate. Suspense Promise throws do not count. */
  retry?: IResourceRetryPolicy
  retryDelay?: number | ((failureCount: number, error: unknown) => number)
  /** Keep upstream reactive edges while no state consumer exists. */
  keepAlive?: boolean
  /** SSR/persisted success cache used before optional revalidation. */
  initialSnapshot?: IResourceCacheSnapshot<T>
  /**
   * 时间域与排程来源（`runtime-neutrality.sdd.md` R-9 / AR-02）：TTL/`updatedAt`/`expiresAt`/retry delay 全部走同一
   * scheduler，默认 lifecycle `systemScheduler`。缺宿主能力时 fail-fast，不静默降级成微任务。
   */
  scheduler?: ILifecycleScheduler
}

function abortError(): DOMException {
  return tagResourceError(
    new DOMException('resource request aborted', 'AbortError'),
    ResourceErrorCode.requestAborted
  )
}

class ResourceCancelledError extends DOMException {
  constructor() {
    super('resource request cancelled', 'AbortError')
    tagResourceError(this, ResourceErrorCode.requestCancelled)
  }
}

function validateTtl(ttl: number): void {
  if (ttl !== Infinity && (!Number.isFinite(ttl) || ttl < 0)) {
    throw tagResourceError(
      new RangeError(ResourceErrorText.ttlInvalid),
      ResourceErrorCode.invalidOption
    )
  }
}

/** Rejects finite TTL arithmetic that would turn a cache deadline into Infinity. */
function calculateExpiresAt(updatedAt: number, ttl: number): number {
  if (ttl === Infinity) return Infinity
  const expiresAt = updatedAt + ttl
  if (!Number.isFinite(expiresAt)) {
    throw tagResourceError(
      new RangeError(ResourceErrorText.ttlExpirationOverflow),
      ResourceErrorCode.invalidOption
    )
  }
  return expiresAt
}

function validateRetry(retry: IResourceRetryPolicy): void {
  if (typeof retry === 'number' && (!Number.isInteger(retry) || retry < 0)) {
    throw tagResourceError(
      new RangeError(ResourceErrorText.retryInvalid),
      ResourceErrorCode.invalidOption
    )
  }
}

/** Creates an option failure and reports a hostile thenable returned by a sync retry policy. */
function createInvalidRetryPolicyResult(
  value: unknown,
  message: string,
  reportLateRejection: (error: unknown) => void
): IResourceError {
  const probe = probeThenable(value)
  if (probe.kind === ThenableProbeKind.failed) {
    return createResourceOptionTypeError(message, probe.error)
  }
  if (probe.kind === ThenableProbeKind.thenable) {
    void assimilateCapturedThen<void>(probe.thenFn, value).catch(reportLateRejection)
  }
  return createResourceOptionTypeError(message)
}

/** Creates a native option type error while preserving a hostile getter as its cause. */
function createResourceOptionTypeError(message: string, cause?: unknown): IResourceError {
  const error = new TypeError(message, cause === undefined ? undefined : { cause })
  return tagResourceError(error, ResourceErrorCode.invalidOption) as IResourceError
}

/** Reads one public option once and maps a hostile accessor to Resource INVALID_OPTION. */
function readResourceOption<T, K extends keyof IResourceOptions<T>>(
  options: IResourceOptions<T>,
  key: K,
  message: string
): IResourceOptions<T>[K] {
  try {
    return options[key]
  } catch (error) {
    throw createResourceOptionTypeError(message, error)
  }
}

/** Snapshots and validates one initial cache value before runtime ownership is established. */
function snapshotInitialSnapshot<T>(value: unknown): IResourceCacheSnapshot<T> | undefined {
  if (value === undefined) return undefined
  if (value === null || typeof value !== 'object') {
    throw createResourceError(ResourceErrorCode.invalidSnapshot, ResourceErrorText.invalidSnapshot)
  }
  let version: unknown
  let data: T
  let updatedAt: unknown
  let expiresAt: unknown
  try {
    version = (value as { version?: unknown }).version
    data = (value as { data: T }).data
    updatedAt = (value as { updatedAt?: unknown }).updatedAt
    expiresAt = (value as { expiresAt?: unknown }).expiresAt
  } catch (error) {
    throw createResourceError(
      ResourceErrorCode.invalidSnapshot,
      ResourceErrorText.invalidSnapshot,
      { cause: error }
    )
  }
  if (
    version !== 1 ||
    typeof updatedAt !== 'number' ||
    !Number.isFinite(updatedAt) ||
    (expiresAt !== null && (typeof expiresAt !== 'number' || !Number.isFinite(expiresAt)))
  ) {
    throw createResourceError(ResourceErrorCode.invalidSnapshot, ResourceErrorText.invalidSnapshot)
  }
  return { version: 1, data, updatedAt, expiresAt }
}

/** Admits every public constructor option exactly once before Resource ownership or fetch setup. */
function snapshotResourceOptions<T>(options: IResourceOptions<T>): IResourceOptionSnapshot<T> {
  if (options === null || (typeof options !== 'object' && typeof options !== 'function')) {
    throw createResourceOptionTypeError(ResourceErrorText.optionsSnapshotFailed)
  }
  const debugName = readResourceOption(
    options,
    'debugName',
    ResourceErrorText.debugNameAccessorFailed
  )
  const ttl = readResourceOption(options, 'ttl', ResourceErrorText.optionsSnapshotFailed)
  const autoStart = readResourceOption(
    options,
    'autoStart',
    ResourceErrorText.autoStartAccessorFailed
  )
  const staleWhileRevalidate = readResourceOption(
    options,
    'staleWhileRevalidate',
    ResourceErrorText.optionsSnapshotFailed
  )
  const retry = readResourceOption(options, 'retry', ResourceErrorText.optionsSnapshotFailed)
  const retryDelay = readResourceOption(
    options,
    'retryDelay',
    ResourceErrorText.optionsSnapshotFailed
  )
  const keepAlive = readResourceOption(
    options,
    'keepAlive',
    ResourceErrorText.optionsSnapshotFailed
  )
  const initialSnapshot = readResourceOption(
    options,
    'initialSnapshot',
    ResourceErrorText.initialSnapshotAccessorFailed
  )
  const schedulerOption = readResourceOption(
    options,
    'scheduler',
    ResourceErrorText.optionsSnapshotFailed
  )

  if (debugName !== undefined && typeof debugName !== 'string') {
    throw createResourceOptionTypeError(ResourceErrorText.debugNameInvalid)
  }
  const admittedTtl = ttl ?? Infinity
  if (typeof admittedTtl !== 'number') {
    throw createResourceOptionTypeError(ResourceErrorText.ttlInvalid)
  }
  validateTtl(admittedTtl)
  if (autoStart !== undefined && typeof autoStart !== 'boolean') {
    throw createResourceOptionTypeError(ResourceErrorText.booleanOptionInvalid)
  }
  if (staleWhileRevalidate !== undefined && typeof staleWhileRevalidate !== 'boolean') {
    throw createResourceOptionTypeError(ResourceErrorText.booleanOptionInvalid)
  }
  const admittedRetry = retry ?? 0
  if (typeof admittedRetry !== 'number' && typeof admittedRetry !== 'function') {
    throw createResourceOptionTypeError(ResourceErrorText.retryInvalid)
  }
  const validatedRetry = admittedRetry as IResourceRetryPolicy
  validateRetry(validatedRetry)
  const admittedRetryDelay = retryDelay ?? 0
  if (typeof admittedRetryDelay !== 'number' && typeof admittedRetryDelay !== 'function') {
    throw createResourceOptionTypeError(ResourceErrorText.retryDelayInvalid)
  }
  if (
    typeof admittedRetryDelay === 'number' &&
    (!Number.isFinite(admittedRetryDelay) || admittedRetryDelay < 0)
  ) {
    throw tagResourceError(
      new RangeError(ResourceErrorText.retryDelayInvalid),
      ResourceErrorCode.invalidOption
    )
  }
  if (keepAlive !== undefined && typeof keepAlive !== 'boolean') {
    throw createResourceOptionTypeError(ResourceErrorText.booleanOptionInvalid)
  }
  const validatedRetryDelay = admittedRetryDelay as
    | number
    | ((failureCount: number, error: unknown) => number)
  const admittedInitialSnapshot = snapshotInitialSnapshot<T>(initialSnapshot)
  let admittedScheduler = systemScheduler
  if (schedulerOption !== undefined) {
    let schedulerSnapshot: ILifecycleScheduler | undefined
    try {
      schedulerSnapshot = snapshotScheduler(schedulerOption)
    } catch (error) {
      const cause = error instanceof Error && 'cause' in error ? error.cause : error
      throw createResourceOptionTypeError(ResourceErrorText.schedulerAccessorFailed, cause)
    }
    if (schedulerSnapshot === undefined) {
      throw createResourceOptionTypeError(ResourceErrorText.schedulerInvalid)
    }
    admittedScheduler = schedulerSnapshot
  }
  return {
    debugName: debugName as string | undefined,
    ttl: admittedTtl,
    autoStart: (autoStart ?? true) as boolean,
    staleWhileRevalidate: (staleWhileRevalidate ?? false) as boolean,
    retry: validatedRetry,
    retryDelay: validatedRetryDelay,
    keepAlive: (keepAlive ?? false) as boolean,
    initialSnapshot: admittedInitialSnapshot,
    scheduler: admittedScheduler
  }
}

/** Wraps scheduler admission/cleanup failures without losing the original failure identity. */
function createSchedulerFailure(error: unknown): IResourceError {
  return createResourceError(
    ResourceErrorCode.invalidOption,
    ResourceErrorText.schedulerTaskOperationFailed,
    { cause: error }
  )
}

/** Identifies the Resource-owned wrapper so passive reads do not wrap one clock failure twice. */
function isSchedulerFailure(error: unknown): error is IResourceError {
  return (
    error !== null &&
    (typeof error === 'object' || typeof error === 'function') &&
    (error as { readonly source?: unknown }).source === RESOURCE_SOURCE &&
    (error as { readonly code?: unknown }).code === ResourceErrorCode.invalidOption &&
    (error as { readonly message?: unknown }).message ===
      ResourceErrorText.schedulerTaskOperationFailed
  )
}

/** Wraps abort-signal registration failures without exposing a raw host error. */
function createSignalRegistrationFailure(error: unknown): IResourceError {
  return createResourceError(
    ResourceErrorCode.invalidOption,
    ResourceErrorText.signalRegistrationFailed,
    { cause: error }
  )
}

/** Reclassifies cancellation cleanup failures without confusing them with the cancelled state. */
function createCancellationFailure(error: unknown): IResourceError {
  if (
    error !== null &&
    (typeof error === 'object' || typeof error === 'function') &&
    (error as { source?: unknown }).source === RESOURCE_SOURCE
  ) {
    return tagResourceError(error, ResourceErrorCode.cancellationCleanupFailed) as IResourceError
  }
  return createResourceError(
    ResourceErrorCode.cancellationCleanupFailed,
    ResourceErrorText.cancellationCleanupFailed,
    { cause: error }
  )
}

/** Keeps later Resource teardown failures reachable while preserving its package fallback. */
const appendDisposeCleanupErrors = (
  primary: unknown,
  cleanupErrors: readonly unknown[]
): unknown => {
  if (cleanupErrors.length === 0) return primary
  const attached = attachSecondaryErrors(primary, cleanupErrors)
  if (attached === primary) return primary
  const fallback = createResourceError(
    ResourceErrorCode.cancellationCleanupFailed,
    ResourceErrorText.cancellationCleanupFailed,
    { cause: primary }
  )
  return attachSecondaryErrors(fallback, [primary, ...cleanupErrors])
}

/**
 * Cancellable async derivation.
 *
 * Reactive values read synchronously by the fetcher (including an async function's work before its
 * first await) become dependencies. A dependency change coalesces into one fresh request. Reads
 * after an await cannot be tracked by JavaScript's synchronous dependency context and should be
 * moved into a Computed read before awaiting.
 */
export class Resource<T> implements IObserver, IDisposable {
  #_deps = new Set<IObservable>()
  #_depVersions = new Map<IObservable, number>()
  readonly deps: ReadonlySet<IObservable>
  readonly depVersions: ReadonlyMap<IObservable, number>
  readonly runtime: IRuntime
  debugName?: string
  #stateSignal: Signal<IResourceState<T>>
  #fetcher: IResourceFetcher<T>
  #ttl: number
  #staleWhileRevalidate: boolean
  #retry: IResourceRetryPolicy
  #retryDelay: number | ((failureCount: number, error: unknown) => number)
  #keepAlive: boolean
  #requests = createGenerationController()
  #currentPromise: Promise<T> | undefined
  #expiresAt = 0
  #updatedAt = 0
  #requestPending = false
  #refreshScheduled = false
  #forceRefresh = false
  #suspensionGeneration = 0
  #paused = false
  #staleAfterSettlement = false
  /** Holds one validated expiry pair between request admission and success-state publication. */
  #settlementExpiry: IResourceExpiry | undefined
  #terminal = createTerminalController()
  #scheduler: ILifecycleScheduler

  constructor(fetcher: IResourceFetcher<T>, runtime: IRuntime, options: IResourceOptions<T> = {}) {
    const admittedOptions = snapshotResourceOptions(options)
    this.deps = registerDeps(this, this.#_deps)
    this.depVersions = registerDepVersions(this, this.#_depVersions)
    this.runtime = runtime
    // 归属登记走唯一那张表，不再靠字段名让下游去猜
    claimOwnership(this, runtime)
    this.debugName = admittedOptions.debugName
    this.#fetcher = fetcher
    this.#ttl = admittedOptions.ttl
    this.#retry = admittedOptions.retry
    this.#retryDelay = admittedOptions.retryDelay
    this.#staleWhileRevalidate = admittedOptions.staleWhileRevalidate
    this.#keepAlive = admittedOptions.keepAlive
    this.#scheduler = admittedOptions.scheduler
    this.#stateSignal = internalRuntimeOf(runtime).signal<IResourceState<T>>(
      { status: ResourceStatus.idle },
      {
        debugName: admittedOptions.debugName ? `${admittedOptions.debugName}.state` : undefined
      }
    )
    this.#stateSignal.addObservedHooks({
      onObserved: () => {
        this.#suspensionGeneration++
      },
      onUnobserved: () => {
        // Suspended renders have not committed a subscription yet. Aborting
        // here would reject the exact Promise React is waiting for.
        this.#scheduleSuspension()
      }
    })
    if (admittedOptions.initialSnapshot !== undefined) this.hydrate(admittedOptions.initialSnapshot)
    if (
      admittedOptions.autoStart &&
      (admittedOptions.initialSnapshot === undefined || !this.#isFresh())
    ) {
      this.#observe(this.#startRequest())
    }
  }

  /** Reactive state-machine snapshot. Expired success values revalidate. */
  get state(): IResourceState<T> {
    this.#assertUsable()
    this.#ensureFresh()
    return this.#stateSignal.value
  }

  /**
   * Shared promise for the current request or fresh cached value. Multiple readers receive the same
   * promise; it starts work only when idle/stale.
   */
  get promise(): Promise<T> {
    this.#assertUsable()
    this.#ensureFresh()
    if (!this.#currentPromise) {
      throw createResourceError(
        ResourceErrorCode.noActivePromise,
        'resource has no active or cached promise'
      )
    }
    return this.#currentPromise
  }

  get disposed(): boolean {
    return this.#terminal.lifecycle === LifecycleState.terminal
  }

  /** True while a fresh request runs without hiding an existing success value. */
  get refreshing(): boolean {
    if (this.#terminal.lifecycle !== LifecycleState.open) return false
    const state = this.#stateSignal.peek()
    return state.status === ResourceStatus.success && state.refreshing === true
  }

  /** Transport status, separate from the visible data/error state. */
  get fetchStatus(): IResourceFetchStatus {
    this.#assertUsable()
    return this.#requestPending ? ResourceStatus.fetching : ResourceStatus.idle
  }

  /** Whether the currently cached success value has crossed its TTL. */
  get isStale(): boolean {
    this.#assertUsable()
    const state = this.#stateSignal.peek()
    if (state.status !== ResourceStatus.success) return false
    try {
      return !this.#isFresh()
    } catch (error) {
      this.#recordPassiveSchedulerFailure(error)
      return false
    }
  }

  /** Whether reactive consumers currently observe this resource's state. */
  get observed(): boolean {
    return this.#stateSignal.subs.size > 0
  }

  /**
   * Suspense-compatible read: returns cached data, throws the active Promise while pending, and
   * throws the fetch error after failure.
   */
  read(): T {
    this.#assertUsable()
    this.#ensureFresh()
    const state = this.#stateSignal.value
    return this.#materialize(state)
  }

  /**
   * 非追踪读，形状与 `read()` 相同（success 返回值，pending throw Promise，error throw）。
   *
   * 与 `read()` 的差别只有两条：不建依赖边；不顺手 `ensureFresh()` 启动请求。 React getSnapshot /
   * 外部诊断需要「读当前快照但不加入别人的追踪窗口」。
   */
  peek(): T {
    this.#assertUsable()
    return this.#materialize(this.#stateSignal.peek())
  }

  /**
   * Force a new request. Explicit refetches do not reuse a fresh cache entry; passive
   * `promise`/`read()` consumers do.
   */
  refetch(): Promise<T> {
    this.#assertUsable()
    return this.#startRequest()
  }

  /** Mark cached data stale and immediately start a replacement request. */
  invalidate(): Promise<T> {
    this.#assertUsable()
    this.#expiresAt = 0
    return this.#startRequest()
  }

  /** Cancel only the active generation; the Resource remains reusable. */
  cancel(): void {
    this.#assertUsable()
    this.#abortActiveRequest(true)
  }

  dehydrate(): IResourceCacheSnapshot<T> | undefined {
    this.#assertUsable()
    const state = this.#stateSignal.peek()
    if (state.status !== ResourceStatus.success) return undefined
    return {
      version: 1,
      data: state.data,
      updatedAt: this.#updatedAt,
      expiresAt: this.#expiresAt === Infinity ? null : this.#expiresAt
    }
  }

  hydrate(snapshot: IResourceCacheSnapshot<T>): void {
    this.#assertUsable()
    let version: number
    let data: T
    let updatedAt: number
    let expiresAt: number | null
    try {
      ;({ version, data, updatedAt, expiresAt } = snapshot)
    } catch (error) {
      throw createResourceError(
        ResourceErrorCode.invalidSnapshot,
        ResourceErrorText.invalidSnapshot,
        { cause: error }
      )
    }
    if (
      version !== 1 ||
      !Number.isFinite(updatedAt) ||
      (expiresAt !== null && !Number.isFinite(expiresAt))
    ) {
      throw createResourceError(
        ResourceErrorCode.invalidSnapshot,
        ResourceErrorText.invalidSnapshot
      )
    }
    this.#requests.supersede()
    this.#requestPending = false
    this.#paused = false
    internalsOf(this.runtime).tracker.clearDependencies(this)
    this.#updatedAt = updatedAt
    this.#expiresAt = expiresAt ?? Infinity
    this.#stateSignal.value = {
      status: ResourceStatus.success,
      data
    }
    this.#currentPromise = Promise.resolve(data)
  }

  /** A reactive dependency changed. Coalesce diamond/batched invalidations. */
  markDirty(): void {
    this.#scheduleDependencyRefresh(false)
  }

  /** A dependency was disposed; force re-evaluation so failure is observable. */
  onDependencyDisconnected(): void {
    this.#scheduleDependencyRefresh(true)
  }

  dispose(): void {
    if (this.#terminal.lifecycle === LifecycleState.terminal) return
    this.#terminal.close()

    /** First synchronous cleanup failure; later failures attach through `errors`. */
    let primaryCleanupError: unknown
    /** Whether a cleanup operation has already supplied the primary failure. */
    let hasPrimaryCleanupError = false
    /** Cleanup failures after the first, retained without replacing it. */
    const cleanupErrors: unknown[] = []
    /** Runs one teardown operation while allowing all following operations to converge. */
    const runCleanup = (cleanup: () => void): void => {
      try {
        cleanup()
      } catch (error) {
        if (!hasPrimaryCleanupError) {
          hasPrimaryCleanupError = true
          primaryCleanupError = error
        } else {
          cleanupErrors.push(error)
        }
      }
    }

    runCleanup(() => this.#requests.dispose())
    this.#refreshScheduled = false
    this.#forceRefresh = false
    this.#requestPending = false
    this.#staleAfterSettlement = false
    this.#currentPromise = undefined
    runCleanup(() => internalsOf(this.runtime).tracker.clearDependencies(this))
    runCleanup(() => this.#stateSignal.dispose())
    this.#terminal.forceTerminal()

    if (hasPrimaryCleanupError) {
      throw appendDisposeCleanupErrors(primaryCleanupError, cleanupErrors)
    }
  }

  #assertUsable(): void {
    if (this.#terminal.lifecycle !== LifecycleState.open) {
      throw createResourceError(
        ResourceErrorCode.resourceDisposed,
        'cannot use a disposed resource'
      )
    }
  }

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
        if (!this.#currentPromise) {
          throw createResourceError(
            ResourceErrorCode.noActivePromise,
            'resource has no active or cached promise'
          )
        }
        throw this.#currentPromise
    }
  }

  #isFresh(): boolean {
    const state = this.#stateSignal.peek()
    return (
      state.status === ResourceStatus.success &&
      (this.#ttl === 0 || this.#readSchedulerNow() < this.#expiresAt)
    )
  }

  #ensureFresh(): void {
    if (this.#requestPending || this.#paused) return
    const state = this.#stateSignal.peek()
    // error/cancelled are stable, inspectable states. Only explicit
    // refetch()/invalidate() retries them; passive reads must not loop.
    let fresh = true
    if (state.status === ResourceStatus.success) {
      try {
        fresh = this.#isFresh()
      } catch (error) {
        this.#recordPassiveSchedulerFailure(error)
        return
      }
    }
    if (state.status === ResourceStatus.success && this.#ttl === 0) return
    if (
      state.status === ResourceStatus.idle ||
      (state.status === ResourceStatus.success && !fresh)
    ) {
      this.#observe(this.#startRequest())
    }
  }

  /** Reads the normalized scheduler clock and maps host/lifecycle failures to Resource ownership. */
  #readSchedulerNow(): number {
    try {
      return this.#scheduler.now()
    } catch (error) {
      throw createSchedulerFailure(error)
    }
  }

  /** Publishes one passive clock failure without changing the prior cache metadata. */
  #recordPassiveSchedulerFailure(error: unknown): void {
    /** Stable Resource-owned failure shared by state, rejected promise, and reporter. */
    const failure = isSchedulerFailure(error) ? error : createSchedulerFailure(error)
    /** Rejected promise that preserves repeated passive `promise` reads by identity. */
    const rejectedPromise = Promise.reject(failure)
    this.#settlementExpiry = undefined
    this.#requestPending = false
    this.#paused = true
    this.#refreshScheduled = false
    this.#forceRefresh = false
    this.#staleAfterSettlement = false
    this.#currentPromise = rejectedPromise
    this.#observe(rejectedPromise)
    this.#stateSignal.value = { status: ResourceStatus.error, error: failure }
    this.runtime.reportError(failure, { phase: ReactiveErrorPhase.asyncFlush })
  }

  #startRequest(): Promise<T> {
    this.#refreshScheduled = false
    this.#forceRefresh = false
    this.#paused = false
    const requestToken = this.#requests.begin()
    const token = requestToken.token
    const signal = requestToken.signal
    this.#requestPending = true
    this.#staleAfterSettlement = false
    this.#settlementExpiry = undefined
    const current = this.#stateSignal.peek()
    if (this.#staleWhileRevalidate && current.status === ResourceStatus.success) {
      this.#stateSignal.value = { ...current, refreshing: true }
    } else {
      this.#stateSignal.value = { status: ResourceStatus.pending }
    }

    const request = this.#withAbort(this.#executeFetcher({ signal }, 0), signal).then((data) => {
      if (this.#requests.isCurrent(token)) {
        const updatedAt = this.#readSchedulerNow()
        this.#settlementExpiry = {
          updatedAt,
          expiresAt: calculateExpiresAt(updatedAt, this.#ttl)
        }
      }
      return data
    })
    this.#currentPromise = request
    this.#observeSettlement(request, token)
    return request
  }

  #executeFetcher(controller: { signal: IAbortSignal }, failureCount: number): Promise<T> {
    if (controller.signal.aborted) return Promise.reject(abortError())
    let fetched: T | PromiseLike<T>
    try {
      fetched = internalsOf(this.runtime).tracker.runTracked(this, () =>
        this.#fetcher({ signal: controller.signal })
      )
    } catch (error) {
      const probe = probeThenable(error)
      if (probe.kind === ThenableProbeKind.failed) {
        // Getter failed while probing a Suspense throw: surface the getter error and keep the
        // original thrown value reachable — never rewrite it into a plain fetch failure (AF-08).
        return Promise.reject(
          tagResourceError(
            new AggregateError(
              [error, probe.error],
              'resource fetcher threw a value whose then getter failed'
            ),
            ResourceErrorCode.suspenseProbeFailed
          )
        )
      }
      if (probe.kind === 'not-thenable') {
        return this.#retryFailure(error, controller, failureCount)
      }
      // Captured `then` is applied exactly once — no second `.then` read via Promise.resolve.
      return assimilateCapturedThen<void>(probe.thenFn, error).then(() =>
        this.#executeFetcher(controller, failureCount)
      )
    }
    return Promise.resolve(fetched).catch((error: unknown) =>
      this.#retryFailure(error, controller, failureCount)
    )
  }

  #retryFailure(
    error: unknown,
    controller: { signal: IAbortSignal },
    failureCount: number
  ): Promise<T> {
    if (controller.signal.aborted) return Promise.reject(abortError())
    const nextFailureCount = failureCount + 1
    let shouldRetry: boolean
    try {
      shouldRetry =
        typeof this.#retry === 'number'
          ? nextFailureCount <= this.#retry
          : (() => {
              const result = this.#retry(nextFailureCount, error) as unknown
              if (typeof result !== 'boolean') {
                throw createInvalidRetryPolicyResult(
                  result,
                  ResourceErrorText.retryInvalid,
                  (lateError) =>
                    this.runtime.reportError(lateError, {
                      phase: ReactiveErrorPhase.asyncFlush
                    })
                )
              }
              return result
            })()
    } catch (policyError) {
      return Promise.reject(policyError)
    }
    if (!shouldRetry) return Promise.reject(error)
    let delay: number
    try {
      delay =
        typeof this.#retryDelay === 'number'
          ? this.#retryDelay
          : (() => {
              const result = this.#retryDelay(nextFailureCount, error) as unknown
              if (typeof result !== 'number') {
                throw createInvalidRetryPolicyResult(
                  result,
                  ResourceErrorText.retryDelayInvalid,
                  (lateError) =>
                    this.runtime.reportError(lateError, {
                      phase: ReactiveErrorPhase.asyncFlush
                    })
                )
              }
              return result
            })()
    } catch (policyError) {
      return Promise.reject(policyError)
    }
    if (!Number.isFinite(delay) || delay < 0) {
      return Promise.reject(
        tagResourceError(
          new RangeError('resource retry delay must be a non-negative finite number'),
          ResourceErrorCode.invalidOption
        )
      )
    }
    return new Promise<void>((resolve, reject) => {
      let timer: IScheduledTask | undefined
      let settled = false
      let aborted = false
      let callbackStarted = false
      let subscription: ReturnType<typeof observeAbortSubscription> | undefined

      /** Reports cleanup failure without replacing the retry wait's AbortError result. */
      const reportCleanupFailure = (cleanupError: unknown): void => {
        this.runtime.reportError(createCancellationFailure(cleanupError), {
          phase: ReactiveErrorPhase.asyncFlush
        })
      }

      /** Reports scheduler admission failure using the existing scheduler diagnostic code. */
      const reportSchedulerFailure = (schedulerError: unknown): void => {
        this.runtime.reportError(createSchedulerFailure(schedulerError), {
          phase: ReactiveErrorPhase.asyncFlush
        })
      }

      /** Cancels a task returned after an abort/callback race and reports cancel failures. */
      const cancelTask = (task: IScheduledTask, cancellation: boolean): void => {
        try {
          task.cancel()
        } catch (cleanupError) {
          if (cancellation) reportCleanupFailure(cleanupError)
          else reportSchedulerFailure(cleanupError)
        }
      }

      const onAbort = (_reason: unknown): void => {
        if (settled) return
        aborted = true
        settled = true
        let cleanupError: unknown
        let cleanupFailed = false
        if (!callbackStarted) {
          try {
            timer?.cancel()
          } catch (error) {
            cleanupFailed = true
            cleanupError = error
          }
        }
        reject(abortError())
        if (cleanupFailed) reportCleanupFailure(cleanupError)
      }

      const onTimer = (): void => {
        if (settled) return
        callbackStarted = true
        subscription?.unsubscribe()
        if (controller.signal.aborted) {
          onAbort(undefined)
          return
        }
        settled = true
        resolve()
      }

      try {
        if (controller.signal.aborted) {
          settled = true
          reject(abortError())
          return
        }
        // Install first: schedule() may synchronously trigger the generation abort before it
        // returns its task. A listener installed afterward would miss that already-fired signal.
        subscription = observeAbortSubscription(controller.signal, onAbort, reportCleanupFailure)
        subscription.retryRegistrationCleanup()
        if (settled) return

        const scheduled = this.#scheduler.schedule(onTimer, delay)
        timer = scheduled
        if (aborted) {
          // Abort won while schedule() was still constructing the task; the task must not remain
          // armed even though the signal listener had already rejected the wait.
          cancelTask(scheduled, true)
          return
        }
        if (callbackStarted) {
          // Preserve synchronous scheduler callback semantics and AF-62 task snapshot cleanup.
          cancelTask(scheduled, false)
          return
        }
        if (controller.signal.aborted) {
          onAbort(undefined)
          if (aborted) cancelTask(scheduled, true)
        }
      } catch (error) {
        if (settled) {
          if (aborted) reportCleanupFailure(error)
          else reportSchedulerFailure(error)
          return
        }
        settled = true
        subscription?.unsubscribe()
        reject(createSchedulerFailure(error))
      }
    }).then(() => this.#executeFetcher(controller, nextFailureCount))
  }

  #withAbort(source: Promise<T>, signal: IAbortSignal): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let settled = false
      let subscription: ReturnType<typeof observeAbortSubscription> | undefined

      /** Reports listener cleanup without replacing the request's primary settlement. */
      const reportCleanupFailure = (cleanupError: unknown): void => {
        try {
          this.runtime.reportError(createCancellationFailure(cleanupError), {
            phase: ReactiveErrorPhase.asyncFlush
          })
        } catch {
          // Diagnostics are last-boundary best effort; they must not create an unhandled rejection.
        }
      }

      /** Settles cancellation and defers listener removal until hostile registration returns. */
      const onAbort = (_reason: unknown): void => {
        if (settled) return
        settled = true
        reject(abortError())
      }

      /** Settles source success while preserving its value and cleanup semantics. */
      const onSourceValue = (value: T): void => {
        if (settled) return
        settled = true
        subscription?.unsubscribe()
        resolve(value)
      }

      /** Settles source failure while preserving its original rejection object. */
      const onSourceError = (error: unknown): void => {
        if (settled) return
        settled = true
        subscription?.unsubscribe()
        reject(error)
      }

      // Attach source handlers before host-controlled signal registration, preventing an add
      // failure from leaving a rejected source Promise unobserved.
      source.then(onSourceValue, onSourceError)

      try {
        if (signal.aborted) {
          settled = true
          reject(abortError())
          return
        }
      } catch (error) {
        settled = true
        reject(createSignalRegistrationFailure(error))
        return
      }

      try {
        subscription = observeAbortSubscription(signal, onAbort, reportCleanupFailure)
        subscription.retryRegistrationCleanup()
      } catch (error) {
        if (settled) {
          // An abort callback already won; preserve AbortError and expose registration failure via
          // the package diagnostic boundary instead of replacing the primary rejection.
          try {
            this.runtime.reportError(createSignalRegistrationFailure(error), {
              phase: ReactiveErrorPhase.asyncFlush
            })
          } catch {
            // Diagnostics are last-boundary best effort; no unhandled rejection may escape.
          }
          return
        }
        settled = true
        reject(createSignalRegistrationFailure(error))
        return
      }

      let abortedAfterRegistration = false
      try {
        abortedAfterRegistration = signal.aborted
      } catch (error) {
        settled = true
        subscription?.unsubscribe()
        reject(createSignalRegistrationFailure(error))
        return
      }
      if (abortedAfterRegistration) {
        onAbort(undefined)
      }
      if (settled) subscription?.unsubscribe()
    })
  }

  #observeSettlement(request: Promise<T>, token: IGenerationToken): void {
    void request
      .then(
        (data) => {
          if (!this.#requests.isCurrent(token) || this.#terminal.lifecycle !== LifecycleState.open)
            return
          const expiry = this.#settlementExpiry
          this.#settlementExpiry = undefined
          if (expiry === undefined) {
            throw tagResourceError(
              new RangeError(ResourceErrorText.ttlExpirationOverflow),
              ResourceErrorCode.invalidOption
            )
          }
          this.#updatedAt = expiry.updatedAt
          this.#expiresAt = expiry.expiresAt
          if (this.#staleAfterSettlement) {
            this.#expiresAt = 0
            this.#staleAfterSettlement = false
          }
          this.#requestPending = false
          this.#stateSignal.value = { status: ResourceStatus.success, data }
          // autoStart 后从未被观察 → 主动休眠，防止上游边永驻
          if (this.#stateSignal.subs.size === 0) {
            this.#scheduleSuspension()
          }
        },
        (error: unknown) => {
          if (!this.#requests.isCurrent(token) || this.#terminal.lifecycle !== LifecycleState.open)
            return
          this.#settlementExpiry = undefined
          this.#staleAfterSettlement = false
          this.#requestPending = false
          this.#stateSignal.value = { status: ResourceStatus.error, error }
          // autoStart 后从未被观察 → 主动休眠
          if (this.#stateSignal.subs.size === 0) {
            this.#scheduleSuspension()
          }
        }
      )
      .catch((error: unknown) => {
        this.runtime.reportError(error, { phase: ReactiveErrorPhase.asyncFlush })
      })
  }

  /** Attach a rejection handler without replacing the public Promise. */
  #observe(request: Promise<T>): void {
    void request.catch(() => undefined)
  }

  /**
   * Explicit cancellation pauses passive reads until refetch. Suspension aborts the same transport
   * work without pausing, so a later observer can restart the derivation.
   */
  #abortActiveRequest(pause: boolean): void {
    if (!this.#requestPending) return
    let cancellationError: IResourceError | undefined
    try {
      this.#requests.supersede()
    } catch (error) {
      cancellationError = createCancellationFailure(error)
    }
    this.#requestPending = false
    this.#paused = pause
    const current = this.#stateSignal.peek()
    if (current.status === ResourceStatus.pending) {
      this.#stateSignal.value = pause
        ? { status: ResourceStatus.cancelled, error: new ResourceCancelledError() }
        : { status: ResourceStatus.idle }
      if (cancellationError) throw cancellationError
      return
    }
    // AF-07 / AL-02: an in-flight SWR refresh was superseded. Keep the stale success data visible
    // but clear `refreshing` so `fetchStatus === 'idle'` and `refreshing === false` stay consistent
    // instead of leaving a permanent `refreshing: true` with no current request.
    if (current.status === ResourceStatus.success && current.refreshing === true) {
      this.#stateSignal.value = { status: ResourceStatus.success, data: current.data }
    }
    if (cancellationError) throw cancellationError
  }

  #scheduleDependencyRefresh(force: boolean): void {
    if (this.#terminal.lifecycle !== LifecycleState.open) return
    this.#forceRefresh ||= force
    if (this.#refreshScheduled) return
    this.#refreshScheduled = true
    // 与 Computed 挂起同一条 idle 通道：Resource 不得私自 queueMicrotask，
    // 否则 setSchedulerStrategy / scheduleIdle 对异步失效无效。
    internalsOf(this.runtime).deferIdle(() => {
      if (!this.#refreshScheduled || this.#terminal.lifecycle !== LifecycleState.open) return
      this.#refreshScheduled = false
      const mustRefresh = this.#forceRefresh
      this.#forceRefresh = false
      try {
        if (!mustRefresh && !internalsOf(this.runtime).tracker.hasStaleDependencies(this)) {
          return
        }
        this.#observe(this.#startRequest())
      } catch (error) {
        this.#requestPending = false
        this.#expiresAt = 0
        this.#stateSignal.value = { status: ResourceStatus.error, error }
      }
    })
  }

  #scheduleSuspension(): void {
    if (this.#keepAlive || this.#terminal.lifecycle !== LifecycleState.open) return
    const generation = ++this.#suspensionGeneration
    internalsOf(this.runtime).deferIdle(() => {
      if (
        this.#terminal.lifecycle !== LifecycleState.open ||
        this.#keepAlive ||
        this.#stateSignal.subs.size > 0 ||
        generation !== this.#suspensionGeneration
      ) {
        return
      }
      const hadDependencies = this.deps.size > 0
      internalsOf(this.runtime).tracker.clearDependencies(this)
      if (hadDependencies) {
        if (this.#stateSignal.peek().status === ResourceStatus.success) this.#expiresAt = 0
        else if (this.#requestPending) this.#staleAfterSettlement = true
      }
    })
  }
}
