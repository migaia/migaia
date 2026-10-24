import { deferTask } from '@migaia/utils/scheduler'
import type { IAbortSignal, INativeAbortSignal } from '@migaia/utils/promise'
import { createRpcAbortError, createRpcError, isRpcRemoteError } from '../core/errors.js'
import { createRuntimeBindingCalls } from './internal/runtime-call.js'
import type { IRuntimeCallOptions } from './runtime-api/typing.js'
import { SupervisorState, type IReadyOutcome, type ISupervisor } from '@migaia/supervision'
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
  RuntimeQueryReason,
  RuntimeSourceKind,
  RuntimeConnectionDirection
} from './runtime-api/constants.js'
import {
  createGenerationController,
  createDisposeTransaction,
  DisposeTransactionKind
} from '@migaia/lifecycle'
import { attachErrorIdentity } from '@migaia/utils/error'
import { hostRethrowReporter } from '@migaia/utils/promise'
import { IpcReporterContext } from '../core/plugins/reporter-context.js'
import { isForwardedOperation } from '../core/internal/outbound-envelope.js'
import type { IRpcPortableValue } from '@migaia/rpc-contract'
import type { IRuntimePeer } from './runtime-api/peer.js'
import { readRuntimePeerConnection } from './runtime-api/peer.js'
import { RuntimeApiErrorText, RuntimeApiMode } from './runtime-api/constants.js'
import { RpcCoreErrorText } from '../core/error-text.js'
import { createProviderGenerationRetired } from '../core/internal/provider.js'
import { RpcCoreErrorCode } from '../core/errors.js'

import { nativeReplayReceipt } from '../core/internal/native-replay.js'
import { resolveAbortReason } from '../core/internal/async-control.js'
import { runtimeDirectoryDiff } from './runtime-api/description.js'
import { ERROR_SOURCE, RpcRemoteLayerErrorCode } from './error-code.js'
import { createRemoteLayerError } from './error.js'
import { createRemoteRetryPort, dispatchRemoteRetry } from './retry.js'
import type {
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
  runtime: IRuntimePeer
  /** Only the original current receipt retains its exact native unit for local cold sampling. */
  unit: unknown
  close(): Promise<void>
}>

/** The same generation owner accepts a negotiated runtime directory without a synthetic v1 contract. */
export type IRemoteRuntimeRegistration = Readonly<{
  readonly events: IRemoteGenerationEvents
  prepareGeneration(
    signal: IAbortSignal,
    own: (dispose: () => Promise<void>) => void
  ): Promise<number>
  revoke(reason: unknown): void
  whenClosed(generation: number): Promise<void>
  departedReasonCount(): number
  release(): Promise<void>
  /** Exact native execution authority is present only for the original spawn/create factory path. */
  /** Identity reads keep late exit facts bound to their exact original native generation. */
  /** Cold target selection reads only the retained safe directory, without native sampling. */
  runtimeInstanceIds(): readonly string[]
  runtimeInstanceId(generation: number): string | IRuntimeUnavailable
  readonly execution: ISupervisor<unknown, unknown> | undefined
  /** Passive lifecycle observers read the same original supervisor, including local connections. */
  readonly supervisor: ISupervisor<unknown, unknown>
  currentPeer(): IRuntimePeer
  /** True while the next generation is starting and no current Peer exists. */
  readonly restarting: boolean
  /** Whole forwarded groups retain the original accepted generation and leave reason. */
  invokeGroup(...args: Parameters<IRuntimePeer['group']>): ReturnType<IRuntimePeer['group']>
  /** Read original native state and bounded safe lifecycle history without preparing a generation. */
  inspectRuntime(): Promise<IRuntimeDetail>
  /** Logical runtime calls reuse the original retry/key/deadline dispatch below. */
  invokeRequest(
    method: string,
    payload: unknown,
    options?: IRuntimeCallOptions,
    mode?: RuntimeApiMode
  ): Promise<IRpcPortableValue>
  /** Forward streams retain the original generation and iterator lifecycle without replay. */
  invokeStream(
    method: string,
    payload: unknown,
    options?: IRuntimeCallOptions
  ): AsyncIterableIterator<IRpcPortableValue>
  /** Observe only a genuinely prepared canonical generation, after current pointer publication. */
  onReady(listener: (peer: IRuntimePeer, generation: number) => void): () => void
}>

/** Runtime preparation stays inside the original binding/channel/generation rollback boundary. */
export type IRemoteRuntimeRegistrationOptions<TUnit, TSpec> = IRemoteProxyOptions<TUnit, TSpec> &
  Readonly<{
    /** Private native factory provenance; local connection ownership cannot set execution authority. */
    execution?: ISupervisor<unknown, unknown>
    prepareRuntime(
      channel: IRemoteChannel,
      signal: IAbortSignal,
      sessionGeneration: number
    ): Promise<IRuntimePeer>
    readRuntimeEndpoint(peer: IRuntimePeer): IRemoteServeEndpoint
    /** Original native drain completes before this registration disposes its current endpoint. */
    beforeRelease?(): Promise<void>
  }>

/** One setup-scoped resource owner also accepts replacement generation resources. */
export type IRemoteGenerationHolder<
  TRegistration extends IRemoteRuntimeRegistration = IRemoteRuntimeRegistration
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
  if (isRpcRemoteError(error) && error.cause instanceof Error) {
    const restored = error.cause as Error & { readonly source?: unknown; readonly code?: unknown }
    if (typeof restored.source === 'string' && typeof restored.code === 'string') throw restored
  }
  throw error
}

/** One acquired candidate retains endpoint/channel cleanup identities until commit or rollback. */
class RemoteGenerationResources {
  /** The original acquired physical channel must close after its logical endpoint. */
  readonly channel: IRemoteChannel
  /** A prepared runtime owns endpoint disposal when the native route is selected. */
  #runtime: IRuntimePeer | undefined
  /** Binding validation may throw after runtime ownership has already been retained. */
  #served: IRemoteServeEndpoint | undefined
  /** Channel cleanup is idempotent and preserves the original Promise identity. */
  #channelClose: Promise<void> | undefined
  /** Endpoint cleanup is idempotent independently of channel cleanup. */
  #endpointClose: Promise<void> | undefined

  /** Retain an acquired channel before subsequent admission or binding can fail. */
  constructor(channel: IRemoteChannel) {
    this.channel = channel
  }

  /** Retain runtime disposal before observing its endpoint, whose binding validation can throw. */
  retainRuntime(runtime: IRuntimePeer | undefined): void {
    this.#runtime = runtime
  }

  /** Retain the exact endpoint selected by the existing binding owner. */
  retainEndpoint(served: IRemoteServeEndpoint): void {
    this.#served = served
  }

  /** Close exactly the acquired channel, retaining its first cleanup Promise. */
  closeChannel = (): Promise<void> => (this.#channelClose ??= this.channel.close())

  /** Close the prepared runtime or its exact endpoint before releasing the physical channel. */
  closeEndpoint = (): Promise<void> =>
    (this.#endpointClose ??= this.#runtime
      ? this.#runtime.close()
      : this.#served!.endpoint.dispose())

  /** Run the existing endpoint-before-channel transaction and preserve native failure identities. */
  close = async (): Promise<void> => {
    /** Lifecycle continues the original plan even when endpoint cleanup fails. */
    const failures = await createDisposeTransaction(
      { kind: DisposeTransactionKind.plan },
      { errorPolicy: 'collect', scheduler: this.channel.scheduler }
    ).run(
      [this.closeEndpoint, this.closeChannel].map((force, index) => ({
        source: String(index),
        descriptor: { force }
      }))
    )
    if (failures.length === 1) throw failures[0]!.error
    if (failures.length > 1)
      throw codedAggregate(
        failures.map(({ error }) => error),
        RpcRemoteLayerErrorCode.closed
      )
  }
}

/** One generation holder owns leave ordering and the retry port's neutral events. */
class RemoteRegistration<TUnit, TSpec> {
  /** Generation observations consumed by retry and Host readiness. */
  readonly events: IRemoteGenerationEvents
  /** The current binding and its single scheduler. */
  readonly #options: IRemoteRuntimeRegistrationOptions<TUnit, TSpec>
  /** An explicit port replaces the shared default for this registration. */
  readonly #retryPort: IRemoteRetryPort
  /** Core owns runtime raw capture, retry and conditional lazy consumer preparation. */
  readonly #coreCalls: ReturnType<typeof createRuntimeBindingCalls>
  /** Most recent described and active generation. */
  #current: IRemoteGeneration | undefined
  /** Accepted runtime sessions start at zero; failed channel/describe candidates never advance it. */
  #runtimeSession = -1
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
  constructor(options: IRemoteRuntimeRegistrationOptions<TUnit, TSpec>) {
    this.#options = options
    if (
      options.callDeadlineCapMs !== undefined &&
      (!Number.isSafeInteger(options.callDeadlineCapMs) || options.callDeadlineCapMs <= 0)
    )
      throw createRpcError(RpcCoreErrorCode.invalidConfig, RpcCoreErrorText.timeoutInvalid)
    this.events = Object.freeze({
      current: () => ({
        generation: this.#current?.number ?? this.#options.binding.supervisor.generation,
        active: this.#current !== undefined
      }),
      onLeave: (generation: number, listener: (reason: unknown) => void) => {
        if (this.#releaseReason !== undefined || this.#departed.has(generation)) {
          /** Capture before release clears historical reasons. */
          const reason = this.#releaseReason ?? this.#departed.get(generation)
          deferTask(this.#options.binding.scheduler, () => {
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
    this.#coreCalls = createRuntimeBindingCalls({
      scheduler: options.binding.scheduler,
      events: this.events,
      dispatch: (input, forwarded) =>
        forwarded
          ? dispatchRemoteRetry(
              {
                events: this.events,
                scheduler: options.binding.scheduler,
                report: options.report
              },
              input
            )
          : this.#retryPort.dispatch(input),
      current: () => {
        const active = this.#active()
        return {
          number: active.number,
          channel: active.channel,
          endpoint: active.served.endpoint
        }
      },
      observedGeneration: () => this.#current?.number ?? options.binding.supervisor.generation,
      declaration: (method, mode) => this.#runtimeMethod(method, mode),
      validateOptions: (input) => this.#callOptions(input),
      keyFactory: options.keyFactory,
      timeout: (requested) => this.#timeout(requested),
      closed: (generation, cause) =>
        createRemoteLayerError(RpcRemoteLayerErrorCode.closed, cause, { generation }),
      departureCause: (generation) => this.#departed.get(generation),
      restoreFailure: restoreTaggedProviderFailure,
      ...(options.binding.trackRequest
        ? { trackRequest: (invoke) => options.binding.trackRequest!(invoke) }
        : {})
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
    /** This shift is bounded by the compile-time RuntimeQueryLimit.recent=100 history cap. */
    if (this.#runtimeRecent.length > RuntimeQueryLimit.recent) this.#runtimeRecent.shift()
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

  /**
   * Starts an idle supervisor for the first generation. A first launch that fails is final: as soon
   * as the supervisor arms a restart backoff, the proxy stops it and answers `stopped`, so the
   * caller gets the launch failure at its own deadline instead of after every restart attempt.
   * `signal` cancels the wait; the supervisor itself is released with the proxy.
   */
  #startFirstGeneration<THandle, TSpec>(
    supervisor: ISupervisor<THandle, TSpec>,
    signal: IAbortSignal
  ): Promise<IReadyOutcome<THandle>> {
    if (signal.aborted) return Promise.reject(resolveAbortReason(signal))
    return new Promise<IReadyOutcome<THandle>>((resolve, reject) => {
      /** Detaches the backoff watch and the abort listener once the wait settles. */
      const settle = (): void => {
        unsubscribe()
        signal.removeEventListener('abort', onAbort)
      }
      /** Rejects the wait with the caller's abort reason. */
      const onAbort = (): void => {
        settle()
        reject(resolveAbortReason(signal))
      }
      /** Ends the first start on its first failed attempt instead of waiting out the backoff. */
      const unsubscribe = supervisor.subscribe((event) => {
        if (event.type !== 'state' || event.to !== SupervisorState.backoff) return
        settle()
        void supervisor.stop().catch((error: unknown) => this.#options.report(error))
        resolve({ state: SupervisorState.stopped })
      })
      signal.addEventListener('abort', onAbort, { once: true })
      supervisor.start().then(
        (outcome) => {
          settle()
          resolve(outcome)
        },
        (error: unknown) => {
          settle()
          reject(error)
        }
      )
    })
  }

  /** Same preparation path is called by first setup and later rebinding. */
  async prepareGeneration(
    signal: INativeAbortSignal,
    own: (dispose: () => Promise<void>) => void
  ): Promise<number> {
    if (this.#releasePromise) throw createRemoteLayerError(RpcRemoteLayerErrorCode.closed)
    const supervisor = this.#options.binding.supervisor
    const outcome =
      supervisor.state === SupervisorState.idle
        ? await this.#startFirstGeneration(supervisor, signal)
        : await supervisor.whenReady(signal)
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
    /** Cleanup identities belong to the candidate rather than a captured mutable local cache. */
    const resources = new RemoteGenerationResources(channel)
    /** The channel is owned before any later validation or endpoint construction can fail. */
    const closeChannel = resources.closeChannel
    try {
      this.#assertPreparing(signal, outcome.generation)
    } catch (error) {
      await this.#closeFailedCandidate([closeChannel])
      throw error
    }
    own(closeChannel)
    if (channel.scheduler !== this.#options.binding.scheduler)
      throw createRpcError(RpcCoreErrorCode.invalidConfig, RpcCoreErrorText.schedulerInvalid)
    /**
     * Local physical closure must revoke the generation before endpoint sends reject. A peer error
     * code alone is not departure evidence; only this transport's closed state is.
     */
    const removeTransportError = channel.transport.onTransportError?.((reason) => {
      if (channel.transport.closed === true) this.#leave(outcome.generation, reason)
    })
    if (removeTransportError) own(async () => removeTransportError())
    /** Native L can retire during a core checkpoint before the adapter's exit event arrives. */
    const removeRetirement = nativeReplayReceipt(channel.transport)?.onRetire(() =>
      this.#leave(outcome.generation, createRpcAbortError())
    )
    if (removeRetirement) own(async () => removeRetirement())
    /** Both runtime and advanced v2 directories share the same exact departure/resource owner. */
    /** Only the eventual original pointer publication commits this reserved session ordinal. */
    const sessionGeneration = this.#runtimeSession + 1
    const runtime = await this.#options.prepareRuntime(channel, signal, sessionGeneration)
    /** Endpoint is registered before the first describe frame. */
    resources.retainRuntime(runtime)
    /** The candidate owns the same cleanup function throughout binding validation. */
    const closeEndpoint = resources.closeEndpoint
    own(closeEndpoint)
    /** Binding validation can itself fail, so acquired runtime cleanup is already retained above. */
    const served = this.#options.readRuntimeEndpoint(runtime)
    resources.retainEndpoint(served)
    try {
      this.#assertPreparing(signal, outcome.generation)
    } catch (error) {
      await this.#closeFailedCandidate([closeEndpoint, closeChannel])
      throw error
    }
    own(closeEndpoint)
    /** Close endpoint before channel regardless of who owns the registration. */
    const generation: IRemoteGeneration = Object.freeze({
      number: outcome.generation,
      unit: outcome.unit,
      channel,
      served,
      runtime,
      close: resources.close
    })
    try {
      this.#assertPreparing(signal, generation.number)
    } catch (error) {
      await this.#closeFailedCandidate([closeEndpoint, closeChannel])
      throw error
    }
    return this.#commitGeneration(generation, runtime, sessionGeneration)
  }

  /** Publish one accepted generation, then notify its original directory and readiness observers. */
  #commitGeneration(
    generation: IRemoteGeneration,
    runtime: IRuntimePeer,
    sessionGeneration: number
  ): number {
    this.#runtimeSession = sessionGeneration
    /** Only the accepted replacement is compared with the original last-admitted directory. */
    const directory = readRuntimePeerConnection(runtime).directory
    /** First acceptance and identical route sets produce no artificial diff. */
    const diff =
      this.#runtimeDirectory?.description && directory?.description
        ? runtimeDirectoryDiff(this.#runtimeDirectory.description, directory.description)
        : undefined
    /** A reaped-late native unit can retain its receipt until this accepted successor commits. */
    if (this.#current && this.#current.number !== generation.number)
      this.#leave(this.#current.number, undefined)
    this.#current = generation
    if (directory) this.#runtimeDirectory = directory
    if (diff) {
      try {
        this.#options.report(diff)
      } catch (failure) {
        /** Reporting cannot turn an already accepted pointer into a failed/leaked candidate. */
        hostRethrowReporter(failure, IpcReporterContext)
      }
    }
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

  /**
   * Public runtime admission closes immediately; admitted continuations keep the original active
   * reader.
   */
  #runtimeActive(): IRemoteGeneration {
    if (this.#releaseReason) throw this.#releaseReason
    return this.#active()
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
    return this.#options.execution
  }

  /** Passive event subscription shares the canonical generation and teardown owner. */
  get supervisor(): ISupervisor<unknown, unknown> {
    return this.#options.binding.supervisor as ISupervisor<unknown, unknown>
  }

  /**
   * True while a live registration waits for its supervisor to start the next generation after the
   * previous one left (backoff, queued or starting). Calls in this window reject with REMOTE_CLOSED
   * instead of throwing; a released registration, or one whose supervisor stopped, keeps the
   * synchronous REMOTE_CLOSED admission failure.
   */
  get restarting(): boolean {
    if (this.#releaseReason !== undefined || this.#current) return false
    const state = this.#options.binding.supervisor.state
    return (
      state === SupervisorState.backoff ||
      state === SupervisorState.queued ||
      state === SupervisorState.starting
    )
  }

  /** Return only the current original generation, never a cached same-name successor handle. */
  currentPeer(): IRuntimePeer {
    const active = this.#runtimeActive()
    if (!active.runtime) throw createRemoteLayerError(RpcRemoteLayerErrorCode.closed)
    return active.runtime
  }

  /** Send one whole group through its captured original generation, without retry or retargeting. */
  invokeGroup(
    ...[steps, options]: Parameters<IRuntimePeer['group']>
  ): ReturnType<IRuntimePeer['group']> {
    const active = this.#runtimeActive()
    if (!active.runtime) throw createRemoteLayerError(RpcRemoteLayerErrorCode.closed)
    /**
     * Count the complete captured operation, including its original forwarded retirement
     * classification.
     */
    const invoke = (): ReturnType<IRuntimePeer['group']> => {
      if (!isForwardedOperation(options)) return active.runtime!.group(steps, options)
      /** Only this original registration's leave fact can reclassify the captured operation. */
      let retired: Error | undefined
      const unsubscribe = this.events.onLeave(active.number, (reason) => {
        retired = createProviderGenerationRetired(reason)
      })
      try {
        return active
          .runtime!.group(steps, options)
          .then(
            (result) => {
              if (retired) throw retired
              return result
            },
            (error: unknown) => {
              throw retired ?? error
            }
          )
          .finally(unsubscribe)
      } catch (error) {
        unsubscribe()
        throw retired ?? error
      }
    }
    /** Original drain tracks one whole Promise and preserves its ordinary identity. */
    return this.#options.binding.trackRequest
      ? this.#options.binding.trackRequest(invoke)
      : invoke()
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
          this.#options.execution
            ? {
                ...directory,
                kind: RuntimeSourceKind.spawn,
                direction: RuntimeConnectionDirection.spawned
              }
            : directory,
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

  /** Rejects control data that is not part of a declared request or stream call. */
  #callOptions(options: unknown): asserts options is IRuntimeCallOptions {
    if (options === null || typeof options !== 'object' || Array.isArray(options))
      throw createRemoteLayerError(RpcRemoteLayerErrorCode.contractInvalid)
    for (const key of Object.keys(options))
      if (
        key !== 'signal' &&
        key !== 'timeoutMs' &&
        key !== 'idempotencyKey' &&
        key !== 'orderKey' &&
        key !== 'cancel' &&
        key !== 'transfer'
      )
        throw createRemoteLayerError(RpcRemoteLayerErrorCode.contractInvalid, undefined, {
          path: `$.options.${key}`
        })
    const call = options as IRuntimeCallOptions
    if (
      call.timeoutMs !== undefined &&
      call.timeoutMs !== false &&
      (typeof call.timeoutMs !== 'number' || !Number.isFinite(call.timeoutMs) || call.timeoutMs < 0)
    )
      throw createRpcError(RpcCoreErrorCode.invalidConfig, RpcCoreErrorText.timeoutInvalid)
  }

  /** Shared request path preserves the core send error object and logical key. */
  invokeRequest(
    method: string,
    params: unknown,
    options: IRuntimeCallOptions = {},
    mode: RuntimeApiMode = RuntimeApiMode.request
  ): Promise<IRpcPortableValue> {
    return this.#coreCalls.request(method, params, options, mode as 'request' | 'notify')
  }

  /** Admit the logical business mode from the same precompiled index used by direct Peer calls. */
  #runtimeMethod(method: string, mode: RuntimeApiMode) {
    /**
     * While the next generation is being started there is no directory to check; the call's own
     * admission then rejects with REMOTE_CLOSED instead of this declaration read throwing.
     */
    if (this.restarting) return undefined
    const connection = readRuntimePeerConnection(this.currentPeer())
    if (!connection.description) return undefined
    const declaration = connection.routes.get(method)
    if (!declaration)
      throw createRpcError(RpcCoreErrorCode.providerNotFound, RuntimeApiErrorText.methodUnavailable)
    if (!declaration.supportedModes.includes(mode))
      throw createRpcError(
        RpcCoreErrorCode.capabilityUnsupported,
        RpcCoreErrorText.capabilityUnsupported
      )
    return declaration
  }

  /** Stream opening remains lazy so guard errors reach the first next call. */
  invokeStream(
    method: string,
    params: unknown,
    options: IRuntimeCallOptions = {}
  ): AsyncIterableIterator<IRpcPortableValue> {
    return this.#coreCalls.stream(method, params, options)
  }

  /** Applies one registration cap at the logical-call entry. */
  #timeout(requested?: number | false): number | undefined {
    if (requested === false) return this.#options.callDeadlineCapMs
    if (requested !== undefined && (!Number.isFinite(requested) || requested < 0))
      throw createRpcError(RpcCoreErrorCode.invalidConfig, RpcCoreErrorText.timeoutInvalid)
    const cap = this.#options.callDeadlineCapMs
    return cap === undefined ? requested : requested === undefined ? cap : Math.min(cap, requested)
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
          failures.push(failure)
        }
        if (this.#options.binding.ownership === 'owned') {
          try {
            await this.#options.binding.supervisor.dispose()
          } catch (failure) {
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

/** Runtime facades reuse the original supervisor, leave ordering, waiters and resource holder. */
export function createRemoteRuntimeRegistration<TUnit, TSpec>(
  options: IRemoteRuntimeRegistrationOptions<TUnit, TSpec>
): IRemoteRuntimeRegistration {
  return new RemoteRegistration(options)
}

/** Owns generation resources once across setup, replacement, and final removal. */
/** Own retained resources once across actual initial setup, native replacement and final removal. */
class RemoteGenerationHolder<
  TRegistration extends IRemoteRuntimeRegistration
> implements IRemoteGenerationHolder<TRegistration> {
  /** Original registration remains the sole native generation and supervision authority. */
  readonly registration: TRegistration
  /** Cleanup diagnostics retain the caller's original bare reporter. */
  #report: (error: unknown) => void
  /** Native drain ownership may detach preparation cancellation only at genuine commit. */
  #detachPreparationOnCommit: boolean
  /** Departed generations release their resource groups rather than growing a lifetime stack. */
  #retained = new Set<Set<() => Promise<void>>>()
  /** Final removal shares its first settlement with every repeated PluginHost cleanup. */
  #releasePromise: Promise<void> | undefined
  /** Observers and public commands join one original preparation of the same native generation. */
  #pendingRebind: Promise<number> | undefined

  /** Capture the existing owner ports without opening or preparing a native generation. */
  constructor(
    registration: TRegistration,
    report: (error: unknown) => void,
    detachPreparationOnCommit: boolean
  ) {
    this.registration = registration
    this.#report = report
    this.#detachPreparationOnCommit = detachPreparationOnCommit
  }
  /** Close original group resources in reverse acquisition order, retaining exact errors. */
  #closeGroup = async (group: Set<() => Promise<void>>): Promise<unknown[]> => {
    const failures: unknown[] = []
    for (const dispose of [...group].reverse()) {
      try {
        await dispose()
      } catch (error) {
        failures.push(error)
      }
    }
    group.clear()
    this.#retained.delete(group)
    return failures
  }

  /** Report cleanup beside its original preparation primary without replacing that primary. */
  #rollback = async (group: Set<() => Promise<void>>, primary: unknown): Promise<boolean> => {
    const failures = await this.#closeGroup(group)
    if (failures.length > 0)
      (0, this.#report)(codedAggregate([primary, ...failures], RpcRemoteLayerErrorCode.startFailed))
    return failures.length > 0
  }

  /** Prepare one genuine generation and transfer only its actual acquired disposer group. */
  #prepare = async (
    signal: IAbortSignal,
    cleanupOnFailure: boolean,
    reportFailure: boolean
  ): Promise<number> => {
    const group = new Set<() => Promise<void>>()
    this.#retained.add(group)
    /** The existing lifecycle controller separates one preparation from its committed channel. */
    const attempt = this.#detachPreparationOnCommit
      ? createGenerationController({ parentSignal: signal })
      : undefined
    /** Initial setup and later rebinds use the same canonical cancellation transfer. */
    const request = attempt?.begin()
    try {
      const generation = await this.registration.prepareGeneration(
        request?.signal ?? signal,
        (dispose) => {
          group.add(dispose)
        }
      )
      if (request) {
        if (request.signal.aborted) throw resolveAbortReason(request.signal)
        attempt!.complete(request.token)
      }
      this.registration.events.onLeave(generation, () => {
        void this.registration.whenClosed(generation).then(() => {
          group.clear()
          this.#retained.delete(group)
        })
      })
      return generation
    } catch (error) {
      if (cleanupOnFailure || this.#releasePromise) {
        const hadCleanupFailure = await this.#rollback(group, error)
        if (reportFailure && !hadCleanupFailure) (0, this.#report)(error)
      }
      throw error
    } finally {
      attempt?.dispose()
    }
  }

  /** Use original initial setup and explicit rollback policy before publication. */
  prepareInitial = (signal: IAbortSignal, rollbackOnFailure = false) =>
    this.#prepare(signal, rollbackOnFailure, false)

  /** Join one preparation of the same original native generation without retargeting. */
  prepareRebind = (signal: IAbortSignal) => {
    if (signal.aborted) return Promise.reject(resolveAbortReason(signal))
    if (this.#releasePromise)
      return Promise.reject(createRemoteLayerError(RpcRemoteLayerErrorCode.closed))
    if (this.#pendingRebind) return this.#pendingRebind
    /** An accepted generation already published its original pointer and outlet receipt. */
    const current = this.registration.events.current()
    if (
      current.active &&
      (!('supervisor' in this.registration) ||
        current.generation === this.registration.supervisor.generation)
    )
      return Promise.resolve(current.generation)
    this.#pendingRebind = this.#prepare(signal, true, true).finally(() => {
      this.#pendingRebind = undefined
    })
    return this.#pendingRebind
  }

  /** Count only currently retained actual generation resources. */
  retainedResourceCount = () => [...this.#retained].reduce((count, group) => count + group.size, 0)

  /** Join the exact original final cleanup Promise across repeated host removal. */
  release = () => {
    if (this.#releasePromise) return this.#releasePromise
    this.#releasePromise = (async () => {
      const failures: unknown[] = []
      try {
        await this.registration.release()
      } catch (error) {
        failures.push(error)
      }
      for (const group of this.#retained) failures.push(...(await this.#closeGroup(group)))
      if (failures.length > 0) throw codedAggregate(failures, RpcRemoteLayerErrorCode.closed)
    })()
    return this.#releasePromise
  }
}

/** Reuse the original native registration for one retained generation resource owner. */
export function createRemoteGenerationHolder<TRegistration extends IRemoteRuntimeRegistration>(
  registration: TRegistration,
  report: (error: unknown) => void,
  detachPreparationOnCommit = false
): IRemoteGenerationHolder<TRegistration> {
  return new RemoteGenerationHolder(registration, report, detachPreparationOnCommit)
}
