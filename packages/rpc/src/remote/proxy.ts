import { SupervisorState, type ISupervisor } from '@migaia/supervision'
import {
  runtimeConnectionDetail,
  runtimeDetail,
  runtimeErrorIdentity,
  runtimeCounters,
  runtimeUnavailable,
  type IRuntimeDetail,
  type IRuntimeConnectionDirectory,
  type IRuntimeRecent,
  type IRuntimeUnavailable
} from './runtime-api/overview.js'
import { runtimeResources, type IRuntimeNativeUnit } from './runtime-api/resources.js'
import {
  RuntimeQueryStatus,
  RuntimeRecentKind,
  RuntimeQueryClock,
  RuntimeQueryLimit,
  RuntimeQueryReason
} from './runtime-api/constants.js'
import type { IAbortSignal } from '@migaia/lifecycle'
import { attachErrorIdentity } from '@migaia/utils/error'
import { normalizePortable } from '../contract/normalize.js'
import { isForwardedPayload, retainForwardOptions } from '../core/internal/outbound-envelope.js'
import type { IRpcPortableValue } from '../contract/types.js'
import type { IRuntimePeer, IRuntimePeerSourceResult } from './runtime-api/peer.js'
import { readRuntimePeerConnection } from './runtime-api/peer.js'
import { RuntimeApiErrorText, RuntimeApiMode } from './runtime-api/constants.js'
import { RpcCoreErrorText } from '../core/error-text.js'
import { createProviderGenerationRetired } from '../core/internal/provider.js'
import { RpcAbortError, RpcCoreErrorCode, RpcError, RpcRemoteError } from '../core/errors.js'
import { nativeReplayReceipt } from '../core/internal/native-replay.js'
import { resolveAbortReason } from '../core/internal/async-control.js'
import { assertRpcIdempotencyKey, defaultRpcId } from '../core/internal/id.js'
import { RemoteMethodName } from './constants.js'
import {
  normalizeRemoteContract,
  normalizeRemoteControlShape,
  normalizeRemoteHostCatalog,
  RemoteMethodMode,
  type IRemoteContract,
  type IRemoteControlDefinition,
  type IRemoteHostCatalog,
  type IRemoteMethodContract
} from './contract.js'
import { normalizeRuntimeDescription } from './runtime-api/description.js'
import { describeRemoteMethods } from './serve-methods.js'
import { ERROR_SOURCE, RpcRemoteLayerErrorCode } from './error-code.js'
import { createRemoteLayerError } from './error.js'
import { RpcRemoteLayerErrorText } from './error-text.js'
import { createRemoteRetryPort, dispatchRemoteRetry } from './retry.js'
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
  runtime?: IRuntimePeer
  /** Only the original current receipt retains its exact native unit for local cold sampling. */
  unit: unknown
  close(): Promise<void>
}>

/** Internal owner used by Plugin, Host, and Coroutine without a second proxy implementation. */
export type IRemoteRegistration = Readonly<{
  readonly contract: IRemoteContract | IRemoteHostCatalog
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
  invokeControl(
    method: string,
    params: unknown,
    parameterShape: IRemoteControlDefinition,
    resultShape: IRemoteControlDefinition
  ): Promise<IRpcPortableValue>
  featureProxies(
    pluginName?: string
  ): Readonly<Record<string, Readonly<Record<string, (...args: unknown[]) => unknown>>>>
  revoke(reason: unknown): void
  whenClosed(generation: number): Promise<void>
  departedReasonCount(): number
  release(): Promise<void>
}>

/** The same generation owner accepts a negotiated runtime directory without a synthetic v1 contract. */
export type IRemoteRuntimeRegistration = Pick<
  IRemoteRegistration,
  'events' | 'prepareGeneration' | 'whenClosed' | 'release' | 'revoke' | 'departedReasonCount'
> &
  Readonly<{
    /** Exact native execution authority is present only for the original spawn/create factory path. */
    /** Identity reads keep late exit facts bound to their exact original native generation. */
    /** Cold target selection reads only the retained safe directory, without native sampling. */
    runtimeInstanceIds(): readonly string[]
    runtimeInstanceId(generation: number): string | IRuntimeUnavailable
    readonly execution: ISupervisor<unknown, unknown> | undefined
    /** Passive lifecycle observers read the same original supervisor, including local connections. */
    readonly supervisor: ISupervisor<unknown, unknown>
    currentPeer(): IRuntimePeer
    /** Read original native state and bounded safe lifecycle history without preparing a generation. */
    inspectRuntime(): Promise<IRuntimeDetail>
    /** Logical runtime calls reuse the original retry/key/deadline dispatch below. */
    invokeRequest(
      method: string,
      payload: unknown,
      options?: IRemoteCallOptions,
      mode?: RuntimeApiMode
    ): Promise<IRpcPortableValue>
    /** Forward streams retain the original generation and iterator lifecycle without replay. */
    invokeStream(
      method: string,
      payload: unknown,
      options?: IRemoteCallOptions
    ): AsyncIterableIterator<IRpcPortableValue>
    /** Observe only a genuinely prepared canonical generation, after current pointer publication. */
    onReady(listener: (peer: IRuntimePeer, generation: number) => void): () => void
  }>

/** Runtime preparation stays inside the original binding/channel/generation rollback boundary. */
export type IRemoteRuntimeRegistrationOptions<TUnit, TSpec> = Omit<
  IRemoteProxyOptions<TUnit, TSpec>,
  'contract' | 'endpointFactory'
> &
  Readonly<{
    /** Private native factory provenance; local connection ownership cannot set execution authority. */
    ownsExecution?: boolean
    prepareRuntime(channel: IRemoteChannel, signal: IAbortSignal): Promise<IRuntimePeer>
    readRuntimeEndpoint(peer: IRuntimePeer): IRemoteServeEndpoint
    /** Original native drain completes before this registration disposes its current endpoint. */
    beforeRelease?(): Promise<void>
  }>

/** Only the package factories construct this union; v1 contract validation remains mandatory there. */
type IRemoteRegistrationOptions<TUnit, TSpec> = Omit<
  IRemoteProxyOptions<TUnit, TSpec>,
  'contract' | 'endpointFactory'
> &
  Readonly<{
    ownsExecution?: boolean
    contract?: IRemoteContract | IRemoteHostCatalog
    endpointFactory?: IRemoteProxyOptions<TUnit, TSpec>['endpointFactory']
    prepareRuntime?: IRemoteRuntimeRegistrationOptions<TUnit, TSpec>['prepareRuntime']
    readRuntimeEndpoint?: IRemoteRuntimeRegistrationOptions<TUnit, TSpec>['readRuntimeEndpoint']
    beforeRelease?: IRemoteRuntimeRegistrationOptions<TUnit, TSpec>['beforeRelease']
  }>

/** One setup-scoped resource owner also accepts replacement generation resources. */
export type IRemoteGenerationHolder<
  TRegistration extends IRemoteRegistration | IRemoteRuntimeRegistration = IRemoteRegistration
> = Readonly<{
  readonly registration: TRegistration
  prepareInitial(signal: IAbortSignal, rollbackOnFailure?: boolean): Promise<number>
  prepareRebind(signal: IAbortSignal): Promise<number>
  retainedResourceCount(): number
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

/** Keeps native AggregateError identity while assigning a registered remote code. */
function codedAggregate(
  errors: readonly unknown[],
  code: 'REMOTE_START_FAILED' | 'REMOTE_CLOSED'
): AggregateError {
  const aggregate = new AggregateError(errors)
  attachErrorIdentity(aggregate, { source: ERROR_SOURCE, code })
  return aggregate
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
class RemoteRegistration<TUnit, TSpec> {
  /** Validated method description, independent of a live connection. */
  readonly contract: IRemoteContract | IRemoteHostCatalog | undefined
  /** Host mode validates one catalog over one shared generation. */
  readonly #catalog: IRemoteHostCatalog | undefined
  /** Generation observations consumed by retry and Host readiness. */
  readonly events: IRemoteGenerationEvents
  /** The current binding and its single scheduler. */
  readonly #options: IRemoteRegistrationOptions<TUnit, TSpec>
  /** An explicit port replaces the shared default for this registration. */
  readonly #retryPort: IRemoteRetryPort
  /** Most recent described and active generation. */
  #current: IRemoteGeneration | undefined
  /** Last admitted safe directory survives retirement without retaining channel or native resources. */
  #runtimeDirectory: IRuntimeConnectionDirectory | undefined
  /**
   * The original leave owner records at most 100 safe lifecycle observations, never business
   * errors.
   */
  readonly #runtimeRecent: IRuntimeRecent[] = []
  /** Departures retain their original reason for late listeners. */
  readonly #departed = new Map<number, unknown>()
  /** Active generation closures remain observable until their cleanup settles. */
  readonly #closing = new Map<number, Promise<void>>()
  /** Leave subscribers are notified before endpoint disposal. */
  readonly #leaveListeners = new Map<number, Set<(reason: unknown) => void>>()
  /** Waiters are resolved only after description and pointer switch. */
  readonly #readyWaiters = new Set<IReadyWaiter>()
  /** Runtime publications observe the same prepared pointer; no adapter readiness state is copied. */
  readonly #runtimeReadyListeners = new Set<(peer: IRuntimePeer, generation: number) => void>()
  /** Supervisor subscription is owned by the registration. */
  readonly #unsubscribe: () => void
  /** Release remains idempotent and returns the same Promise. */
  #releasePromise: Promise<void> | undefined
  /** Once release starts, later leave subscriptions observe the closed registration. */
  #releaseReason: unknown

  /** Validates local options before any launcher side effect. */
  constructor(options: IRemoteRegistrationOptions<TUnit, TSpec>, kind: 'plugin' | 'host') {
    this.#options = options
    this.#catalog =
      !options.prepareRuntime && kind === 'host'
        ? normalizeRemoteHostCatalog(options.contract)
        : undefined
    this.contract = options.prepareRuntime
      ? undefined
      : (this.#catalog ?? normalizeRemoteContract(options.contract))
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
        if (this.#releaseReason !== undefined || this.#departed.has(generation)) {
          /** Capture before release clears historical reasons. */
          const reason = this.#releaseReason ?? this.#departed.get(generation)
          queueMicrotask(() => {
            try {
              listener(reason)
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
          if (listeners.size === 0) this.#leaveListeners.delete(generation)
        }
      },
      whenReady: (afterGeneration: number, signal?: IAbortSignal) =>
        this.#whenReady(afterGeneration, signal)
    })
    this.#retryPort =
      options.retryPort ??
      createRemoteRetryPort({
        events: this.events,
        scheduler: options.binding.scheduler,
        report: options.report
      })
    this.#unsubscribe = options.binding.supervisor.subscribe((event) => {
      if (event.type === 'exit') this.#leave(event.generation, event.error)
      if (
        event.type === 'state' &&
        (event.to === SupervisorState.stopped || event.to === SupervisorState.disposed)
      ) {
        const generation = this.#current?.number
        if (generation !== undefined) this.#leave(generation, undefined)
      }
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
    if (this.#releaseReason !== undefined || this.#releasePromise)
      return Promise.reject(
        this.#releaseReason ?? createRemoteLayerError(RpcRemoteLayerErrorCode.closed)
      )
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
    const current = this.#current?.number === generation ? this.#current : undefined
    if (this.#options.prepareRuntime) {
      /**
       * Capture safe identity before disposing the exact current endpoint; never label a candidate
       * with an old identity.
       */
      const identity = current?.runtime
        ? readRuntimePeerConnection(current.runtime).description?.self
        : undefined
      this.#runtimeRecent.push(
        Object.freeze({
          generation,
          timestamp: this.#options.binding.scheduler.now(),
          clock: RuntimeQueryClock.scheduler,
          kind: RuntimeRecentKind.departed,
          ...(identity ? { identity } : {}),
          ...runtimeErrorIdentity(reason, this.#options.report)
        })
      )
      if (this.#runtimeRecent.length > RuntimeQueryLimit.recent) this.#runtimeRecent.shift()
    }
    if (current) this.#current = undefined
    for (const listener of this.#leaveListeners.get(generation) ?? []) {
      try {
        listener(reason)
      } catch (error) {
        this.#options.report(error)
      }
    }
    this.#leaveListeners.delete(generation)
    if (current) {
      const closing = current.close()
      this.#closing.set(generation, closing)
      void closing
        .catch((error: unknown) => this.#options.report(error))
        .then(() => {
          this.#closing.delete(generation)
        })
    }
  }

  /** Rejects an unavailable preparation before a newly acquired resource is published. */
  #assertPreparing(signal: IAbortSignal, generation: number): void {
    if (signal.aborted) throw resolveAbortReason(signal)
    if (this.#releasePromise) throw createRemoteLayerError(RpcRemoteLayerErrorCode.closed)
    if (this.#departed.has(generation))
      throw createRemoteLayerError(RpcRemoteLayerErrorCode.closed, this.#departed.get(generation), {
        generation
      })
  }

  /** Cleanup errors are reported without replacing the preparation failure. */
  async #closeFailedCandidate(disposers: readonly (() => Promise<void>)[]): Promise<void> {
    for (const dispose of disposers) {
      try {
        await dispose()
      } catch (error) {
        this.#options.report(error)
      }
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
        /** A capacity refusal is an original supervisor outcome, with no thrown error to retain. */
        snapshot.terminalError ?? snapshot.lastExit?.error ?? outcome,
        { state: outcome.state }
      )
    }
    this.#assertPreparing(signal, outcome.generation)
    let channel: IRemoteChannel
    try {
      channel = await this.#options.binding.openChannel(outcome.unit, signal)
    } catch (cause) {
      throw createRemoteLayerError(RpcRemoteLayerErrorCode.startFailed, cause)
    }
    /** The channel is owned before any later validation or endpoint construction can fail. */
    let channelClose: Promise<void> | undefined
    const closeChannel = (): Promise<void> => (channelClose ??= channel.close())
    try {
      this.#assertPreparing(signal, outcome.generation)
    } catch (error) {
      await this.#closeFailedCandidate([closeChannel])
      throw error
    }
    own(closeChannel)
    if (channel.scheduler !== this.#options.binding.scheduler)
      throw new RpcError(RpcCoreErrorCode.invalidConfig, RpcCoreErrorText.schedulerInvalid)
    const contracts = this.#options.prepareRuntime
      ? []
      : this.#catalog
        ? Object.values(this.#catalog)
        : [this.contract as IRemoteContract]
    const hasStream = contracts.some((contract) =>
      Object.values(contract.features).some((feature) =>
        Object.values(feature.methods).some(
          (method) =>
            method.mode === RemoteMethodMode.generator ||
            method.mode === RemoteMethodMode.asyncGenerator
        )
      )
    )
    if (hasStream && !channel.agreement.capabilities.includes('stream@1'))
      throw new RpcError(
        RpcCoreErrorCode.capabilityConflict,
        RpcRemoteLayerErrorText.streamUnavailable
      )
    /**
     * Local physical closure must revoke the generation before endpoint sends reject. A peer error
     * code alone is not departure evidence; only this transport's closed state is.
     */
    const removeTransportError = channel.transport.onTransportError?.((reason) => {
      if (channel.transport.closed === true) this.#leave(outcome.generation, reason)
    })
    if (removeTransportError) own(async () => removeTransportError())
    if (this.#options.prepareRuntime) {
      /** Native L can retire during a core checkpoint before the adapter's exit event arrives. */
      const removeRetirement = nativeReplayReceipt(channel.transport)?.onRetire(() =>
        this.#leave(outcome.generation, new RpcAbortError())
      )
      if (removeRetirement) own(async () => removeRetirement())
    }
    /** Runtime directory preparation and v1 describe share the same exact departure/resource owner. */
    const runtime = this.#options.prepareRuntime
      ? await this.#options.prepareRuntime(channel, signal)
      : undefined
    /** Endpoint is registered before the first describe frame. */
    let endpointClose: Promise<void> | undefined
    const closeEndpoint = (): Promise<void> =>
      (endpointClose ??= runtime ? runtime.close() : served.endpoint.dispose())
    if (runtime) own(closeEndpoint)
    /** Binding validation can itself fail, so acquired runtime cleanup is already retained above. */
    const served = runtime
      ? this.#options.readRuntimeEndpoint!(runtime)
      : await this.#options.endpointFactory!(channel, signal)
    try {
      this.#assertPreparing(signal, outcome.generation)
    } catch (error) {
      await this.#closeFailedCandidate([closeEndpoint, closeChannel])
      throw error
    }
    own(closeEndpoint)
    if (hasStream && !served.stream)
      throw new RpcError(
        RpcCoreErrorCode.capabilityConflict,
        RpcRemoteLayerErrorText.streamUnavailable
      )
    if (!runtime) {
      /** Legacy facade assembly now publishes v2 routes before releasing the same native reader. */
      ;(channel as IRuntimePeerSourceResult).activateReceive?.()
      const description = await served.endpoint.send(
        channel.peerId,
        RemoteMethodName.runtimeDescribe,
        [],
        {
          signal
        }
      )
      /**
       * Local advanced declarations select facade methods; the remote v2 whitelist is
       * authoritative.
       */
      const remote = normalizeRuntimeDescription(description)
      const expected = describeRemoteMethods(contracts, remote.self, this.#catalog !== undefined)
      const names = new Set(contracts.map((contract) => contract.plugin))
      const selected = remote.methods.filter(
        (method) =>
          names.has(method.name.split('.')[0]!) ||
          (this.#catalog !== undefined &&
            [
              RemoteMethodName.hostUse,
              RemoteMethodName.hostUnUse,
              RemoteMethodName.hostInspect
            ].includes(method.name as never))
      )
      if (
        remote.self.instanceId !== channel.peerId ||
        selected.length !== expected.methods.length ||
        expected.methods.some((method) => {
          const actual = selected.find((candidate) => candidate.name === method.name)
          return (
            !actual ||
            actual.supportedModes.length !== method.supportedModes.length ||
            actual.supportedModes.some((mode) => !method.supportedModes.includes(mode)) ||
            (actual.idempotent ?? false) !== (method.idempotent ?? false)
          )
        })
      )
        throw createRemoteLayerError(RpcRemoteLayerErrorCode.contractInvalid)
    }
    /** Close endpoint before channel regardless of who owns the registration. */
    const generation: IRemoteGeneration = Object.freeze({
      number: outcome.generation,
      unit: outcome.unit,
      channel,
      served,
      ...(runtime ? { runtime } : {}),
      close: async () => {
        await closeEndpoint()
        await closeChannel()
      }
    })
    try {
      this.#assertPreparing(signal, generation.number)
    } catch (error) {
      await this.#closeFailedCandidate([closeEndpoint, closeChannel])
      throw error
    }
    this.#current = generation
    if (runtime) this.#runtimeDirectory = readRuntimePeerConnection(runtime).directory
    if (runtime)
      for (const listener of this.#runtimeReadyListeners) {
        try {
          listener(runtime, generation.number)
        } catch (error) {
          this.#options.report(error)
        }
      }
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

  /** The original accepted directory keeps target identity while its owned unit is not ready. */
  runtimeInstanceIds(): readonly string[] {
    return this.#runtimeDirectory?.description
      ? [this.#runtimeDirectory.description.self.instanceId]
      : []
  }

  /** Current receipt and original bounded departures identify one exact native generation. */
  runtimeInstanceId(generation: number): string | IRuntimeUnavailable {
    if (this.#current?.number === generation && this.#runtimeDirectory?.description)
      return this.#runtimeDirectory.description.self.instanceId
    for (let index = this.#runtimeRecent.length - 1; index >= 0; index -= 1) {
      const recent = this.#runtimeRecent[index]!
      if (recent.generation === generation && recent.identity) return recent.identity.instanceId
    }
    return runtimeUnavailable(RuntimeQueryReason.owner)
  }

  /** Native commands use the exact original supervisor, never a channel ownership flag. */
  get execution(): ISupervisor<unknown, unknown> | undefined {
    return this.#options.ownsExecution ? this.supervisor : undefined
  }

  /** Passive event subscription shares the canonical generation and teardown owner. */
  get supervisor(): ISupervisor<unknown, unknown> {
    return this.#options.binding.supervisor as ISupervisor<unknown, unknown>
  }

  /** Return only the current original generation, never a cached same-name successor handle. */
  currentPeer(): IRuntimePeer {
    const active = this.#active()
    if (!active.runtime) throw createRemoteLayerError(RpcRemoteLayerErrorCode.closed)
    return active.runtime
  }

  /** Query the same canonical supervisor and accepted directory even between generations. */
  async inspectRuntime(): Promise<IRuntimeDetail> {
    if (!this.#runtimeDirectory) throw createRemoteLayerError(RpcRemoteLayerErrorCode.closed)
    /** Capture one exact receipt and supervisor snapshot before any asynchronous resource read. */
    const current = this.#current
    /** Safe directory identity remains the selected generation even when that generation exits. */
    const directory = this.#runtimeDirectory
    /** Canonical unit and health facts are read without preparing or restarting a generation. */
    const supervisor = this.#options.binding.supervisor.inspect()
    /** Counters read only the actual current endpoint's original registries. */
    const counters = current ? runtimeCounters(current.served.endpoint) : undefined
    /** Snapshot history before waiting; query does not promise an atomic cross-owner view. */
    const recent = [...this.#runtimeRecent]
    /** The same receipt retains the exact native handle; missing ports are explicit absence. */
    const sampled = current
      ? await runtimeResources(
          current.unit as IRuntimeNativeUnit,
          supervisor.kind,
          () => this.#options.binding.scheduler.now(),
          this.#options.report
        )
      : runtimeUnavailable(RuntimeQueryReason.resources)
    /** Never resample a successor after exit or replacement during the asynchronous read. */
    const resources =
      current && this.#current !== current
        ? runtimeUnavailable(RuntimeQueryReason.retired)
        : sampled
    return runtimeDetail(
      directory.localDescription,
      [
        runtimeConnectionDetail(
          directory,
          current ? RuntimeQueryStatus.ready : RuntimeQueryStatus.departed,
          {
            supervisor,
            recent,
            counters,
            resources,
            observedAt: this.#options.binding.scheduler.now(),
            report: this.#options.report
          }
        )
      ],
      recent,
      undefined,
      counters
    )
  }

  /** Subscribe to actual prepared replacements without launching or querying a second lifecycle. */
  onReady(listener: (peer: IRuntimePeer, generation: number) => void): () => void {
    this.#runtimeReadyListeners.add(listener)
    return () => {
      this.#runtimeReadyListeners.delete(listener)
    }
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
    options: IRemoteCallOptions = {},
    mode: RuntimeApiMode = RuntimeApiMode.request
  ): Promise<IRpcPortableValue> {
    /** Direct runtime admission keeps its existing synchronous failure boundary. */
    const runtime = this.#options.prepareRuntime !== undefined
    /** The portable runtime payload is normalized once before dispatch allocates any work. */
    const forwarded = isForwardedPayload(options, params)
    const runtimeData =
      runtime && params !== undefined
        ? forwarded
          ? (params as IRpcPortableValue)
          : normalizePortable(params)
        : undefined
    /** The original accepted route index supplies the declaration without a directory query. */
    const runtimeDeclaration = runtime ? this.#runtimeMethod(method, mode) : undefined
    try {
      const data = runtime ? runtimeData : this.#params(params)
      /** Runtime routes share the accepted cold index, while frozen v1 retains its original lookup. */
      const declaration = runtime ? runtimeDeclaration : this.#method(method)
      if (declaration && 'mode' in declaration && declaration.mode !== RemoteMethodMode.request)
        throw createRemoteLayerError(RpcRemoteLayerErrorCode.contractInvalid)
      this.#callOptions(options, true)
      const observedGeneration =
        this.#current?.number ?? this.#options.binding.supervisor.generation
      this.#options.callGuard?.beforeDispatch({
        method,
        mode: mode === RuntimeApiMode.notify ? RemoteMethodMode.oneWay : RemoteMethodMode.request,
        generation: observedGeneration
      })
      const active = this.#active()
      /** Explicit caller key takes precedence and suppresses factory invocation. */
      const key =
        options.idempotencyKey ??
        (declaration?.idempotent ? (this.#options.keyFactory?.() ?? defaultRpcId()) : undefined)
      if (key !== undefined) assertRpcIdempotencyKey(key)
      const timeoutMs = this.#timeout(options.timeoutMs)
      const deadlineAt =
        timeoutMs === undefined ? undefined : this.#options.binding.scheduler.now() + timeoutMs
      /** Retry ports see the same event source and a sendOnce bound to the logical key. */
      const dispatch = {
        method,
        mode: 'request' as const,
        idempotent: declaration?.idempotent ?? false,
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
            .send<IRpcPortableValue>(
              live.channel.peerId,
              method,
              data,
              retainForwardOptions(options, {
                ...(options.signal ? { signal: options.signal } : {}),
                ...(input.remainingMs === undefined
                  ? timeoutMs === undefined
                    ? {}
                    : { timeoutMs }
                  : { timeoutMs: input.remainingMs }),
                ...(key === undefined ? {} : { idempotencyKey: key })
              })
            )
            .catch(restoreTaggedProviderFailure)
        }
      }
      /**
       * Forwarded work belongs to this admitted execution; a retired generation is never
       * re-entered.
       */
      return forwarded
        ? dispatchRemoteRetry(
            {
              events: this.events,
              scheduler: this.#options.binding.scheduler,
              report: this.#options.report
            },
            retainForwardOptions(options, dispatch)
          )
        : this.#retryPort.dispatch(dispatch)
    } catch (error) {
      return Promise.reject(error)
    }
  }

  /** Admit the logical business mode from the same precompiled index used by direct Peer calls. */
  #runtimeMethod(method: string, mode: RuntimeApiMode) {
    const connection = readRuntimePeerConnection(this.currentPeer())
    if (!connection.description) return undefined
    const declaration = connection.routes.get(method)
    if (!declaration)
      throw new RpcError(RpcCoreErrorCode.providerNotFound, RuntimeApiErrorText.methodUnavailable)
    if (!declaration.supportedModes.includes(mode))
      throw new RpcError(
        RpcCoreErrorCode.capabilityUnsupported,
        RpcCoreErrorText.capabilityUnsupported
      )
    return declaration
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

  /** Sends one validated Host control request through the same generation and guard gate. */
  invokeControl(
    method: string,
    params: unknown,
    parameterShape: IRemoteControlDefinition,
    resultShape: IRemoteControlDefinition
  ): Promise<IRpcPortableValue> {
    try {
      if (!this.#catalog) throw createRemoteLayerError(RpcRemoteLayerErrorCode.contractInvalid)
      const data = normalizeRemoteControlShape(parameterShape, params)
      if (!Array.isArray(data))
        throw createRemoteLayerError(RpcRemoteLayerErrorCode.contractInvalid)
      if (method !== RemoteMethodName.hostInspect && !this.#catalog[data[0] as string])
        throw createRemoteLayerError(RpcRemoteLayerErrorCode.contractInvalid)
      this.#options.callGuard?.beforeDispatch({
        method,
        mode: 'host-control',
        generation: this.#current?.number ?? this.#options.binding.supervisor.generation
      })
      const active = this.#active()
      return active.served.endpoint
        .send<IRpcPortableValue>(active.channel.peerId, method, data)
        .catch(restoreTaggedProviderFailure)
        .then((result) => normalizeRemoteControlShape(resultShape, result))
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
    /** Runtime forwarding joins the existing generation owner without another iterator registry. */
    const runtime = this.#options.prepareRuntime !== undefined
    const forwarded = isForwardedPayload(options, params)
    const data = runtime
      ? forwarded
        ? (params as IRpcPortableValue)
        : normalizePortable(params)
      : this.#params(params)
    const declaration = runtime
      ? this.#runtimeMethod(method, RuntimeApiMode.stream)
      : this.#method(method)
    if (
      !runtime &&
      declaration &&
      'mode' in declaration &&
      declaration.mode !== RemoteMethodMode.generator &&
      declaration.mode !== RemoteMethodMode.asyncGenerator
    )
      throw createRemoteLayerError(RpcRemoteLayerErrorCode.contractInvalid)
    this.#callOptions(options, false)
    const observedGeneration = this.#current?.number ?? this.#options.binding.supervisor.generation
    this.#options.callGuard?.beforeDispatch({
      method,
      mode: runtime ? RemoteMethodMode.asyncGenerator : (declaration as IRemoteMethodContract).mode,
      generation: observedGeneration
    })
    const active = this.#active()
    if (!active.served.stream)
      throw new RpcError(
        RpcCoreErrorCode.capabilityConflict,
        RpcRemoteLayerErrorText.streamUnavailable
      )
    /** Departure is published by the original owner before its endpoint terminates this iterator. */
    let retired: Error | undefined
    /** Only forwarding observes retirement; ordinary streams retain their original error policy. */
    const unsubscribe = forwarded
      ? this.events.onLeave(active.number, (reason) => {
          retired = createProviderGenerationRetired(reason)
        })
      : undefined
    try {
      /** Internal options keep the exact admitted payload and signed route through this owner. */
      const callOptions = retainForwardOptions(options, {
        ...(options.signal ? { signal: options.signal } : {}),
        ...(this.#timeout(options.timeoutMs) === undefined
          ? {}
          : { timeoutMs: this.#timeout(options.timeoutMs) })
      })
      yield* runtime
        ? active.runtime!.stream(method, data, callOptions)
        : active.served.stream.open(
            active.channel.peerId,
            `${RemoteMethodName.runtimeStreamPrefix}${method}`,
            data,
            callOptions
          )
    } catch (error) {
      throw retired ?? error
    } finally {
      unsubscribe?.()
    }
  }

  /** Finds only methods present in the validated description. */
  #method(fullName: string): IRemoteMethodContract {
    const [plugin, feature, method, extra] = fullName.split('.')
    const contract = this.#catalog?.[plugin!] ?? (this.contract as IRemoteContract)
    const declaration =
      extra === undefined && plugin === contract.plugin
        ? contract.features[feature!]?.methods[method!]
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
  featureProxies(
    pluginName?: string
  ): Readonly<Record<string, Readonly<Record<string, (...args: unknown[]) => unknown>>>> {
    /** Stable proxy surface persists across generation switches. */
    const features: Record<
      string,
      Readonly<Record<string, (...args: unknown[]) => unknown>>
    > = Object.create(null) as Record<
      string,
      Readonly<Record<string, (...args: unknown[]) => unknown>>
    >
    const contract = this.#catalog
      ? this.#catalog[pluginName ?? '']
      : (this.contract as IRemoteContract)
    if (!contract) throw createRemoteLayerError(RpcRemoteLayerErrorCode.contractInvalid)
    for (const [featureName, feature] of Object.entries(contract.features)) {
      const methods: Record<string, (...args: unknown[]) => unknown> = Object.create(
        null
      ) as Record<string, (...args: unknown[]) => unknown>
      for (const [methodName, declaration] of Object.entries(feature.methods)) {
        const fullName = `${contract.plugin}.${featureName}.${methodName}`
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

  /** Waits for one departed generation's resource closure, if it is still active. */
  whenClosed(generation: number): Promise<void> {
    return (
      this.#closing.get(generation)?.then(
        () => undefined,
        () => undefined
      ) ?? Promise.resolve()
    )
  }

  /** Exposes internal reason retention for the generation lifecycle oracle. */
  departedReasonCount(): number {
    return this.#departed.size
  }

  /** Releases owned resources once and rejects pending readiness observers. */
  release(): Promise<void> {
    if (this.#releasePromise) return this.#releasePromise
    this.#unsubscribe()
    const error = createRemoteLayerError(RpcRemoteLayerErrorCode.closed)
    this.#releaseReason = error
    this.#rejectWaiters(error)
    /**
     * Legacy release keeps immediate retirement; native runtime drain retains the original
     * endpoint.
     */
    const retire = (): Promise<void> | undefined => {
      const current = this.#current
      if (current) this.#leave(current.number, error)
      return current ? this.#closing.get(current.number) : undefined
    }
    /**
     * Release admission is already closed, while an existing native drain may still use its
     * endpoint.
     */
    const currentClose = this.#options.beforeRelease ? undefined : retire()
    this.#releasePromise = (async () => {
      /** Drain failure cannot prevent native exit or replace its original cause during cleanup. */
      const failures: unknown[] = []
      try {
        if (this.#options.beforeRelease) {
          try {
            // This cold boundary publishes the exact release Promise before drain callbacks run.
            await Promise.resolve().then(() => this.#options.beforeRelease!())
          } catch (failure) {
            failures.push(failure)
          }
        }
        /** The sole generation owner still retires and disposes once, after its native drain. */
        const closing = this.#options.beforeRelease ? retire() : currentClose
        try {
          if (closing) await closing
        } catch (failure) {
          if (!this.#options.beforeRelease) throw failure
          failures.push(failure)
        }
        if (this.#options.binding.ownership === 'owned') {
          try {
            await this.#options.binding.supervisor.dispose()
          } catch (failure) {
            if (!this.#options.beforeRelease) throw failure
            failures.push(failure)
          }
        }
      } finally {
        await Promise.allSettled(this.#closing.values())
        this.#departed.clear()
        this.#leaveListeners.clear()
        this.#runtimeReadyListeners.clear()
      }
      if (failures.length === 1) throw failures[0]
      if (failures.length > 1) throw codedAggregate(failures, RpcRemoteLayerErrorCode.closed)
    })()
    return this.#releasePromise
  }
}

/** Creates the single proxy owner shared by all runtime launchers. */
export function createRemoteRegistration<TUnit, TSpec>(
  options: IRemoteProxyOptions<TUnit, TSpec>,
  kind: 'plugin' | 'host' = 'plugin'
): IRemoteRegistration {
  // The v1 constructor branch always validates and retains its required contract.
  return new RemoteRegistration(options, kind) as IRemoteRegistration
}

/** Runtime facades reuse the original supervisor, leave ordering, waiters and resource holder. */
export function createRemoteRuntimeRegistration<TUnit, TSpec>(
  options: IRemoteRuntimeRegistrationOptions<TUnit, TSpec>
): IRemoteRuntimeRegistration {
  return new RemoteRegistration(options, 'plugin')
}

/** Owns generation resources once across setup, replacement, and final removal. */
export function createRemoteGenerationHolder<
  TRegistration extends IRemoteRegistration | IRemoteRuntimeRegistration
>(
  registration: TRegistration,
  report: (error: unknown) => void
): IRemoteGenerationHolder<TRegistration> {
  /** A departed generation drops its resource group instead of growing a lifetime stack. */
  const retained = new Set<Set<() => Promise<void>>>()
  /** Final removal shares one settlement with repeated PluginHost cleanup. */
  let releasePromise: Promise<void> | undefined
  /** Closes one group's disposers in reverse acquisition order. */
  const closeGroup = async (group: Set<() => Promise<void>>): Promise<unknown[]> => {
    const failures: unknown[] = []
    for (const dispose of [...group].reverse()) {
      try {
        await dispose()
      } catch (error) {
        failures.push(error)
      }
    }
    group.clear()
    retained.delete(group)
    return failures
  }
  /** Rolls back a failed candidate without replacing its primary error. */
  const rollback = async (group: Set<() => Promise<void>>, primary: unknown): Promise<boolean> => {
    const failures = await closeGroup(group)
    if (failures.length > 0)
      report(codedAggregate([primary, ...failures], RpcRemoteLayerErrorCode.startFailed))
    return failures.length > 0
  }
  /** One preparation owns a new group and releases it when its generation leaves. */
  const prepare = async (
    signal: IAbortSignal,
    cleanupOnFailure: boolean,
    reportFailure: boolean
  ): Promise<number> => {
    const group = new Set<() => Promise<void>>()
    retained.add(group)
    try {
      const generation = await registration.prepareGeneration(signal, (dispose) => {
        group.add(dispose)
      })
      registration.events.onLeave(generation, () => {
        void registration.whenClosed(generation).then(() => {
          group.clear()
          retained.delete(group)
        })
      })
      return generation
    } catch (error) {
      if (cleanupOnFailure || releasePromise) {
        const hadCleanupFailure = await rollback(group, error)
        if (reportFailure && !hadCleanupFailure) report(error)
      }
      throw error
    }
  }
  return {
    registration,
    prepareInitial: (signal, rollbackOnFailure = false) =>
      prepare(signal, rollbackOnFailure, false),
    prepareRebind: (signal) => prepare(signal, true, true),
    retainedResourceCount: () => [...retained].reduce((count, group) => count + group.size, 0),
    release: () => {
      if (releasePromise) return releasePromise
      releasePromise = (async () => {
        const failures: unknown[] = []
        try {
          await registration.release()
        } catch (error) {
          failures.push(error)
        }
        for (const group of retained) failures.push(...(await closeGroup(group)))
        if (failures.length > 0) throw codedAggregate(failures, RpcRemoteLayerErrorCode.closed)
      })()
      return releasePromise
    }
  }
}
