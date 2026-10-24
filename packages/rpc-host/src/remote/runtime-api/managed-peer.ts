import type { IAbortSignal } from '@migaia/utils/promise'
import { createManagedRuntimeCalls } from '../internal/runtime-call.js'
import { runtimeQuery } from './overview.js'
import { createAbortController } from '@migaia/lifecycle'
import { hostRethrowReporter } from '@migaia/utils/promise'
import { IpcReporterContext } from '../../core/plugins/reporter-context.js'
import { createProbeEmitter } from '../../core/internal/probe-emitter.js'
import { RpcProbeStage } from '../../core/probe/constants.js'
import type { IRpcProbe } from '../../core/probe/types.js'
import type {
  IRemoteBinding,
  IRemoteServeEndpoint,
  IRemoteProxyOptions,
  IRemoteChannel
} from '../types.js'
import {
  createRemoteRuntimeRegistration,
  createRemoteGenerationHolder,
  type IRemoteGenerationHolder,
  type IRemoteRuntimeRegistration
} from '../proxy.js'
import { observeRemoteGenerations } from '../internal/generation-observer.js'
import { readRuntimeDefaultTimeout, prepareRuntimeCallTimeout } from './timeout.js'
import { RpcRuntimeGenerationKind } from '@migaia/rpc-contract/framing/v1'
import { compileRuntimeMethods } from './catalog.js'
import { createRuntimeEventPublisher, runtimeReadyEvent, runtimeSupervisorEvent } from './events.js'
import {
  createRuntimePeer,
  prepareRuntimePeerSourceContext,
  readRuntimePeerEndpoint,
  retainRuntimePeerConnection,
  type IRuntimePeerOptions,
  type IRuntimePeer
} from './peer.js'
import { defaultRpcReporter } from '../../core/default-reporter.js'

/** Exact facade provenance points to the original generation owner and duplicates no state. */
const managedRegistrations = new WeakMap<
  IRuntimePeer,
  Readonly<{
    holder: IRemoteGenerationHolder<IRemoteRuntimeRegistration>
    prepareReplacement?: (spec: unknown) => unknown
  }>
>()

/** Plugin commands and publication share the genuine preparation owner, never a structural Peer. */
export function readManagedRuntimeHolder(
  peer: IRuntimePeer
): IRemoteGenerationHolder<IRemoteRuntimeRegistration> | undefined {
  return managedRegistrations.get(peer)?.holder
}

/** Existing registration consumers retain the exact registration owned by this facade's holder. */
export function readManagedRuntimeRegistration(
  peer: IRuntimePeer
): IRemoteRuntimeRegistration | undefined {
  return managedRegistrations.get(peer)?.holder.registration
}

/** The same genuine managed receipt carries its transport's opaque replacement preparation. */
export function readManagedRuntimeReplacement(
  peer: IRuntimePeer | undefined
): ((spec: unknown) => unknown) | undefined {
  return peer && managedRegistrations.get(peer)?.prepareReplacement
}

/**
 * Original remote generation and resource owners prepare one platform binding without a v1
 * contract.
 */
/** Original managed native options retain their existing key/retry/deadline policy. */
type IManagedRuntimePeerOptions<TUnit, TSpec> = IRuntimePeerOptions &
  Pick<IRemoteProxyOptions<TUnit, TSpec>, 'keyFactory' | 'retryPort' | 'callDeadlineCapMs'>
/** Source-specific preparation remains with the actual transport and original resource owner. */
type IManagedRuntimePreparation = Readonly<{
  selfDefaulted?: boolean
  /** Source-specific preparation stays with the real installed transport and its original state. */
  prepareReplacement?(spec: unknown): unknown
  connectionOrigin?(): import('./overview.js').IRuntimeConnectionOrigin
  restrictTransfer?(options: object | undefined): void
  host?: import('@migaia/plugin-host').IPluginRuntimeIntegration
  providerAdmission?: import('../../core/internal/provider-admission.js').IProviderAdmissionScope
  providerAdmissionRegistration?: Readonly<{
    stagePolicy(maxGlobal?: number, maxPerPeer?: number): void
    isCommitted(): boolean
  }>
  initialSignal?: IAbortSignal
  lifecycleSignal?: IAbortSignal
  own?(dispose: () => Promise<void>): void
  readProvide?(): import('./peer.js').IRuntimePeerProvide
  publishPeer?(peer: IRuntimePeer): () => void
  /**
   * A host may prepare the genuine session over its existing endpoint; registration still owns
   * acquisition, generation commit and rollback of the returned session facade.
   */
  prepareRuntime?(
    channel: IRemoteChannel,
    signal: IAbortSignal,
    sessionGeneration: number
  ): Promise<IRuntimePeer>
}>
/** Actual native binding may lend an endpoint policy without constructing another Peer. */
type IManagedEndpointBinding = (
  channel: IRemoteChannel,
  endpoint: IRemoteServeEndpoint
) => IRemoteServeEndpoint

/** Own startup observation and the same original registration/holder for a managed callable Peer. */
class ManagedRuntimePeer<TUnit, TSpec> {
  /** Original user options retain their genuine private preparation provenance. */
  #options: IManagedRuntimePeerOptions<TUnit, TSpec>
  /** Native resource, drain, retry tracking and clock authority stay with this exact binding. */
  #binding: IRemoteBinding<TUnit, TSpec>
  /** Native policy wraps the actual prepared endpoint at its original admission boundary. */
  #bindEndpoint: IManagedEndpointBinding | undefined
  /** Existing source preparation alone owns runtime/Host publication and cancellation metadata. */
  #preparation: IManagedRuntimePreparation | undefined
  /** Managed diagnostics reuse the original report callback or the one canonical default. */
  #report: (error: unknown) => void
  /** Native transfer restriction stays with the real source's preparation owner. */
  #restrictTransfer: IManagedRuntimePreparation['restrictTransfer']
  /** Logical deadline is validated before original supervision or native launch side effects. */
  #callTimeout: ReturnType<typeof prepareRuntimeCallTimeout>
  /** Safe identity and implemented offers are compiled before native acquisition. */
  #context: ReturnType<typeof prepareRuntimePeerSourceContext>
  /** The actual registration remains the sole current/leave/ready and native command authority. */
  #registration: IRemoteRuntimeRegistration
  /** All startup and rebind disposers join the original generation holder. */
  #holder: IRemoteGenerationHolder<IRemoteRuntimeRegistration>
  /** Lifecycle subscribers borrow actual registration/supervisor observations only. */
  #events = createRuntimeEventPublisher()
  /** Managed diagnostic lifetime outlives individual prepared generation endpoints. */
  #supervisionProbe: ReturnType<typeof createProbeEmitter> | undefined
  /** This exact ready listener receipt is removed on startup failure and final close. */
  #stopReady: () => void
  /** This exact native listener receipt is removed on startup failure and final close. */
  #stopNative: () => void
  /** Standalone peers retain the original lifecycle cancellation signal domain. */
  #signal: IAbortSignal
  /** Passive generation observation is installed only after initial genuine readiness. */
  #stopObserving: (() => void) | undefined

  /** Validate safe configuration and retain original canonical owners before any supervisor start. */
  constructor(
    options: IManagedRuntimePeerOptions<TUnit, TSpec>,
    binding: IRemoteBinding<TUnit, TSpec>,
    bindEndpoint: IManagedEndpointBinding | undefined,
    preparation: IManagedRuntimePreparation | undefined,
    beforeRelease: (() => Promise<void>) | undefined,
    execution: import('@migaia/supervision').ISupervisor<unknown, unknown> | undefined
  ) {
    this.#options = options
    this.#binding = binding
    this.#bindEndpoint = bindEndpoint
    this.#preparation = preparation
    this.#report = options.report ?? defaultRpcReporter
    this.#restrictTransfer = preparation?.restrictTransfer
    this.#callTimeout = prepareRuntimeCallTimeout(readRuntimeDefaultTimeout(options))
    compileRuntimeMethods(options.provide, options.contract)
    this.#context = prepareRuntimePeerSourceContext(
      options.self,
      !options.endpointFactory,
      options.authentication
    )
    this.#registration = createRemoteRuntimeRegistration({
      binding,
      execution,
      report: this.#report,
      keyFactory: options.keyFactory,
      retryPort: options.retryPort,
      callDeadlineCapMs: options.callDeadlineCapMs,
      beforeRelease,
      prepareRuntime: preparation?.prepareRuntime ?? this.#prepareRuntime,
      readRuntimeEndpoint: (peer) => readRuntimePeerEndpoint(peer)
    })
    this.#holder = createRemoteGenerationHolder(this.#registration, this.#report, true)
    this.#supervisionProbe =
      options.probe === undefined
        ? undefined
        : createProbeEmitter(
            Array.isArray(options.probe) ? options.probe : [options.probe as IRpcProbe],
            () => binding.scheduler.now(),
            this.#context.self.instanceId
          )
    this.#stopReady = this.#registration.onReady(this.#onReady)
    this.#stopNative = this.#registration.supervisor.subscribe(this.#onNative)
    this.#signal = preparation?.initialSignal ?? createAbortController().signal
  }

  /** Prepare one generation over its actual channel; the native holder retains close authority. */
  #prepareRuntime = (
    channel: IRemoteChannel,
    signal: IAbortSignal,
    sessionGeneration: number
  ): Promise<IRuntimePeer> =>
    createRuntimePeer(
      {
        self: this.#context.self,
        provide: this.#preparation?.readProvide?.() ?? this.#options.provide,
        probe: this.#options.probe,
        providerLimits: this.#options.providerLimits,
        authentication: this.#options.authentication,
        defaultTimeoutMs: this.#options.defaultTimeoutMs,
        contract: this.#options.contract,
        endpointFactory: this.#options.endpointFactory
          ? (_borrowedChannel, signal) => this.#options.endpointFactory!(channel, signal)
          : undefined,
        report: this.#report
      },
      {
        channel: Object.fromEntries(
          Object.entries(channel).filter(([key]) => key !== 'close')
        ) as Omit<IRemoteChannel, 'close'>,
        host: this.#preparation?.host,
        providerAdmission: this.#preparation?.providerAdmission,
        providerAdmissionRegistration: this.#preparation?.providerAdmissionRegistration,
        signal,
        generation: {
          kind: RpcRuntimeGenerationKind.session,
          value: sessionGeneration,
          providerId: this.#context.self.instanceId
        },
        ...(this.#bindEndpoint
          ? {
              wrapEndpoint: (endpoint: IRemoteServeEndpoint) => {
                /** Preserve the original native callback's bare receiver. */
                const bindEndpoint = this.#bindEndpoint!
                return bindEndpoint(channel, endpoint)
              }
            }
          : {})
      }
    )

  /** Initial factory readiness stays implicit; later genuine registration readiness is observable. */
  #onReady = (prepared: IRuntimePeer, generation: number): void => {
    this.#events.publish(
      runtimeReadyEvent(this.#context.self.name, prepared, generation),
      this.#report
    )
  }

  /** Native exit/restart/degradation retain the actual supervisor's original classification. */
  #onNative = (
    event: Parameters<Parameters<IRemoteRuntimeRegistration['supervisor']['subscribe']>[0]>[0]
  ): void => {
    /** The canonical event projector is shared with the committed Host outlet. */
    const observation = runtimeSupervisorEvent(
      this.#context.self.name,
      this.#registration,
      event,
      this.#report
    )
    if (!observation) return
    if (this.#supervisionProbe && (this.#supervisionProbe.mask & (1 << RpcProbeStage.peer)) !== 0)
      this.#supervisionProbe.peer(
        observation.type,
        typeof observation.instanceId === 'string' ? observation.instanceId : undefined,
        'error' in event ? event.error : undefined
      )
    this.#events.publish(observation, this.#report)
  }

  /** Stop original observations before joining the same canonical holder release Promise. */
  #close = (): Promise<void> => {
    ;(0, this.#stopObserving)?.()
    ;(0, this.#stopReady)()
    ;(0, this.#stopNative)()
    this.#supervisionProbe?.dispose()
    this.#events.close()
    return this.#holder.release()
  }

  /** Initial failure rolls back original native resources while preserving its primary identity. */
  async open(): Promise<IRuntimePeer> {
    try {
      this.#preparation?.own?.(this.#close)
      await this.#holder.prepareInitial(this.#signal, true)
      this.#stopObserving = observeRemoteGenerations(
        this.#holder,
        this.#binding,
        this.#preparation?.lifecycleSignal ?? this.#signal,
        this.#report
      )
    } catch (primary) {
      ;(0, this.#stopReady)()
      ;(0, this.#stopNative)()
      this.#supervisionProbe?.dispose()
      this.#events.close()
      try {
        await this.#holder.release()
      } catch (cleanup) {
        try {
          ;(0, this.#report)(cleanup)
        } catch (reporterError) {
          hostRethrowReporter(reporterError, IpcReporterContext)
        }
      }
      throw primary
    }
    this.#registration.currentPeer()
    return this.#project()
  }

  /** Mint one facade only after true accepted generation readiness, preserving operation Promises. */
  #project(): IRuntimePeer {
    /** The original holder supplies every accepted native generation and directory read. */
    const peer: IRuntimePeer = Object.freeze({
      self: this.#context.self,
      on: this.#events.on,
      ...createManagedRuntimeCalls({
        restrictTransfer: this.#restrictTransfer,
        callTimeout: this.#callTimeout,
        callDeadlineCapMs: this.#options.callDeadlineCapMs,
        trackRequest: this.#binding.trackRequest,
        registration: this.#registration
      }),
      describe: runtimeQuery(() => this.#registration.inspectRuntime()),
      close: this.#close,
      [Symbol.asyncDispose]: this.#close
    })
    managedRegistrations.set(peer, {
      holder: this.#holder,
      prepareReplacement: this.#preparation?.prepareReplacement
    })
    retainRuntimePeerConnection(peer, () => this.#registration.currentPeer())
    return peer
  }
}

/** Reuse original remote generation/resource owners to prepare one actual native binding. */
export async function createManagedRuntimePeer<TUnit, TSpec>(
  options: IManagedRuntimePeerOptions<TUnit, TSpec>,
  binding: IRemoteBinding<TUnit, TSpec>,
  bindEndpoint?: IManagedEndpointBinding,
  preparation?: IManagedRuntimePreparation,
  beforeRelease?: () => Promise<void>,
  execution?: import('@migaia/supervision').ISupervisor<unknown, unknown>
): Promise<IRuntimePeer> {
  return new ManagedRuntimePeer(
    options,
    binding,
    bindEndpoint,
    preparation,
    beforeRelease,
    execution
  ).open()
}
