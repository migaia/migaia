import { type IRuntimePeerOptions } from '@migaia/rpc-host/plugin'
import { systemScheduler } from '@migaia/utils/scheduler'
import { serveProcessSessions } from './plugin/serve.js'
import type { IProcessServeListenerIngress } from './plugin/types.js'
import { createProcessResilience } from './resilience/index.js'
import type { IProcessResilience } from './resilience/types.js'
import { resolveNativeProcessRuntimeOffer } from './offer.js'
/** Native ingress keeps its caller-selected governor while Core owns runtime session assembly. */
export type IRuntimeProcessListen = IProcessServeListenerIngress &
  Readonly<{ resilience?: IProcessResilience }>

/** Admit actual native sessions into the host endpoint while the original listener owns cleanup. */
export async function openProcessListenerDeployment(
  options: IRuntimePeerOptions,
  ingress: IRuntimeProcessListen,
  context: import('@migaia/rpc-host/plugin').IAdapterDeploymentContext,
  accept: import('@migaia/rpc-host/plugin').IAdapterDeploymentAccept
): Promise<import('@migaia/rpc-host/plugin').IAdapterDeploymentListener> {
  /** Native policy defaults retain the same scheduler and diagnostics owner as the original path. */
  const report = options.report ?? context.report
  const offer = resolveNativeProcessRuntimeOffer(ingress.offer, context.capabilities)
  const resilience =
    ingress.resilience ??
    createProcessResilience({
      scheduler: ingress.scheduler ?? systemScheduler,
      report
    })
  const sessions = await serveProcessSessions(
    { ...ingress, offer },
    undefined,
    async (session) => ({ close: () => session.accepted!.peer.close() }),
    resilience,
    report,
    undefined,
    ingress.scheduler ?? systemScheduler,
    {
      initialSignal: context.signal,
      providerLimits: options.providerLimits,
      handshakeTimeoutMs: context.connectTimeoutMs,
      ...(!ingress.resilience ? { release: () => resilience.close() } : {})
    },
    undefined,
    accept
  )
  return { close: sessions.close }
}
