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
import { observeRemoteGenerations } from '../internal/assemble-plugin.js'
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
  IRemoteGenerationHolder<IRemoteRuntimeRegistration>
>()

/** Plugin commands and publication share the genuine preparation owner, never a structural Peer. */
export function readManagedRuntimeHolder(
  peer: IRuntimePeer
): IRemoteGenerationHolder<IRemoteRuntimeRegistration> | undefined {
  return managedRegistrations.get(peer)
}

/** Existing registration consumers retain the exact registration owned by this facade's holder. */
export function readManagedRuntimeRegistration(
  peer: IRuntimePeer
): IRemoteRuntimeRegistration | undefined {
  return managedRegistrations.get(peer)?.registration
}

/**
 * Original remote generation and resource owners prepare one platform binding without a v1
 * contract.
 */
export async function createManagedRuntimePeer<TUnit, TSpec>(
  options: IRuntimePeerOptions &
    Pick<IRemoteProxyOptions<TUnit, TSpec>, 'keyFactory' | 'retryPort' | 'callDeadlineCapMs'>,
  binding: IRemoteBinding<TUnit, TSpec>,
  bindEndpoint?: (channel: IRemoteChannel, endpoint: IRemoteServeEndpoint) => IRemoteServeEndpoint,
  preparation?: Readonly<{
    selfDefaulted?: boolean
    connectionOrigin?(): import('./overview.js').IRuntimeConnectionOrigin
    restrictTransfer?(options: object | undefined): void
    host?: import('@migaia/plugin-host').IPluginRuntimeIntegration
    providerAdmission?: import('../../core/features/provider.js').IProviderAdmissionScope
    providerAdmissionRegistration?: Readonly<{
      stagePolicy(maxGlobal?: number, maxPerPeer?: number): void
      isCommitted(): boolean
    }>
    initialSignal?: IAbortSignal
    lifecycleSignal?: IAbortSignal
    own?(dispose: () => Promise<void>): void
    readProvide?(): import('./peer.js').IRuntimePeerProvide
    publishPeer?(peer: IRuntimePeer): () => void
  }>,
  beforeRelease?: () => Promise<void>,
  execution?: import('@migaia/supervision').ISupervisor<unknown, unknown>
): Promise<IRuntimePeer> {
  /** All managed diagnostics share one default without copying the genuine options object. */
  const report = options.report ?? defaultRpcReporter
  /** This private native restriction never grants execution, channel or Host authority. */
  const restrictTransfer = preparation?.restrictTransfer
  /** The original registration receives a logical deadline before applying its launcher cap. */
  const callTimeout = prepareRuntimeCallTimeout(readRuntimeDefaultTimeout(options))
  compileRuntimeMethods(options.provide, options.contract)
  /** Safe configuration admission precedes supervisor.start and any native launcher side effect. */
  const context = prepareRuntimePeerSourceContext(
    options.self,
    !options.endpointFactory,
    options.authentication
  )
  /** This is the original canonical current/leave/ready owner, shared with existing remote facades. */
  const registration = createRemoteRuntimeRegistration({
    binding,
    execution,
    report: report,
    keyFactory: options.keyFactory,
    retryPort: options.retryPort,
    callDeadlineCapMs: options.callDeadlineCapMs,
    beforeRelease,
    prepareRuntime: (channel, preparationSignal, sessionGeneration) =>
      createRuntimePeer(
        {
          self: context.self,
          provide: preparation?.readProvide?.() ?? options.provide,
          probe: options.probe,
          providerLimits: options.providerLimits,
          authentication: options.authentication,
          defaultTimeoutMs: options.defaultTimeoutMs,
          contract: options.contract,
          endpointFactory: options.endpointFactory
            ? (_borrowedChannel, signal) => options.endpointFactory!(channel, signal)
            : undefined,
          report: report
        },
        {
          channel: Object.fromEntries(
            Object.entries(channel).filter(([key]) => key !== 'close')
          ) as Omit<IRemoteChannel, 'close'>,
          host: preparation?.host,
          providerAdmission: preparation?.providerAdmission,
          providerAdmissionRegistration: preparation?.providerAdmissionRegistration,
          signal: preparationSignal,
          generation: {
            kind: RpcRuntimeGenerationKind.session,
            value: sessionGeneration,
            providerId: context.self.instanceId
          },
          ...(bindEndpoint
            ? { wrapEndpoint: (endpoint: IRemoteServeEndpoint) => bindEndpoint(channel, endpoint) }
            : {})
        }
      ),
    readRuntimeEndpoint: (peer) => {
      /** Native health/drain receives the actual endpoint, never a synthetic successful ping. */
      const endpoint = readRuntimePeerEndpoint(peer)
      return endpoint
    }
  })
  /** Every startup/rebind disposer joins the original holder's exact generation resource group. */
  const holder = createRemoteGenerationHolder(registration, report, true)
  /**
   * Passive subscribers reuse actual registration and native observations, without another
   * lifecycle.
   */
  const events = createRuntimeEventPublisher()
  /** The managed facade outlives generation endpoints and observes its existing supervisor only. */
  const supervisionProbe =
    options.probe === undefined
      ? undefined
      : createProbeEmitter(
          Array.isArray(options.probe) ? options.probe : [options.probe as IRpcProbe],
          () => binding.scheduler.now(),
          context.self.instanceId
        )
  /** Initial readiness occurs before factory resolution; only later genuine readiness is observable. */
  const stopReady = registration.onReady((prepared, generation) => {
    events.publish(runtimeReadyEvent(context.self.name, prepared, generation), report)
  })
  /** Native exit, restart and degradation keep exactly the original supervisor's classification. */
  const stopNative = registration.supervisor.subscribe((event) => {
    /** One shared projection retains the same classification used by the committed Host outlet. */
    const observation = runtimeSupervisorEvent(context.self.name, registration, event, report)
    if (observation) {
      if (supervisionProbe && (supervisionProbe.mask & (1 << RpcProbeStage.peer)) !== 0)
        supervisionProbe.peer(
          observation.type,
          typeof observation.instanceId === 'string' ? observation.instanceId : undefined,
          'error' in event ? event.error : undefined
        )
      events.publish(observation, report)
    }
  })
  /** A standalone Peer uses the original lifecycle signal domain without Host mutation metadata. */
  const signal: IAbortSignal = preparation?.initialSignal ?? createAbortController().signal
  /** The original observer is canceled before the canonical holder releases its generation. */
  let stopObserving: (() => void) | undefined
  /** Early ownership covers acquired native execution while channel or endpoint preparation waits. */
  const close = (): Promise<void> => {
    stopObserving?.()
    stopReady()
    stopNative()
    supervisionProbe?.dispose()
    events.close()
    return holder.release()
  }
  try {
    preparation?.own?.(close)
    await holder.prepareInitial(signal, true)
    stopObserving = observeRemoteGenerations(
      holder,
      binding,
      preparation?.lifecycleSignal ?? signal,
      report
    )
  } catch (primary) {
    stopReady()
    stopNative()
    supervisionProbe?.dispose()
    events.close()
    try {
      await holder.release()
    } catch (cleanup) {
      try {
        report(cleanup)
      } catch (reporterError) {
        hostRethrowReporter(reporterError, IpcReporterContext)
      }
    }
    throw primary
  }
  /** Only the true accepted generation supplies identity and directory metadata for publication. */
  registration.currentPeer()
  /** Calls preserve the original current-generation operation Promise and stream iterator. */
  const peer: IRuntimePeer = Object.freeze({
    self: context.self,
    on: events.on,
    ...createManagedRuntimeCalls({
      restrictTransfer,
      callTimeout,
      callDeadlineCapMs: options.callDeadlineCapMs,
      trackRequest: binding.trackRequest,
      registration
    }),
    describe: runtimeQuery(() => registration.inspectRuntime()),
    close,
    [Symbol.asyncDispose]: close
  })
  managedRegistrations.set(peer, holder)
  retainRuntimePeerConnection(peer, () => registration.currentPeer())
  return peer
}
