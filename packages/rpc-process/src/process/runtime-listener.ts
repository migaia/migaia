import {
  prepareAdapterPeer,
  type IAdapterPeerPreparation,
  type IAdapterListenerService
} from '@migaia/rpc-core/adapter'
import {
  RuntimePluginKey,
  type IRuntimePeer,
  type IRuntimePeerOptions
} from '@migaia/rpc-core/remote'
import { systemScheduler } from '@migaia/utils/scheduler'
import { ProcessPluginChannelKind } from './plugin/constants.js'
import { serveProcessSessions, type IProcessSessionsHandle } from './plugin/serve.js'
import type { IProcessServeListenerIngress } from './plugin/types.js'
import { reportSafely } from './plugin/binding.js'
import { createProcessResilience } from './resilience/index.js'
import type { IProcessResilience } from './resilience/types.js'
import { resolveNativeProcessRuntimeOffer } from './offer.js'

/** Native ingress keeps its caller-selected governor while Core owns runtime session assembly. */
export type IRuntimeProcessListen = IProcessServeListenerIngress &
  Readonly<{ resilience?: IProcessResilience }>

/**
 * Preserve the original native listener/session Set and rollback while using opaque Core
 * operations.
 */
export async function createProcessListenerPeer(
  options: IRuntimePeerOptions,
  ingress: IRuntimeProcessListen,
  preparation?: IAdapterPeerPreparation
): Promise<IRuntimePeer> {
  /** Direct native listeners obtain the same opaque Core owner as the deployed source path. */
  const prepared =
    preparation ?? prepareAdapterPeer(options, RuntimePluginKey.process).withoutTransfer()
  /** Core's installed local roots fill omitted defaults; explicit caller proposals stay narrow. */
  const offer = resolveNativeProcessRuntimeOffer(ingress.offer, prepared.context.capabilities)
  /** The canonical local directory and native handshake share the same actual local proposal. */
  const listener = prepared.listener(offer.capabilities)
  /** Only this construction closes a default governor it created. */
  const resilience =
    ingress.resilience ??
    createProcessResilience({
      scheduler: ingress.scheduler ?? systemScheduler,
      report: options.report
    })
  /** Original early Host ownership covers bind and in-progress candidates. */
  let closeSessions: (() => Promise<void>) | undefined
  /** Callable close preserves the original complete native-session cleanup Promise. */
  const close = (): Promise<void> => closeSessions!()
  /** This original native owner remains the only active-membership collection. */
  let sessions: IProcessSessionsHandle
  try {
    sessions = await serveProcessSessions(
      { ...ingress, offer },
      undefined,
      (session) => session.runtime!.peer(),
      resilience,
      options.report,
      undefined,
      ingress.scheduler ?? systemScheduler,
      {
        signal: prepared.lifecycleSignal,
        initialSignal: prepared.initialSignal,
        providerLimits: options.providerLimits,
        own: (dispose) => {
          closeSessions = dispose
          prepared.own({ close })
        },
        publish: (service) => listener.publish(service as IAdapterListenerService),
        ...(!ingress.resilience ? { release: () => resilience.close() } : {})
      },
      listener
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
  return listener.open({
    carrier: ProcessPluginChannelKind.byte,
    current: () => sessions.current() as IAdapterListenerService | null | undefined,
    services: () => sessions.services() as readonly IAdapterListenerService[],
    closed: sessions.closed,
    close
  })
}
