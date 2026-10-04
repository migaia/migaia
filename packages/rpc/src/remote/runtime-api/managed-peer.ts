import { createAbortController, type IAbortSignal } from '@migaia/lifecycle'
import type { IRemoteBinding, IRemoteServeEndpoint } from '../types.js'
import { createRemoteRuntimeRegistration, createRemoteGenerationHolder } from '../proxy.js'
import { compileRuntimeMethods } from './catalog.js'
import {
  createRuntimePeer,
  prepareRuntimePeerSourceContext,
  readRuntimePeerEndpoint,
  retainRuntimePeerConnection,
  type IRuntimePeerOptions,
  type IRuntimePeer
} from './peer.js'

/**
 * Original remote generation and resource owners prepare one platform binding without a v1
 * contract.
 */
export async function createManagedRuntimePeer<TUnit, TSpec>(
  options: IRuntimePeerOptions,
  binding: IRemoteBinding<TUnit, TSpec>,
  bindEndpoint?: (endpoint: IRemoteServeEndpoint, peer: IRuntimePeer) => IRemoteServeEndpoint,
  signal: IAbortSignal = createAbortController().signal
): Promise<IRuntimePeer> {
  compileRuntimeMethods(options.provide)
  /** Safe configuration admission precedes supervisor.start and any native launcher side effect. */
  const context = prepareRuntimePeerSourceContext(options.self)
  /** This is the original canonical current/leave/ready owner, shared with existing remote facades. */
  const registration = createRemoteRuntimeRegistration({
    binding,
    report: options.report,
    prepareRuntime: (channel, preparationSignal) =>
      createRuntimePeer(
        {
          self: context.self,
          provide: options.provide,
          providerLimits: options.providerLimits,
          report: options.report
        },
        {
          self: context.self,
          source: async () => channel,
          ownsChannel: false,
          signal: preparationSignal
        }
      ),
    readRuntimeEndpoint: (peer) => {
      /** Native health/drain receives the actual endpoint, never a synthetic successful ping. */
      const endpoint = readRuntimePeerEndpoint(peer)
      return bindEndpoint ? bindEndpoint(endpoint, peer) : endpoint
    }
  })
  /** Every startup/rebind disposer joins the original holder's exact generation resource group. */
  const holder = createRemoteGenerationHolder(registration, options.report)
  try {
    await holder.prepareInitial(signal, true)
  } catch (primary) {
    try {
      await holder.release()
    } catch (cleanup) {
      options.report(cleanup)
    }
    throw primary
  }
  /** Only the true accepted generation supplies identity and directory metadata for publication. */
  const prepared = registration.currentPeer()
  /** Calls preserve the original current-generation operation Promise and stream iterator. */
  const peer: IRuntimePeer = Object.freeze({
    self: context.self,
    request: (method, payload, callOptions) =>
      registration.currentPeer().request(method, payload, callOptions),
    notify: (method, payload, callOptions) =>
      registration.currentPeer().notify(method, payload, callOptions),
    stream: (method, payload, callOptions) =>
      registration.currentPeer().stream(method, payload, callOptions),
    describe: () => prepared.describe(),
    close: () => holder.release()
  })
  retainRuntimePeerConnection(peer, prepared)
  return peer
}
