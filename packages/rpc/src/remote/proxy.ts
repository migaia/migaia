import type { IAbortSignal } from '@migaia/lifecycle'
import { normalizePortable } from '../contract/normalize.js'
import type { IRpcPortableValue } from '../contract/types.js'
import { RpcCoreErrorText } from '../core/error-text.js'
import { RpcCoreErrorCode, RpcError, RpcRemoteError } from '../core/errors.js'
import { resolveAbortReason } from '../core/internal/async-control.js'
import { assertRpcIdempotencyKey, defaultRpcId } from '../core/internal/id.js'
import { RemoteMethodName } from './constants.js'
import {
  normalizeRemoteContract,
  RemoteMethodMode,
  sameRemoteContract,
  type IRemoteContract,
  type IRemoteMethodContract
} from './contract.js'
import { RpcRemoteLayerErrorCode } from './error-code.js'
import { createRemoteLayerError } from './error.js'
import { RpcRemoteLayerErrorText } from './error-text.js'
import type {
  IRemoteCallOptions,
  IRemoteChannel,
  IRemoteGenerationEvents,
  IRemoteProxyOptions,
  IRemoteRetryPort,
  IRemoteServeEndpoint
} from './types.js'

/** A successfully described generation and its owned channel resources. */
type IRemoteGeneration = Readonly<{
  number: number
  channel: IRemoteChannel
  served: IRemoteServeEndpoint
  close(): Promise<void>
}>

/** Internal owner used by Plugin, Host, and Coroutine without a second proxy implementation. */
export type IRemoteRegistration = Readonly<{
  readonly contract: IRemoteContract
  readonly events: IRemoteGenerationEvents
  prepareGeneration(
    signal: IAbortSignal,
    own: (dispose: () => Promise<void>) => void
  ): Promise<number>
  invokeRequest(
    method: string,
    params: unknown,
    options?: IRemoteCallOptions
  ): Promise<IRpcPortableValue>
  invokeOneWay(method: string, params: unknown): Promise<void>
  invokeStream(
    method: string,
    params: unknown,
    options?: IRemoteCallOptions
  ): AsyncIterableIterator<IRpcPortableValue>
  featureProxies(): Readonly<
    Record<string, Readonly<Record<string, (...args: unknown[]) => unknown>>>
  >
  revoke(reason: unknown): void
  release(): Promise<void>
}>

/** One setup-scoped resource owner also accepts replacement generation resources. */
export type IRemoteGenerationHolder = Readonly<{
  readonly registration: IRemoteRegistration
  prepareInitial(signal: IAbortSignal): Promise<number>
  prepareRebind(signal: IAbortSignal): Promise<number>
  release(): Promise<void>
}>

/** A waiting caller only needs the next described generation number. */
type IReadyWaiter = {
  after: number
  resolve(value: number): void
  reject(error: unknown): void
  signal?: IAbortSignal
  abort?: () => void
}

/** Preserve a wire-restored tagged provider failure instead of core's generic remote wrapper. */
function restoreTaggedProviderFailure(error: unknown): never {
  if (error instanceof RpcRemoteError && error.cause instanceof Error) {
    const restored = error.cause as Error & { readonly source?: unknown; readonly code?: unknown }
    if (typeof restored.source === 'string' && typeof restored.code === 'string') throw restored
  }
  throw error
}

/** One generation holder owns leave ordering and the retry port's neutral events. */
class RemoteRegistration<TUnit, TSpec> implements IRemoteRegistration {
  /** Validated method description, independent of a live connection. */
  readonly contract: IRemoteContract
  /** Generation observations consumed by retry and Host readiness. */
  readonly events: IRemoteGenerationEvents
  /** The current binding and its single scheduler. */
  readonly #options: IRemoteProxyOptions<TUnit, TSpec>
  /** Most recent described and active generation. */
  #current: IRemoteGeneration | undefined
  /** Departures retain their original reason for late listeners. */
  readonly #departed = new Map<number, unknown>()
  /** Leave subscribers are notified before endpoint disposal. */
  readonly #leaveListeners = new Map<number, Set<(reason: unknown) => void>>()
  /** Waiters are resolved only after description and pointer switch. */
  readonly #readyWaiters = new Set<IReadyWaiter>()
  /** Supervisor subscription is owned by the registration. */
  readonly #unsubscribe: () => void
  /** Release remains idempotent and returns the same Promise. */
  #releasePromise: Promise<void> | undefined

  /** Validates local options before any launcher side effect. */
  constructor(options: IRemoteProxyOptions<TUnit, TSpec>) {
    this.#options = options
    this.contract = normalizeRemoteContract(options.contract)
    if (
      options.callDeadlineCapMs !== undefined &&
      (!Number.isSafeInteger(options.callDeadlineCapMs) || options.callDeadlineCapMs <= 0)
    )
      throw new RpcError(RpcCoreErrorCode.invalidConfig, RpcCoreErrorText.timeoutInvalid)
    this.events = Object.freeze({
      current: () => ({
        generation: this.#current?.number ?? this.#options.binding.supervisor.generation,
        active: this.#current !== undefined
      }),
      onLeave: (generation: number, listener: (reason: unknown) => void) => {
        if (this.#departed.has(generation)) {
          queueMicrotask(() => {
            try {
              listener(this.#departed.get(generation))
            } catch (error) {
              this.#options.report(error)
            }
          })
          return () => undefined
        }
        /** Per-generation listeners do not receive another generation's event. */
        const listeners =
          this.#leaveListeners.get(generation) ?? new Set<(reason: unknown) => void>()
        listeners.add(listener)
        this.#leaveListeners.set(generation, listeners)
        return () => {
          listeners.delete(listener)
        }
      },
      whenReady: (afterGeneration: number, signal?: IAbortSignal) =>
        this.#whenReady(afterGeneration, signal)
    })
    this.#unsubscribe = options.binding.supervisor.subscribe((event) => {
      if (event.type === 'exit') this.#leave(event.generation, event.error)
      if (event.type === 'switched') this.#leave(event.from, undefined)
      if (event.type === 'terminal') {
        const generation = this.#current?.number
        if (generation !== undefined) this.#leave(generation, event.error)
        this.#rejectWaiters(
          createRemoteLayerError(RpcRemoteLayerErrorCode.startFailed, event.error, {
            state: 'terminal'
          })
        )
      }
    })
  }

  /** Waits for one later generation, canceling exactly one listener on abort. */
  #whenReady(after: number, signal?: IAbortSignal): Promise<number> {
    if (this.#releasePromise)
      return Promise.reject(createRemoteLayerError(RpcRemoteLayerErrorCode.closed))
    if (this.#current && this.#current.number > after) return Promise.resolve(this.#current.number)
    return new Promise<number>((resolve, reject) => {
      /** Removed at resolution, rejection, or signal abort. */
      const waiter: IReadyWaiter = { after, resolve, reject, signal }
      if (signal) {
        waiter.abort = () => {
          this.#readyWaiters.delete(waiter)
          signal.removeEventListener('abort', waiter.abort!)
          reject(resolveAbortReason(signal))
        }
        if (signal.aborted) {
          waiter.abort()
          return
        }
        signal.addEventListener('abort', waiter.abort, { once: true })
      }
      this.#readyWaiters.add(waiter)
    })
  }

  /** Clears one waiter and its abort subscription. */
  #settleWaiter(waiter: IReadyWaiter, result: number | unknown, success: boolean): void {
    this.#readyWaiters.delete(waiter)
    if (waiter.abort && waiter.signal) waiter.signal.removeEventListener('abort', waiter.abort)
    if (success) waiter.resolve(result as number)
    else waiter.reject(result)
  }

  /** Rejects all pending readiness observations on terminal or release. */
  #rejectWaiters(error: unknown): void {
    for (const waiter of this.#readyWaiters) this.#settleWaiter(waiter, error, false)
  }

  /** Synchronously revokes the current generation before closing its endpoint. */
  #leave(generation: number, reason: unknown): void {
    if (this.#departed.has(generation)) return
    this.#departed.set(generation, reason)
    if (this.#current?.number === generation) {
      const current = this.#current
      this.#current = undefined
      for (const listener of this.#leaveListeners.get(generation) ?? []) {
        try {
          listener(reason)
        } catch (error) {
          this.#options.report(error)
        }
      }
      this.#leaveListeners.delete(generation)
      void current.close().catch((error: unknown) => this.#options.report(error))
    }
  }

  /** Same preparation path is called by first setup and later rebinding. */
  async prepareGeneration(
    signal: IAbortSignal,
    own: (dispose: () => Promise<void>) => void
  ): Promise<number> {
    if (this.#releasePromise) throw createRemoteLayerError(RpcRemoteLayerErrorCode.closed)
    const supervisor = this.#options.binding.supervisor
    const outcome =
      supervisor.state === 'idle' ? await supervisor.start() : await supervisor.whenReady(signal)
    if (signal.aborted) throw resolveAbortReason(signal)
    if (this.#releasePromise) throw createRemoteLayerError(RpcRemoteLayerErrorCode.closed)
    if (outcome.state !== 'ready') {
      const snapshot = supervisor.inspect()
      throw createRemoteLayerError(
        RpcRemoteLayerErrorCode.startFailed,
        snapshot.terminalError ?? snapshot.lastExit?.error,
        { state: outcome.state }
      )
    }
    let channel: IRemoteChannel
    try {
      channel = await this.#options.binding.openChannel(outcome.unit, signal)
    } catch (cause) {
      throw createRemoteLayerError(RpcRemoteLayerErrorCode.startFailed, cause)
    }
    /** The channel is owned before any later validation or endpoint construction can fail. */
    let channelClose: Promise<void> | undefined
    const closeChannel = (): Promise<void> => (channelClose ??= channel.close())
    own(closeChannel)
    if (channel.scheduler !== this.#options.binding.scheduler)
      throw new RpcError(RpcCoreErrorCode.invalidConfig, RpcCoreErrorText.schedulerInvalid)
    const hasStream = Object.values(this.contract.features).some((feature) =>
      Object.values(feature.methods).some(
        (method) =>
          method.mode === RemoteMethodMode.generator ||
          method.mode === RemoteMethodMode.asyncGenerator
      )
    )
    if (hasStream && !channel.agreement.capabilities.includes('stream@1'))
      throw new RpcError(
        RpcCoreErrorCode.capabilityConflict,
        RpcRemoteLayerErrorText.streamUnavailable
      )
    const served = await this.#options.endpointFactory(channel, signal)
    /** Endpoint is registered before the first describe frame. */
    let endpointClose: Promise<void> | undefined
    const closeEndpoint = (): Promise<void> => (endpointClose ??= served.endpoint.dispose())
    own(closeEndpoint)
    if (hasStream && !served.stream)
      throw new RpcError(
        RpcCoreErrorCode.capabilityConflict,
        RpcRemoteLayerErrorText.streamUnavailable
      )
    const description = normalizeRemoteContract(
      await served.endpoint.send(channel.peerId, RemoteMethodName.describe, [])
    )
    if (!sameRemoteContract(this.contract, description))
      throw createRemoteLayerError(RpcRemoteLayerErrorCode.contractInvalid)
    if (signal.aborted) throw resolveAbortReason(signal)
    if (this.#releasePromise) throw createRemoteLayerError(RpcRemoteLayerErrorCode.closed)
    /** Close endpoint before channel regardless of who owns the registration. */
    const generation: IRemoteGeneration = Object.freeze({
      number: outcome.generation,
      channel,
      served,
      close: async () => {
        await closeEndpoint()
        await closeChannel()
      }
    })
    this.#current = generation
    for (const waiter of this.#readyWaiters)
      if (generation.number > waiter.after) this.#settleWaiter(waiter, generation.number, true)
    return generation.number
  }

  /** A closed registration retains the departing generation and reason. */
  #active(): IRemoteGeneration {
    if (this.#current) return this.#current
    const generation = this.#options.binding.supervisor.generation
    throw createRemoteLayerError(RpcRemoteLayerErrorCode.closed, this.#departed.get(generation), {
      generation
    })
  }

  /** Portable method arguments are checked before guard, retry, or frame emission. */
  #params(value: unknown): readonly IRpcPortableValue[] {
    /** Contract-level normalization errors are remapped to the application contract owner. */
    let portable: IRpcPortableValue
    try {
      portable = normalizePortable(value)
    } catch (cause) {
      throw createRemoteLayerError(RpcRemoteLayerErrorCode.contractInvalid, cause)
    }
    if (!Array.isArray(portable))
      throw createRemoteLayerError(RpcRemoteLayerErrorCode.contractInvalid)
    return portable as readonly IRpcPortableValue[]
  }

  /** Rejects control data that is not part of a declared request or stream call. */
  #callOptions(options: unknown, allowKey: boolean): asserts options is IRemoteCallOptions {
    if (options === null || typeof options !== 'object' || Array.isArray(options))
      throw createRemoteLayerError(RpcRemoteLayerErrorCode.contractInvalid)
    for (const key of Object.keys(options))
      if (key !== 'signal' && key !== 'timeoutMs' && !(allowKey && key === 'idempotencyKey'))
        throw createRemoteLayerError(RpcRemoteLayerErrorCode.contractInvalid, undefined, {
          path: `$.options.${key}`
        })
    const call = options as IRemoteCallOptions
    if (call.timeoutMs !== undefined && (!Number.isFinite(call.timeoutMs) || call.timeoutMs < 0))
      throw new RpcError(RpcCoreErrorCode.invalidConfig, RpcCoreErrorText.timeoutInvalid)
  }

  /** Shared request path preserves the core send error object and logical key. */
  invokeRequest(
    method: string,
    params: unknown,
    options: IRemoteCallOptions = {}
  ): Promise<IRpcPortableValue> {
    try {
      const data = this.#params(params)
      const declaration = this.#method(method)
      if (declaration.mode !== RemoteMethodMode.request)
        throw createRemoteLayerError(RpcRemoteLayerErrorCode.contractInvalid)
      this.#callOptions(options, true)
      const observedGeneration =
        this.#current?.number ?? this.#options.binding.supervisor.generation
      this.#options.callGuard?.beforeDispatch({
        method,
        mode: declaration.mode,
        generation: observedGeneration
      })
      const active = this.#active()
      /** Explicit caller key takes precedence and suppresses factory invocation. */
      const key =
        options.idempotencyKey ??
        (declaration.idempotent ? (this.#options.keyFactory?.() ?? defaultRpcId()) : undefined)
      if (key !== undefined) assertRpcIdempotencyKey(key)
      const timeoutMs = this.#timeout(options.timeoutMs)
      const deadlineAt =
        timeoutMs === undefined ? undefined : this.#options.binding.scheduler.now() + timeoutMs
      /** Retry ports see the same event source and a sendOnce bound to the logical key. */
      const dispatch = {
        method,
        mode: 'request' as const,
        idempotent: declaration.idempotent,
        key,
        generation: active.number,
        signal: options.signal,
        timeoutMs,
        deadlineAt,
        events: this.events,
        sendOnce: async (
          input: Readonly<{ expectedGeneration: number; remainingMs?: number; key?: string }>
        ) => {
          if (input.key !== key)
            throw new RpcError(
              RpcCoreErrorCode.invalidConfig,
              RpcCoreErrorText.idempotencyKeyInvalid
            )
          if (
            input.remainingMs !== undefined &&
            (!Number.isFinite(input.remainingMs) || input.remainingMs <= 0)
          )
            throw new RpcError(RpcCoreErrorCode.invalidConfig, RpcCoreErrorText.timeoutInvalid)
          const live = this.#active()
          if (live.number !== input.expectedGeneration)
            throw createRemoteLayerError(
              RpcRemoteLayerErrorCode.closed,
              this.#departed.get(input.expectedGeneration),
              { generation: input.expectedGeneration }
            )
          return live.served.endpoint
            .send<IRpcPortableValue>(live.channel.peerId, method, data, {
              ...(options.signal ? { signal: options.signal } : {}),
              ...(input.remainingMs === undefined
                ? timeoutMs === undefined
                  ? {}
                  : { timeoutMs }
                : { timeoutMs: input.remainingMs }),
              ...(key === undefined ? {} : { idempotencyKey: key })
            })
            .catch(restoreTaggedProviderFailure)
        }
      }
      const port: IRemoteRetryPort | undefined = this.#options.retryPort
      return port
        ? port.dispatch(dispatch)
        : dispatch.sendOnce({ expectedGeneration: active.number, key })
    } catch (error) {
      return Promise.reject(error)
    }
  }

  /** One-way only settles local sending and has no invocation control options. */
  invokeOneWay(method: string, params: unknown): Promise<void> {
    try {
      const data = this.#params(params)
      const declaration = this.#method(method)
      if (declaration.mode !== RemoteMethodMode.oneWay)
        throw createRemoteLayerError(RpcRemoteLayerErrorCode.contractInvalid)
      const observedGeneration =
        this.#current?.number ?? this.#options.binding.supervisor.generation
      this.#options.callGuard?.beforeDispatch({
        method,
        mode: declaration.mode,
        generation: observedGeneration
      })
      const active = this.#active()
      if (!active.served.oneWay)
        throw new RpcError(
          RpcCoreErrorCode.capabilityConflict,
          RpcRemoteLayerErrorText.oneWayUnavailable
        )
      return active.served.oneWay.sendOneWay(active.channel.peerId, method, data)
    } catch (error) {
      return Promise.reject(error)
    }
  }

  /** Stream opening remains lazy so guard errors reach the first next call. */
  async *invokeStream(
    method: string,
    params: unknown,
    options: IRemoteCallOptions = {}
  ): AsyncIterableIterator<IRpcPortableValue> {
    const data = this.#params(params)
    const declaration = this.#method(method)
    if (
      declaration.mode !== RemoteMethodMode.generator &&
      declaration.mode !== RemoteMethodMode.asyncGenerator
    )
      throw createRemoteLayerError(RpcRemoteLayerErrorCode.contractInvalid)
    this.#callOptions(options, false)
    const observedGeneration = this.#current?.number ?? this.#options.binding.supervisor.generation
    this.#options.callGuard?.beforeDispatch({
      method,
      mode: declaration.mode,
      generation: observedGeneration
    })
    const active = this.#active()
    if (!active.served.stream)
      throw new RpcError(
        RpcCoreErrorCode.capabilityConflict,
        RpcRemoteLayerErrorText.streamUnavailable
      )
    yield* active.served.stream.open(active.channel.peerId, method, data, {
      ...(options.signal ? { signal: options.signal } : {}),
      ...(this.#timeout(options.timeoutMs) === undefined
        ? {}
        : { timeoutMs: this.#timeout(options.timeoutMs) })
    })
  }

  /** Finds only methods present in the validated description. */
  #method(fullName: string): IRemoteMethodContract {
    const [plugin, feature, method, extra] = fullName.split('.')
    const declaration =
      extra === undefined && plugin === this.contract.plugin
        ? this.contract.features[feature!]?.methods[method!]
        : undefined
    if (!declaration) throw createRemoteLayerError(RpcRemoteLayerErrorCode.contractInvalid)
    return declaration
  }

  /** Applies one registration cap at the logical-call entry. */
  #timeout(requested?: number): number | undefined {
    if (requested !== undefined && (!Number.isFinite(requested) || requested < 0))
      throw new RpcError(RpcCoreErrorCode.invalidConfig, RpcCoreErrorText.timeoutInvalid)
    const cap = this.#options.callDeadlineCapMs
    return cap === undefined ? requested : requested === undefined ? cap : Math.min(cap, requested)
  }

  /** Feature methods are projected from the contract, never enumerated from a peer object. */
  featureProxies(): Readonly<
    Record<string, Readonly<Record<string, (...args: unknown[]) => unknown>>>
  > {
    /** Stable proxy surface persists across generation switches. */
    const features: Record<
      string,
      Readonly<Record<string, (...args: unknown[]) => unknown>>
    > = Object.create(null) as Record<
      string,
      Readonly<Record<string, (...args: unknown[]) => unknown>>
    >
    for (const [featureName, feature] of Object.entries(this.contract.features)) {
      const methods: Record<string, (...args: unknown[]) => unknown> = Object.create(
        null
      ) as Record<string, (...args: unknown[]) => unknown>
      for (const [methodName, declaration] of Object.entries(feature.methods)) {
        const fullName = `${this.contract.plugin}.${featureName}.${methodName}`
        methods[methodName] = (...args: unknown[]) => {
          const params = args[0]
          const options = args[1] as IRemoteCallOptions | undefined
          if (declaration.mode === RemoteMethodMode.request)
            return this.invokeRequest(fullName, params, options)
          if (declaration.mode === RemoteMethodMode.oneWay) {
            if (args.length > 1)
              return Promise.reject(createRemoteLayerError(RpcRemoteLayerErrorCode.contractInvalid))
            return this.invokeOneWay(fullName, params)
          }
          return this.invokeStream(fullName, params, options)
        }
      }
      features[featureName] = Object.freeze(methods)
    }
    return Object.freeze(features)
  }

  /** Revokes a prepared generation when its external PluginHost enable step fails. */
  revoke(reason: unknown): void {
    const generation = this.#current?.number
    if (generation !== undefined) this.#leave(generation, reason)
  }

  /** Releases owned resources once and rejects pending readiness observers. */
  release(): Promise<void> {
    if (this.#releasePromise) return this.#releasePromise
    this.#unsubscribe()
    const error = createRemoteLayerError(RpcRemoteLayerErrorCode.closed)
    this.#rejectWaiters(error)
    const current = this.#current
    if (current) this.#leave(current.number, error)
    this.#releasePromise = (async () => {
      if (current) await current.close()
      if (this.#options.binding.ownership === 'owned')
        await this.#options.binding.supervisor.dispose()
    })()
    return this.#releasePromise
  }
}

/** Creates the single proxy owner shared by all runtime launchers. */
export function createRemoteRegistration<TUnit, TSpec>(
  options: IRemoteProxyOptions<TUnit, TSpec>
): IRemoteRegistration {
  return new RemoteRegistration(options)
}

/** Owns generation resources once across setup, replacement, and final removal. */
export function createRemoteGenerationHolder(
  registration: IRemoteRegistration,
  report: (error: unknown) => void
): IRemoteGenerationHolder {
  /** Every disposer is added immediately after its resource is created. */
  const resources: (() => Promise<void>)[] = []
  /** Final removal shares one settlement with repeated PluginHost cleanup. */
  let releasePromise: Promise<void> | undefined
  const own = (dispose: () => Promise<void>): void => {
    resources.push(dispose)
  }
  /** Runs only disposers created during an unsuccessful rebind. */
  const rollback = async (from: number, primary: unknown): Promise<boolean> => {
    const failures: unknown[] = []
    for (const dispose of resources.splice(from).reverse()) {
      try {
        await dispose()
      } catch (error) {
        failures.push(error)
      }
    }
    if (failures.length > 0) report(new AggregateError([primary, ...failures]))
    return failures.length > 0
  }
  return {
    registration,
    prepareInitial: (signal) => registration.prepareGeneration(signal, own),
    prepareRebind: async (signal) => {
      const from = resources.length
      try {
        return await registration.prepareGeneration(signal, own)
      } catch (error) {
        const hadCleanupFailure = await rollback(from, error)
        if (!hadCleanupFailure) report(error)
        throw error
      }
    },
    release: () => {
      if (releasePromise) return releasePromise
      releasePromise = (async () => {
        const failures: unknown[] = []
        try {
          await registration.release()
        } catch (error) {
          failures.push(error)
        }
        for (const dispose of resources.splice(0).reverse()) {
          try {
            await dispose()
          } catch (error) {
            failures.push(error)
          }
        }
        if (failures.length > 0) throw new AggregateError(failures)
      })()
      return releasePromise
    }
  }
}
