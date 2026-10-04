import { systemScheduler } from '@migaia/utils/scheduler'
import { RpcCoreErrorCode, RpcError } from '../core/errors.js'
import { RuntimeApiErrorText } from '../remote/runtime-api/constants.js'
import { compileRuntimeMethods } from '../remote/runtime-api/catalog.js'
import {
  createRuntimePeer,
  prepareRuntimePeerEndpoint,
  retainRuntimePeerSessions,
  type IRuntimePeer,
  type IRuntimePeerOptions
} from '../remote/runtime-api/peer.js'
import type { IRuntimePreparationContext } from '../remote/runtime-api/launch-context.js'
import type { IRemoteServePluginHandle } from '../remote/serve-plugin.js'
import { serveProcessSessions, type IProcessSessionsHandle } from './plugin/serve.js'
import type { IProcessServeListenerIngress } from './plugin/types.js'
import { reportSafely } from './plugin/binding.js'
import { createProcessResilience } from './resilience/index.js'
import type { IProcessResilience } from './resilience/types.js'

/** The original authenticated ingress retains its caller-selected connection governor. */
export type IRuntimeProcessListen = IProcessServeListenerIngress &
  Readonly<{ resilience?: IProcessResilience }>

/** Each original service record holds its genuine callable Peer, without another session index. */
type IRuntimeProcessService = IRemoteServePluginHandle & Readonly<{ peer: IRuntimePeer }>

/** Reuse the original listener, authentication, quota, admission and drain ownership for v2 routes. */
export async function createProcessListenerPeer(
  options: IRuntimePeerOptions,
  ingress: IRuntimeProcessListen,
  preparation?: IRuntimePreparationContext
): Promise<IRuntimePeer> {
  compileRuntimeMethods(options.provide, options.contract)
  /** This governor is closed only when this construction created it. */
  const resilience =
    ingress.resilience ??
    createProcessResilience({
      scheduler: ingress.scheduler ?? systemScheduler,
      report: options.report
    })
  /** Early original scope ownership covers listener bind and accepted candidates. */
  let closeSessions: (() => Promise<void>) | undefined
  /** Public close returns the original session owner's complete cleanup Promise unchanged. */
  const close = (): Promise<void> => closeSessions!()
  /** The sole native owner keeps membership, readiness and pending accepts. */
  let sessions: IProcessSessionsHandle
  try {
    sessions = await serveProcessSessions(
      ingress,
      (channel, signal, session) =>
        prepareRuntimePeerEndpoint(options, channel, signal, {
          idempotency: session.idempotency,
          providerLimits: session.limits
        }),
      async ({ channel, endpoint, signal }): Promise<IRuntimeProcessService> => {
        /** Each actual accept captures current Feature output guards through the original Host. */
        const peer = await createRuntimePeer(
          { ...options, provide: preparation?.readProvide?.() ?? options.provide },
          { self: options.self!, source: async () => channel, ownsChannel: false, signal, endpoint }
        )
        return Object.freeze({ peer, close: peer.close })
      },
      resilience,
      options.report,
      undefined,
      ingress.scheduler ?? systemScheduler,
      {
        signal: preparation?.lifecycleSignal,
        initialSignal: preparation?.initialSignal,
        providerLimits: options.providerLimits,
        own: (dispose) => {
          closeSessions = dispose
          preparation?.own(close)
        },
        publish: (service) =>
          preparation?.publishPeer?.((service as IRuntimeProcessService).peer) ?? (() => undefined),
        ...(!ingress.resilience ? { release: () => resilience.close() } : {})
      }
    )
  } catch (primary) {
    try {
      if (closeSessions) await closeSessions()
      else if (!ingress.resilience) await resilience.close()
    } catch (cleanup) {
      reportSafely(options.report, cleanup)
    }
    throw primary
  }
  /** An implicit direct target is valid only for exactly one actual active native session. */
  const current = (): IRuntimePeer => {
    /** This read projects the original Set; it cannot choose a winner among active sessions. */
    const service = sessions.current() as IRuntimeProcessService | null | undefined
    if (!service)
      throw new RpcError(
        service === null ? RpcCoreErrorCode.capabilityConflict : RpcCoreErrorCode.targetUnknown,
        service === null ? RuntimeApiErrorText.targetAmbiguous : RuntimeApiErrorText.targetUnknown
      )
    return service.peer
  }
  /** Calls retain the real accepted Peer operation Promise and stream iterator. */
  const peer: IRuntimePeer = Object.freeze({
    self: options.self!,
    request: (method, payload, callOptions) => current().request(method, payload, callOptions),
    notify: (method, payload, callOptions) => current().notify(method, payload, callOptions),
    stream: (method, payload, callOptions) => current().stream(method, payload, callOptions),
    describe: () => current().describe(),
    close
  })
  retainRuntimePeerSessions(peer, () =>
    sessions.services().map((service) => (service as IRuntimeProcessService).peer)
  )
  return peer
}
