import { runtimeQuery, type IRuntimeConnectionOrigin } from './overview.js'
import { createAbortController, type IAbortSignal } from '@migaia/lifecycle'
import { hostRethrowReporter } from '@migaia/utils/promise'
import { IpcReporterContext } from '../../core/plugins/reporter-context.js'
import type {
  IRemoteBinding,
  IRemoteServeEndpoint,
  IRemoteProxyOptions,
  IRemoteChannel
} from '../types.js'
import {
  createRemoteRuntimeRegistration,
  createRemoteGenerationHolder,
  type IRemoteRuntimeRegistration
} from '../proxy.js'
import { observeRemoteGenerations } from '../internal/assemble-plugin.js'
import type { IRuntimePreparationContext } from './launch-context.js'
import { isForwardedPayload } from '../../core/internal/outbound-envelope.js'
import { RuntimeApiMode } from './constants.js'
import { compileRuntimeMethods } from './catalog.js'
import {
  createRuntimePeer,
  prepareRuntimePeerSourceContext,
  readRuntimePeerEndpoint,
  retainRuntimePeerConnection,
  type IRuntimePeerOptions,
  type IRuntimePeer
} from './peer.js'

/** Exact facade provenance points to the original generation owner and duplicates no state. */
const managedRegistrations = new WeakMap<IRuntimePeer, IRemoteRuntimeRegistration>()

/** Plugin publication subscribes to the genuine canonical owner, never a structural Peer. */
export function readManagedRuntimeRegistration(
  peer: IRuntimePeer
): IRemoteRuntimeRegistration | undefined {
  return managedRegistrations.get(peer)
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
  preparation?: IRuntimePreparationContext,
  beforeRelease?: () => Promise<void>,
  origin?: IRuntimeConnectionOrigin
): Promise<IRuntimePeer> {
  compileRuntimeMethods(options.provide, options.contract)
  /** Safe configuration admission precedes supervisor.start and any native launcher side effect. */
  const context = prepareRuntimePeerSourceContext(options.self)
  /** This is the original canonical current/leave/ready owner, shared with existing remote facades. */
  const registration = createRemoteRuntimeRegistration({
    binding,
    report: options.report,
    keyFactory: options.keyFactory,
    retryPort: options.retryPort,
    callDeadlineCapMs: options.callDeadlineCapMs,
    beforeRelease,
    prepareRuntime: (channel, preparationSignal) =>
      createRuntimePeer(
        {
          self: context.self,
          provide: preparation?.readProvide?.() ?? options.provide,
          providerLimits: options.providerLimits,
          contract: options.contract,
          endpointFactory: options.endpointFactory,
          report: options.report
        },
        {
          self: context.self,
          source: async () => channel,
          nodeId: preparation?.nodeId,
          origin,
          ownsChannel: false,
          signal: preparationSignal,
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
  const holder = createRemoteGenerationHolder(registration, options.report)
  /** A standalone Peer uses the original lifecycle signal domain without Host mutation metadata. */
  const signal: IAbortSignal = preparation?.initialSignal ?? createAbortController().signal
  /** The original observer is canceled before the canonical holder releases its generation. */
  let stopObserving: (() => void) | undefined
  /** Early ownership covers acquired native execution while channel or endpoint preparation waits. */
  const close = (): Promise<void> => {
    stopObserving?.()
    return holder.release()
  }
  try {
    preparation?.own(close)
    await holder.prepareInitial(signal, true)
    stopObserving = observeRemoteGenerations(
      holder,
      binding,
      preparation?.lifecycleSignal ?? signal,
      options.report
    )
  } catch (primary) {
    try {
      await holder.release()
    } catch (cleanup) {
      try {
        options.report(cleanup)
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
    request: (method, payload, callOptions) =>
      registration.invokeRequest(method, payload, callOptions),
    notify: (method, payload, callOptions) =>
      isForwardedPayload(callOptions, payload)
        ? registration
            .invokeRequest(method, payload, callOptions, RuntimeApiMode.notify)
            .then(() => undefined)
        : registration.currentPeer().notify(method, payload, callOptions),
    stream: (method, payload, callOptions) =>
      isForwardedPayload(callOptions, payload)
        ? registration.invokeStream(method, payload, callOptions)
        : registration.currentPeer().stream(method, payload, callOptions),
    describe: runtimeQuery(() => registration.inspectRuntime()),
    close
  })
  managedRegistrations.set(peer, registration)
  retainRuntimePeerConnection(peer, () => registration.currentPeer())
  return peer
}
