import {
  SerializeChunkKind,
  type ISerializeChunk,
  type ISerializeRegistry
} from '@migaia/serialize'
import { createRuntime, ReactiveErrorPhase } from '@migaia/reactive'
import type { IRuntime, IRuntimeOptions } from '@migaia/reactive'
import { claimOwnership } from '@migaia/reactive/ownership'
import type { IResourceCacheSnapshot } from '@migaia/resource'
import { base64ToBytes, bytesToBase64 } from '@migaia/serialize'
import {
  createStoreSsrAggregateError,
  createStoreSsrError,
  createStoreSsrRangeError,
  createStoreSsrTypeError,
  StoreSsrErrorCode
} from './errors.js'
import { SsrWireType, SsrWorkOutcome } from './ssr-constants.js'
import { StoreSsrErrorText } from './error-text.js'

/** Rejects null/non-object public options before SSR entry points read their fields. */
function assertOptionObject(options: unknown): asserts options is object {
  if (options === null || typeof options !== 'object')
    throw createStoreSsrError(StoreSsrErrorCode.invalidOption, StoreSsrErrorText.optionsObject)
  try {
    Object.getOwnPropertyDescriptors(options)
  } catch (error) {
    throw createStoreSsrError(StoreSsrErrorCode.invalidOption, StoreSsrErrorText.optionsObject, {
      cause: error
    })
  }
}

/** Reads registration ownership once so validation and commit share one stable decision. */
function readRegistrationOwned(options: unknown): boolean {
  assertOptionObject(options)
  try {
    const owned = (options as { readonly owned?: unknown }).owned
    if (owned !== undefined && typeof owned !== 'boolean') {
      throw createStoreSsrError(StoreSsrErrorCode.invalidOption, StoreSsrErrorText.ownedOption)
    }
    return owned ?? true
  } catch (error) {
    if (error instanceof Error && 'code' in error) throw error
    throw createStoreSsrError(StoreSsrErrorCode.invalidOption, StoreSsrErrorText.ownedOption, {
      cause: error
    })
  }
}

export type IJSONPrimitive = string | number | boolean | null
export type IJSONValue =
  | IJSONPrimitive
  | readonly IJSONValue[]
  | { readonly [key: string]: IJSONValue }

export type ISSRState = {
  readonly version: 1
  readonly stores: Readonly<Record<string, Readonly<Record<string, IJSONValue>>>>
  readonly resources?: Readonly<Record<string, IResourceCacheSnapshot<IJSONValue>>>
}

declare const trustedSSRBrand: unique symbol
/**
 * Produced only by `dehydrateTrusted()` — see that method's doc comment for what "trusted"
 * deliberately does _not_ guarantee (no snapshot, no validation, no copy). The brand exists so
 * `serializeTrustedSSRState()` cannot accidentally be handed a value that skipped that path.
 */
export type ITrustedSSRState = ISSRState & {
  readonly [trustedSSRBrand]: true
}

export type ISSRStore = {
  readonly $runtime: IRuntime
  readonly $disposed: boolean
  $plain(): Record<string, unknown>
  $hydrate(state: Record<string, unknown>): void
  $dispose(): void | PromiseLike<void>
}

export type ISSRResource = {
  readonly runtime: IRuntime
  readonly disposed: boolean
  readonly promise: Promise<unknown>
  dehydrate(): IResourceCacheSnapshot<unknown> | undefined
  hydrate(snapshot: IResourceCacheSnapshot<unknown>): void
  dispose(): void
}

export type ISSRRegistrationOptions = {
  /** Request scopes own registered stores by default. */
  readonly owned?: boolean
}

export type ISSRRequestScopeOptions = {
  readonly runtime?: IRuntime
  readonly runtimeOptions?: IRuntimeOptions
}

type ISSRRegistration = {
  readonly store: ISSRStore
  readonly owned: boolean
  /** 释放顺序键（migration.sdd.md §3.1/M-T31）：store 晚于其所属 resource 释放。 */
  readonly order: 1
}

type ISSRResourceRegistration = {
  readonly resource: ISSRResource
  readonly owned: boolean
  /** 释放顺序键（migration.sdd.md §3.1/M-T31）：resource 早于 store 释放。 */
  readonly order: 0
}

export type ISSRResourceFailure = {
  readonly key: string
  readonly error: unknown
}

export type IDehydrateAsyncOptions = {
  /** 覆盖默认的「报给 Runtime.onError」行为。 */
  readonly onResourceError?: (failure: ISSRResourceFailure) => void
  /** 整个等待过程的总预算；超时的 resource 各记一条 failure，不无限期挂起渲染。 */
  readonly timeoutMs?: number
}

export type IAwaitResourcesOptions = {
  readonly timeoutMs?: number
}

/** 瀑布式注册的轮次上限，防止无限自我注册把渲染吊死。 */
const MAX_RESOURCE_ROUNDS = 64
const MAX_JSON_DEPTH = 256
const MAX_JSON_NODES = 1_000_000
/** Host timer maximum; larger SSR budgets are rejected rather than truncated by the runtime. */
const MAX_TIMEOUT_MS = 2_147_483_647

/**
 * `0` is explicitly allowed — see the call site's comment for what it means (expire immediately).
 * Everything else must be finite and non-negative: `NaN`/negative silently misbehave as "expire
 * basically now" too, but by accident (`setTimeout(fn, NaN)` fires almost immediately), not by
 * defined meaning; `Infinity` silently means "never times out" via unbounded arithmetic. Both are
 * corruption-shaped inputs, not edge cases to tolerate.
 */
function assertTimeoutMs(timeoutMs: number | undefined): number | undefined {
  if (
    timeoutMs !== undefined &&
    (!Number.isFinite(timeoutMs) || timeoutMs < 0 || timeoutMs > MAX_TIMEOUT_MS)
  ) {
    throw createStoreSsrRangeError(StoreSsrErrorCode.invalidOption, StoreSsrErrorText.timeoutOption)
  }
  return timeoutMs
}

type IRaceOutcome<T> =
  | { readonly kind: typeof SsrWorkOutcome.value; readonly value: T }
  | { readonly kind: typeof SsrWorkOutcome.disposed }
  | { readonly kind: typeof SsrWorkOutcome.timeout }

/** 三方竞速：真正的等待、scope dispose 信号、可选超时。任何一个先到就结束—— 这是 `awaitResources()` 能被 dispose 中断、也能设超时的唯一入口。 */
async function raceOutcome<T>(
  work: Promise<T>,
  disposedSignal: Promise<void>,
  timeoutMs: number | undefined
): Promise<IRaceOutcome<T>> {
  const candidates: Promise<IRaceOutcome<T>>[] = [
    work.then((value) => ({ kind: SsrWorkOutcome.value, value })),
    disposedSignal.then(() => ({ kind: SsrWorkOutcome.disposed }))
  ]
  let timer: ReturnType<typeof setTimeout> | undefined
  if (timeoutMs !== undefined) {
    candidates.push(
      new Promise<IRaceOutcome<T>>((resolve) => {
        timer = setTimeout(() => resolve({ kind: SsrWorkOutcome.timeout }), timeoutMs)
      })
    )
  }
  try {
    return await Promise.race(candidates)
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/**
 * 一个请求一个 Runtime 与一份注册表。
 *
 * 请求态**全部**是实例字段：没有模块级快照、没有模块级注册表，所以并发的两条流 看不见对方。但这不等于整个库没有模块级状态，那句话过去写得太满：
 *
 * - `defaultRuntime` 是模块级的。它进不来——`register()` 校验 `store.$runtime === this.runtime`，落在默认 Runtime 上的
 *   store 会被当场拒绝， 这条断言才是隔离的实际保证；
 * - `activeTracker` 是模块级的，但它只在**同步**求值期间被换入换出，跨 await 不留驻，所以两个请求的异步片段不会互相看到；
 * - 所有权表与内核内部面是两张 WeakMap，按对象身份查，不按请求身份查。
 */
export class SSRRequestScope {
  readonly runtime: IRuntime
  #registrations = new Map<string, ISSRRegistration>()
  #resources = new Map<string, ISSRResourceRegistration>()
  #pendingHydration = new Map<string, Record<string, unknown>>()
  #pendingResourceHydration = new Map<string, IResourceCacheSnapshot<unknown>>()
  #disposed = false
  /** Async store cleanup jobs started by unregister/dispose and observed until settlement. */
  #pendingDisposals = new Set<Promise<void>>()
  /** Sync and async cleanup failures retained for `disposeAsync()` replay. */
  #disposalErrors: unknown[] = []
  /** Stable completion returned by every `disposeAsync()` call. */
  #disposePromise: Promise<void> | undefined
  // Resolved from dispose(); lets awaitResources() race a genuinely pending
  // resource against "the request disconnected" instead of only noticing
  // dispose *between* rounds, after whatever was already in flight settles.
  #resolveDisposedSignal!: () => void
  #disposedSignal = new Promise<void>((resolve) => {
    this.#resolveDisposedSignal = resolve
  })

  constructor(options: ISSRRequestScopeOptions = {}) {
    assertOptionObject(options)
    let runtime: IRuntime | undefined
    let runtimeOptions: IRuntimeOptions | undefined
    try {
      runtime = options.runtime
      runtimeOptions = options.runtimeOptions
    } catch (error) {
      throw createStoreSsrError(StoreSsrErrorCode.invalidOption, StoreSsrErrorText.optionsObject, {
        cause: error
      })
    }
    if (runtime && runtimeOptions) {
      throw createStoreSsrError(
        StoreSsrErrorCode.invalidOption,
        StoreSsrErrorText.runtimeOptionsExclusive
      )
    }
    this.runtime = runtime ?? createRuntime(runtimeOptions)
    claimOwnership(this, this.runtime)
  }

  get disposed(): boolean {
    return this.#disposed
  }

  register(key: string, store: ISSRStore, options: ISSRRegistrationOptions = {}): void {
    this.#assertActive()
    const owned = readRegistrationOwned(options)
    assertStoreKey(key)
    if (store.$runtime !== this.runtime) {
      throw createStoreSsrError(
        StoreSsrErrorCode.crossRuntime,
        StoreSsrErrorText.differentRuntime('store', key)
      )
    }
    if (this.#registrations.has(key)) {
      throw createStoreSsrError(
        StoreSsrErrorCode.invalidOption,
        StoreSsrErrorText.duplicate('store', key)
      )
    }
    // Hydrate before committing the registration: if $hydrate() throws, a
    // retry must still see the key as free and the pending hydration as
    // still there to try again — not an occupied key with no way back in.
    const hydration = this.#pendingHydration.get(key)
    if (hydration) store.$hydrate(hydration)
    this.#registrations.set(key, {
      store,
      owned,
      order: 1
    })
    if (hydration) this.#pendingHydration.delete(key)
  }

  unregister(key: string, disposeOwned = true): boolean {
    this.#assertActive()
    const registration = this.#registrations.get(key)
    if (!registration) return false
    this.#registrations.delete(key)
    if (disposeOwned && registration.owned) {
      this.#trackDisposal(registration.store.$dispose())
    }
    return true
  }

  /** Remove a registration without disposing it; ownership transfers to the caller. */
  detach(key: string): ISSRStore | undefined {
    this.#assertActive()
    const registration = this.#registrations.get(key)
    if (!registration) return undefined
    this.#registrations.delete(key)
    return registration.store
  }

  registerResource(
    key: string,
    resource: ISSRResource,
    options: ISSRRegistrationOptions = {}
  ): void {
    this.#assertActive()
    const owned = readRegistrationOwned(options)
    assertStoreKey(key)
    if (resource.runtime !== this.runtime) {
      throw createStoreSsrError(
        StoreSsrErrorCode.crossRuntime,
        StoreSsrErrorText.differentRuntime('resource', key)
      )
    }
    if (this.#resources.has(key)) {
      throw createStoreSsrError(
        StoreSsrErrorCode.invalidOption,
        StoreSsrErrorText.duplicate('resource', key)
      )
    }
    // Same ordering as register(): hydrate before committing, so a throw
    // leaves the key free and the pending hydration intact for a retry.
    const hydration = this.#pendingResourceHydration.get(key)
    if (hydration) resource.hydrate(hydration)
    this.#resources.set(key, {
      resource,
      owned,
      order: 0
    })
    if (hydration) this.#pendingResourceHydration.delete(key)
  }

  unregisterResource(key: string, disposeOwned = true): boolean {
    this.#assertActive()
    const registration = this.#resources.get(key)
    if (!registration) return false
    if (disposeOwned && registration.owned) registration.resource.dispose()
    this.#resources.delete(key)
    return true
  }

  detachResource(key: string): ISSRResource | undefined {
    this.#assertActive()
    const registration = this.#resources.get(key)
    if (!registration) return undefined
    this.#resources.delete(key)
    return registration.resource
  }

  /**
   * Best-effort, NOT atomic. `assertSSRState()` already rejected anything that isn't well-formed
   * JSON before this runs, but an individual store's or resource's own `$hydrate()`/`hydrate()` can
   * still throw for reasons outside this method's control (its own validation, a computed
   * constraint, whatever). Doing true all-or-nothing commit across an arbitrary set of stores would
   * need each one to support a stage/commit/ rollback protocol — `ISSRStore`/`ISSRResource` don't
   * have one, and adding one is a real interface change, not a local fix.
   *
   * So instead: every entry is attempted regardless of an earlier one failing (same pattern as
   * `dispose()` below), so "hydrate() threw" always means "every entry that _could_ apply, did —
   * here's what couldn't," never "stopped partway through for reasons that depend on object-key
   * iteration order." Pending-hydration bookkeeping is always updated to reflect what was actually
   * consumed, never left stale from before this call just because something later in the same call
   * failed.
   */
  hydrate(state: ISSRState): void {
    this.#assertActive()
    assertSSRState(state)
    const errors: unknown[] = []
    const pending = new Map<string, Record<string, unknown>>()
    for (const [key, snapshot] of readSnapshotEntries(state.stores, 'stores')) {
      const plain = jsonObjectToUnknownRecord(snapshot as Readonly<Record<string, IJSONValue>>)
      const registration = this.#registrations.get(key)
      if (!registration) {
        pending.set(key, plain)
        continue
      }
      try {
        registration.store.$hydrate(plain)
      } catch (error) {
        errors.push(error)
      }
    }
    this.#pendingHydration = pending
    const pendingResources = new Map<string, IResourceCacheSnapshot<unknown>>()
    for (const [key, snapshot] of readSnapshotEntries(state.resources ?? {}, 'resources')) {
      const hydration: IResourceCacheSnapshot<unknown> = {
        ...(snapshot as IResourceCacheSnapshot<unknown>),
        data: jsonValueToUnknown((snapshot as IResourceCacheSnapshot<IJSONValue>).data)
      }
      const registration = this.#resources.get(key)
      if (!registration) {
        pendingResources.set(key, hydration)
        continue
      }
      try {
        registration.resource.hydrate(hydration)
      } catch (error) {
        errors.push(error)
      }
    }
    this.#pendingResourceHydration = pendingResources
    if (errors.length === 1) throw errors[0]
    if (errors.length > 1) {
      throw createStoreSsrAggregateError(
        StoreSsrErrorCode.hydrateFailed,
        errors,
        StoreSsrErrorText.hydrateFailed
      )
    }
  }

  dehydrate(): ISSRState {
    this.#assertActive()
    const stores: Record<string, Readonly<Record<string, IJSONValue>>> = Object.create(null)
    const resources: Record<string, IResourceCacheSnapshot<IJSONValue>> = Object.create(null)
    for (const key of [...this.#registrations.keys()].sort()) {
      const registration = this.#registrations.get(key)
      if (!registration || registration.store.$disposed) continue
      stores[key] = toJSONObject(registration.store.$plain(), `stores.${key}`)
    }
    for (const key of [...this.#resources.keys()].sort()) {
      const registration = this.#resources.get(key)
      if (!registration || registration.resource.disposed) continue
      const snapshot = registration.resource.dehydrate()
      if (!snapshot) continue
      resources[key] = Object.freeze({
        ...snapshot,
        data: toJSONValue(snapshot.data, `resources.${key}.data`, new WeakSet())
      })
    }
    return Object.freeze({
      version: 1 as const,
      stores: Object.freeze(stores),
      resources: Object.freeze(resources)
    })
  }

  /**
   * Internal fast path — NOT a snapshot. Every value in the returned state (`store.$plain()`'s
   * object, each resource's `dehydrate()` result) is whatever live reference those calls happen to
   * return; this method does not copy, freeze deeply, or validate it. If the store mutates between
   * this call and whenever the caller actually serializes the result (an await, a later tick, a
   * queued write), the payload can change out from under the caller without warning — there is no
   * point-in-time guarantee here the way there is with `dehydrate()`.
   *
   * Only correct when every value is already known-safe, already-JSON,
   * already-immutable-for-the-duration-of-the-call data — e.g. this library's own bundled
   * documentation/demo content, never anything derived from request input or a store that might
   * mutate concurrently. `dehydrate()` is almost certainly the method you want; reach for this one
   * only when the validation/copy cost of `dehydrate()` is the thing you're specifically trying to
   * avoid, and you can actually justify why skipping it is safe here.
   */
  dehydrateTrusted(): ITrustedSSRState {
    this.#assertActive()
    const stores: Record<string, Readonly<Record<string, IJSONValue>>> = {}
    const resources: Record<string, IResourceCacheSnapshot<IJSONValue>> = {}
    for (const key of [...this.#registrations.keys()].sort()) {
      const registration = this.#registrations.get(key)
      if (registration && !registration.store.$disposed) {
        stores[key] = registration.store.$plain() as Readonly<Record<string, IJSONValue>>
      }
    }
    for (const key of [...this.#resources.keys()].sort()) {
      const registration = this.#resources.get(key)
      const snapshot = registration?.resource.dehydrate()
      if (registration && !registration.resource.disposed && snapshot) {
        resources[key] = snapshot as IResourceCacheSnapshot<IJSONValue>
      }
    }
    return Object.freeze({
      version: 1 as const,
      stores: Object.freeze(stores),
      resources: Object.freeze(resources)
    }) as ITrustedSSRState
  }

  /**
   * 等待所有已注册的异步派生，返回失败清单。
   *
   * 之前是一趟 `Promise.all`，两个后果：
   *
   * - 任何一个 resource reject，整个 await 就 reject，页面拿不到**任何** payload——一份可选的预取数据挂掉，把其余全部预取一起赔进去；
   * - 瀑布式的 resource（A resolve 之后才注册 B）根本不在那一趟里， dehydrate 时 B 还没好，SSR 缓存白做。
   *
   * 现在逐轮 settle：每轮只等**这一轮新出现的 promise**，直到不再有新的。 按 promise 身份去重，不按 key——同一个 key 在首次 settle 后又发起
   * retry/refetch 换了一个新 promise，仍然要被等到，而不是因为 key 已经 "见过"就永久跳过。失败不抛出，而是作为清单返回——调用方决定是整页
   * 失败，还是发出去让客户端重取。
   *
   * 三种失败旁路都要收进清单，不能让任何一种绕过 try/catch 直接终止整个 等待：`.promise` getter 同步抛错、真正超时、以及等待期间 scope 被
   * dispose（这一种直接返回已有结果，不算这一轮里剩下 resource 的错）。
   */
  async awaitResources(
    options: IAwaitResourcesOptions = {}
  ): Promise<readonly ISSRResourceFailure[]> {
    this.#assertActive()
    const timeoutMs = assertTimeoutMs(options.timeoutMs)
    const failures: ISSRResourceFailure[] = []
    // 记录每个 key 上一次被等待的 promise 身份；getter 抛错的 key 记一个
    // 哨兵值，避免同一个持续抛错的 key 每轮重复报错。
    const observed = new Map<string, Promise<unknown>>()
    // timeoutMs: 0 是合法值，语义是"立刻过期"——deadline 就是此刻，第一轮
    // 检查 remaining 时几乎必然已经 <= 0，等价于完全不等待任何在途 resource。
    const deadline = timeoutMs === undefined ? undefined : Date.now() + timeoutMs
    const timeoutFailures = (
      pending: ReadonlyArray<readonly [string, Promise<unknown>]>
    ): ISSRResourceFailure[] =>
      pending.map(([key]) => ({
        key,
        error: createStoreSsrError(
          StoreSsrErrorCode.resourceTimeout,
          StoreSsrErrorText.resourceTimeout(key, timeoutMs)
        )
      }))
    // 轮次上限：resource 的完成回调里无限注册新 resource 属于调用方的 bug，
    // 但不能让它把渲染线程永远吊在这里。
    // The counter is inclusive because round zero is the first settled
    // generation: exactly 64 legitimate waterfall rounds must complete before
    // the 65th round is rejected.
    for (let round = 0; round <= MAX_RESOURCE_ROUNDS; round++) {
      if (this.#disposed) return failures
      const pending: Array<[string, Promise<unknown>]> = []
      for (const [key, registration] of this.#resources.entries()) {
        let current: Promise<unknown>
        try {
          current = registration.resource.promise
        } catch (error) {
          if (observed.get(key) === undefined) failures.push({ key, error })
          observed.set(key, Promise.resolve())
          continue
        }
        if (observed.get(key) === current) continue
        observed.set(key, current)
        pending.push([key, current])
      }
      if (pending.length === 0) return failures
      const remaining = deadline === undefined ? undefined : deadline - Date.now()
      if (remaining !== undefined && remaining <= 0) {
        failures.push(...timeoutFailures(pending))
        return failures
      }
      const outcome = await raceOutcome(
        Promise.allSettled(pending.map(([, promise]) => promise)),
        this.#disposedSignal,
        remaining
      )
      if (outcome.kind === SsrWorkOutcome.disposed) return failures
      if (outcome.kind === 'timeout') {
        failures.push(...timeoutFailures(pending))
        return failures
      }
      for (let index = 0; index < outcome.value.length; index++) {
        const result = outcome.value[index]
        if (result.status === 'rejected') {
          failures.push({ key: pending[index][0], error: result.reason })
        }
      }
    }
    throw createStoreSsrError(
      StoreSsrErrorCode.resourceRoundLimit,
      StoreSsrErrorText.resourceRoundLimit(MAX_RESOURCE_ROUNDS)
    )
  }

  /**
   * 预取后取快照。失败的 resource 不进 payload，其余照常。
   *
   * 缺省把失败报给 Runtime 的 onError（phase `ssr-resource`）——静默吞掉会让 「客户端为什么又发了一遍请求」无从查起。给了 onResourceError
   * 就以它为准。
   */
  async dehydrateAsync(options: IDehydrateAsyncOptions = {}): Promise<ISSRState> {
    let onResourceError: IDehydrateAsyncOptions['onResourceError']
    let timeoutMs: number | undefined
    try {
      onResourceError = options.onResourceError
      timeoutMs = options.timeoutMs
    } catch (error) {
      throw createStoreSsrError(StoreSsrErrorCode.invalidOption, StoreSsrErrorText.optionsObject, {
        cause: error
      })
    }
    const failures = await this.awaitResources({
      timeoutMs
    })
    for (const failure of failures) {
      try {
        if (onResourceError) {
          const result = (onResourceError as (value: ISSRResourceFailure) => unknown)(failure)
          if (result && typeof (result as { readonly then?: unknown }).then === 'function') {
            void Promise.resolve(result).catch((error: unknown) => {
              try {
                this.runtime.reportError(error, { phase: ReactiveErrorPhase.ssrResource })
              } catch {
                // Diagnostic sinks are best effort; resource failure remains primary.
              }
            })
          }
        } else this.runtime.reportError(failure.error, { phase: ReactiveErrorPhase.ssrResource })
      } catch (reporterError) {
        // A user reporter is diagnostic-only; it cannot prevent remaining
        // failures from being reported or the payload from being dehydrated.
        try {
          this.runtime.reportError(reporterError, { phase: ReactiveErrorPhase.ssrResource })
        } catch {
          // The runtime sink itself is the final best-effort boundary.
        }
      }
    }
    return this.dehydrate()
  }

  dispose(): void {
    if (this.#disposed) return
    this.#disposed = true
    this.#resolveDisposedSignal()
    // 显式释放顺序（migration.sdd.md §3.1/M-T31）：resource（order 0）先于 store（order 1）——
    // store 逻辑上拥有 resource，必须先摘子资源再释放 store。组内仍按注册逆序（LIFO）。
    const entries = [
      ...[...this.#resources.values()].reverse().map((registration) => ({
        order: registration.order,
        dispose: () => {
          if (registration.owned && !registration.resource.disposed) registration.resource.dispose()
        }
      })),
      ...[...this.#registrations.values()].reverse().map((registration) => ({
        order: registration.order,
        dispose: (): void | PromiseLike<void> => {
          if (registration.owned && !registration.store.$disposed) {
            return registration.store.$dispose()
          }
        }
      }))
    ].sort((a, b) => a.order - b.order)
    this.#registrations.clear()
    this.#resources.clear()
    this.#pendingHydration.clear()
    this.#pendingResourceHydration.clear()
    const errors: unknown[] = []
    for (const entry of entries) {
      try {
        this.#trackDisposal(entry.dispose())
      } catch (error) {
        errors.push(error)
      }
    }
    this.#disposalErrors.push(...errors)
    if (errors.length === 1) throw errors[0]
    if (errors.length > 1) {
      throw createStoreSsrAggregateError(
        StoreSsrErrorCode.scopeDisposalFailed,
        errors,
        StoreSsrErrorText.scopeDisposalFailed
      )
    }
  }

  /**
   * Awaitable teardown boundary for real Store Light instances whose `$dispose()` is asynchronous.
   * Concurrent and repeated callers share the same completion and failure replay.
   */
  disposeAsync(): Promise<void> {
    this.#disposePromise ??= (async () => {
      try {
        this.dispose()
      } catch {
        // Synchronous failures were recorded by dispose() and are replayed below.
      }
      await Promise.all(this.#pendingDisposals)
      if (this.#disposalErrors.length === 1) throw this.#disposalErrors[0]
      if (this.#disposalErrors.length > 1) {
        throw createStoreSsrAggregateError(
          StoreSsrErrorCode.scopeDisposalFailed,
          this.#disposalErrors,
          StoreSsrErrorText.scopeDisposalFailed
        )
      }
    })()
    return this.#disposePromise
  }

  /** Observes a thenable cleanup without allowing a rejection to escape globally. */
  #trackDisposal(result: void | PromiseLike<void>): void {
    if (result === undefined) return
    const tracked = Promise.resolve(result).then(
      () => undefined,
      (error: unknown) => {
        this.#disposalErrors.push(error)
      }
    )
    this.#pendingDisposals.add(tracked)
    void tracked.finally(() => this.#pendingDisposals.delete(tracked))
  }

  #assertActive(): void {
    if (this.#disposed) {
      throw createStoreSsrError(StoreSsrErrorCode.scopeDisposed, StoreSsrErrorText.scopeDisposed)
    }
  }
}

export function createSSRRequestScope(options: ISSRRequestScopeOptions = {}): SSRRequestScope {
  return new SSRRequestScope(options)
}

/** JSON text safe inside an application/json script element and HTML streams. */
export function serializeSSRState(state: ISSRState): string {
  assertSSRState(state)
  return escapeJSONForHTML(JSON.stringify(state))
}

/**
 * Serializes the value produced by `dehydrateTrusted()` — not a snapshot; see that method's doc
 * comment. Call this immediately after `dehydrateTrusted()`, before anything else can mutate the
 * state it references.
 */
export function serializeTrustedSSRState(state: ITrustedSSRState): string {
  return escapeJSONForHTML(JSON.stringify(state))
}

/**
 * \u5185\u8054\u8fdb HTML \u524d\u7684 JSON \u8f6c\u4e49\u3002
 *
 * \u4e00\u6b21\u6b63\u5219\u626b\u63cf\uff0c\u800c\u4e0d\u662f\u4e94\u6b21
 * `replaceAll`\uff1a\u540e\u8005\u8981\u628a\u6574\u4efd\u8f7d\u8377\u5b8c\u6574\u904d\u5386\u4e94\u904d\uff0c\u800c
 * SSR
 * \u8f7d\u8377\u6b63\u662f\u6700\u5927\u7684\u90a3\u4e2a\u5b57\u7b26\u4e32\u3002\u8f6c\u4e49\u7ed3\u679c\u9010\u5b57\u7b26\u7b49\u4ef7\u3002
 */
const HTML_UNSAFE_IN_JSON = /[&<>\u2028\u2029]/g
const HTML_JSON_ESCAPES: Readonly<Record<string, string>> = {
  '&': '\\u0026',
  '<': '\\u003c',
  '>': '\\u003e',
  '\u2028': '\\u2028',
  '\u2029': '\\u2029'
}

function escapeJSONForHTML(json: string): string {
  return json.replace(HTML_UNSAFE_IN_JSON, (character) => HTML_JSON_ESCAPES[character])
}

export function deserializeSSRState(serialized: string): ISSRState {
  const parsed: unknown = JSON.parse(serialized)
  assertSSRState(parsed)
  return parsed
}

export function createSSRStateScript(state: ISSRState, elementId = '__STORE_STATE__'): string {
  if (!SSR_ID_PATTERN.test(elementId)) {
    throw createStoreSsrError(
      StoreSsrErrorCode.invalidStateScript,
      StoreSsrErrorText.invalidScriptId
    )
  }
  return `<script type="application/json" id="${elementId}">${serializeSSRState(state)}</script>`
}

/** Minimal document surface accepted by the runtime-neutral SSR decoder. */
export type ISSRDocument = {
  getElementById(elementId: string): {
    readonly textContent: string | null
    getAttribute(name: string): string | null
  } | null
}

/** Reads an SSR payload from an injected document-like host. */
export function readSSRStateFromDocument(
  elementId = '__STORE_STATE__',
  documentValue?: ISSRDocument
): ISSRState | undefined {
  const text = documentValue?.getElementById(elementId)?.textContent
  return text ? deserializeSSRState(text) : undefined
}

// 首字符允许下划线：默认 id 就是 __STORE_STATE__，只认字母会把默认路径卡死。
// 仍然排除空白与引号，保证内联进属性时不可能闭合标签。
const SSR_ID_PATTERN = /^[A-Za-z_][A-Za-z0-9_:.-]*$/

/**
 * HTML 属性值转义。
 *
 * Codec type 已经在注册表那关被收成 token 了，这里是第二道防线：注册表的规则 未来若被放宽、或有人绕开注册表直接构造，属性也不该能被闭合。
 */
const escapeAttribute = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')

function assertElementId(elementId: string): void {
  if (!SSR_ID_PATTERN.test(elementId)) {
    throw createStoreSsrError(
      StoreSsrErrorCode.invalidStateScript,
      StoreSsrErrorText.invalidScriptId
    )
  }
}

export type ISSRScriptOptions = {
  readonly codecs: ISerializeRegistry
  readonly elementId?: string
  readonly signal?: AbortSignal
}

/**
 * Same as createSSRStateScript but routed through a serialize registry, so the payload format is
 * the caller's choice.
 *
 * 内联进 HTML 的转义是**传输层**要求，与格式无关，但转义手法不能一刀切： `<` 这类转义只在 JSON 语法内有效，套到 YAML 或二进制上就是破坏数据。 所以只有 json
 * 走那条便宜的转义；其余格式一律 base64——base64 字母表里根本 不含 `<` `>` `&` 与行分隔符，天然可安全内联，代价是体积涨三分之一。
 */
export async function createSSRStateScriptWith(
  state: ISSRState,
  options: ISSRScriptOptions
): Promise<string> {
  assertOptionObject(options)
  const { codecs, elementId = '__STORE_STATE__', signal } = options
  assertElementId(elementId)
  assertSSRState(state)

  const type = codecs.primaryType
  const chunk = await codecs.encode(state, {
    signal,
    context: `ssr:${elementId}`
  })
  if (chunk[0] === SerializeChunkKind.value) {
    throw createStoreSsrTypeError(
      StoreSsrErrorCode.codecContract,
      StoreSsrErrorText.codecOutput(type)
    )
  }

  if (type === SsrWireType.json && chunk[0] === SsrWireType.text) {
    const escaped = escapeJSONForHTML(chunk[1])
    return `<script type="application/json" id="${escapeAttribute(elementId)}" data-codec="json" data-wire="text">${escaped}</script>`
  }

  const payload =
    chunk[0] === SsrWireType.bytes
      ? bytesToBase64(chunk[1])
      : bytesToBase64(new TextEncoder().encode(chunk[1]))
  // 非 JSON 的载荷一律用非可执行的 mime，避免浏览器把它当脚本对待
  return `<script type="text/plain" id="${escapeAttribute(elementId)}" data-codec="${escapeAttribute(type)}" data-wire="b64">${payload}</script>`
}

export type ISSRReadOptions = {
  readonly codecs: ISerializeRegistry
  readonly elementId?: string
  readonly document?: ISSRDocument
  readonly signal?: AbortSignal
}

/** Reads a codec-tagged SSR payload from an injected document-like host. */
export async function readSSRStateFromDocumentWith(
  options: ISSRReadOptions
): Promise<ISSRState | undefined> {
  assertOptionObject(options)
  const { codecs, elementId = '__STORE_STATE__', document: documentValue, signal } = options
  const element = documentValue?.getElementById(elementId)
  const text = element?.textContent
  if (!text) return undefined

  const type = element.getAttribute('data-codec') ?? 'json'
  const wire = element.getAttribute('data-wire') ?? 'text'
  if (!codecs.has(type)) {
    throw createStoreSsrError(StoreSsrErrorCode.codecContract, StoreSsrErrorText.codecMissing(type))
  }
  const chunk: ISerializeChunk =
    wire === 'b64' ? [SsrWireType.bytes, base64ToBytes(text)] : [SsrWireType.text, text]
  const decoded = await codecs.decode(chunk, {
    type,
    signal,
    context: `ssr:${elementId}`
  })
  assertSSRState(decoded)
  return decoded
}

function assertStoreKey(key: string): void {
  if (typeof key !== 'string' || key.length === 0 || key === '__proto__') {
    throw createStoreSsrError(StoreSsrErrorCode.invalidStoreKey, StoreSsrErrorText.invalidStoreKey)
  }
}

/** Reads enumerable snapshot fields while preserving hostile getter failures as tagged errors. */
function readSnapshotEntries(value: object, path: string): [string, unknown][] {
  try {
    return Object.entries(value)
  } catch (error) {
    throw createStoreSsrError(
      StoreSsrErrorCode.invalidSnapshot,
      StoreSsrErrorText.propertyAccess(path),
      { cause: error }
    )
  }
}

export function assertSSRState(value: unknown): asserts value is ISSRState {
  if (!isPlainObject(value) || value.version !== 1) {
    throw createStoreSsrError(
      StoreSsrErrorCode.invalidStateScript,
      StoreSsrErrorText.invalidStateVersion
    )
  }
  if (!isPlainObject(value.stores)) {
    throw createStoreSsrError(
      StoreSsrErrorCode.invalidSnapshot,
      StoreSsrErrorText.invalidStoresSnapshot
    )
  }
  for (const [key, store] of readSnapshotEntries(value.stores, 'stores')) {
    assertStoreKey(key)
    assertJSONObject(store, `stores.${key}`)
  }
  if (value.resources !== undefined) {
    if (!isPlainObject(value.resources)) {
      throw createStoreSsrError(
        StoreSsrErrorCode.invalidSnapshot,
        StoreSsrErrorText.invalidResourcesSnapshot
      )
    }
    for (const [key, snapshot] of readSnapshotEntries(value.resources, 'resources')) {
      assertStoreKey(key)
      if (
        !isPlainObject(snapshot) ||
        snapshot.version !== 1 ||
        typeof snapshot.updatedAt !== 'number' ||
        !Number.isFinite(snapshot.updatedAt) ||
        (snapshot.expiresAt !== null &&
          (typeof snapshot.expiresAt !== 'number' || !Number.isFinite(snapshot.expiresAt)))
      ) {
        throw createStoreSsrError(
          StoreSsrErrorCode.invalidSnapshot,
          StoreSsrErrorText.invalidResourceSnapshot(key)
        )
      }
      assertJSONValue(snapshot.data, `resources.${key}.data`, new WeakSet())
    }
  }
}

/**
 * 校验专用的遍历。
 *
 * 之前这里直接借用 `toJSONObject`：它一边校验一边深拷贝并冻结整棵树，而校验路径 只需要「合不合法」这一个布尔——拷出来的那棵树当场就被丢掉。载荷越大浪费越大， 10k
 * 会话的量级上，纯校验 2.1ms、拷贝加冻结 5.7ms。
 *
 * 错误信息与路径与拷贝版逐条对齐：两者的判定顺序必须一致，否则同一份非法载荷在 dehydrate 与 serialize 两条路上会报出不同的原因。
 */
function assertJSONObject(value: unknown, path: string): void {
  if (!isPlainObject(value)) {
    throw createStoreSsrTypeError(
      StoreSsrErrorCode.serializeUnsupported,
      StoreSsrErrorText.plainObject(path)
    )
  }
  assertJSONValue(value, path, new WeakSet<object>())
}

type IJSONWalker<T> = {
  primitive(value: IJSONPrimitive): T
  array(values: readonly T[]): T
  object(entries: readonly (readonly [string, T])[]): T
}

function walkJSONValue<T>(
  value: unknown,
  path: string,
  seen: WeakSet<object>,
  walker: IJSONWalker<T>,
  depth = 0,
  state: { nodes: number } = { nodes: 0 }
): T {
  if (++state.nodes > MAX_JSON_NODES) {
    throw createStoreSsrTypeError(
      StoreSsrErrorCode.serializeUnsupported,
      StoreSsrErrorText.nodeLimit(path)
    )
  }
  if (depth > MAX_JSON_DEPTH) {
    throw createStoreSsrTypeError(
      StoreSsrErrorCode.serializeUnsupported,
      StoreSsrErrorText.depthLimit(path)
    )
  }
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return walker.primitive(value)
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw createStoreSsrTypeError(
        StoreSsrErrorCode.serializeUnsupported,
        StoreSsrErrorText.nonFinite(path)
      )
    }
    return walker.primitive(value)
  }
  if (typeof value !== 'object') {
    throw createStoreSsrTypeError(
      StoreSsrErrorCode.serializeUnsupported,
      StoreSsrErrorText.notSerializable(path)
    )
  }
  if (seen.has(value)) {
    throw createStoreSsrTypeError(
      StoreSsrErrorCode.serializeUnsupported,
      StoreSsrErrorText.cycle(path)
    )
  }
  seen.add(value)
  try {
    if (Array.isArray(value)) {
      const entries = value.map((entry, index) =>
        walkJSONValue(entry, `${path}[${index}]`, seen, walker, depth + 1, state)
      )
      return walker.array(entries)
    }
    if (!isPlainObject(value)) {
      throw createStoreSsrTypeError(
        StoreSsrErrorCode.serializeUnsupported,
        StoreSsrErrorText.nonPlain(path)
      )
    }
    const entries = readSnapshotEntries(value, path).map(
      ([key, entry]) =>
        [key, walkJSONValue(entry, `${path}.${key}`, seen, walker, depth + 1, state)] as const
    )
    return walker.object(entries)
  } finally {
    seen.delete(value)
  }
}

function assertJSONValue(
  value: unknown,
  path: string,
  seen: WeakSet<object>,
  depth = 0,
  state: { nodes: number } = { nodes: 0 }
): void {
  walkJSONValue(
    value,
    path,
    seen,
    {
      primitive: () => undefined,
      array: () => undefined,
      object: () => undefined
    },
    depth,
    state
  )
}

function toJSONObject(value: unknown, path: string): Readonly<Record<string, IJSONValue>> {
  if (!isPlainObject(value)) {
    throw createStoreSsrTypeError(
      StoreSsrErrorCode.serializeUnsupported,
      StoreSsrErrorText.plainObject(path)
    )
  }
  const seen = new WeakSet<object>()
  return toJSONValue(value, path, seen) as Readonly<Record<string, IJSONValue>>
}

function toJSONValue(
  value: unknown,
  path: string,
  seen: WeakSet<object>,
  depth = 0,
  state: { nodes: number } = { nodes: 0 }
): IJSONValue {
  return walkJSONValue<IJSONValue>(
    value,
    path,
    seen,
    {
      primitive: (entry) => entry,
      array: (entries) => Object.freeze([...entries]),
      object: (entries) => {
        // 字面量而不是 Object.create(null)：无原型对象在 V8 里走字典模式，同一份
        // 载荷 JSON.stringify 要慢近一倍，而这棵树的唯一用途就是被序列化。
        // `__proto__` 这个键仍不能直接赋值（那会改原型），单独走 defineProperty。
        const result: Record<string, IJSONValue> = {}
        for (const [key, converted] of entries) {
          if (key === '__proto__') {
            Object.defineProperty(result, key, {
              value: converted,
              enumerable: true,
              writable: true,
              configurable: true
            })
          } else {
            result[key] = converted
          }
        }
        return Object.freeze(result)
      }
    },
    depth,
    state
  )
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function jsonObjectToUnknownRecord(
  value: Readonly<Record<string, IJSONValue>>
): Record<string, unknown> {
  const result: Record<string, unknown> = Object.create(null)
  for (const [key, entry] of readSnapshotEntries(value, 'snapshot')) result[key] = entry
  return result
}

function jsonValueToUnknown(value: IJSONValue): unknown {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(jsonValueToUnknown)
  const result: Record<string, unknown> = Object.create(null)
  for (const [key, entry] of readSnapshotEntries(value, 'value')) {
    result[key] = jsonValueToUnknown(entry as IJSONValue)
  }
  return result
}
