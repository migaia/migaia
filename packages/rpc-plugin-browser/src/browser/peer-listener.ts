import {
  createAdapterMessageHandshakeBudget,
  createEventTargetMessageResource,
  readAdapterAbortReason,
  IpcReporterContext,
  type IAdapterDeploymentContext,
  type IAdapterDeploymentAccept,
  type IAdapterDeploymentAcceptedSession,
  type IRuntimePeerSourceResult,
  type IAdapterMessageResource
} from '@migaia/rpc-host/plugin'
import {
  collectListenerCleanupFailures,
  drainTerminalListenerFailures
} from '@migaia/rpc-host/plugin'
import { RpcCoreErrorCode } from '@migaia/rpc-host'
import { systemScheduler } from '@migaia/utils/scheduler'
import { hostRethrowReporter } from '@migaia/utils/promise'
import { BrowserPeerErrorText } from '../error-text.js'
import { RpcBrowserErrorCode } from '../error-code.js'
import { createBrowserPeerError } from './peer-error.js'
import { BrowserPeerEvent } from './peer-text.js'
import { rpcMessageCapabilityControl } from '@migaia/rpc-contract/runtime'
import { projectBrowserPeerPort } from './peer-port.js'
import type { IRuntimeBrowserListen, IRuntimeBrowserConnectEvent } from './peer-types.js'

/** A concrete native connect scope may have only one active Runtime Peer accept owner. */
const boundScopes = new WeakSet<object>()

/**
 * Core creates this service and its exact transport-retirement observer; browser tracks native
 * membership.
 */
type IBrowserListenerService = Readonly<{
  channel: IRuntimePeerSourceResult
  session: IAdapterDeploymentAcceptedSession
}>

/**
 * One native accept retains its loader operation and the held Core resource once construction
 * begins.
 */
type IBrowserPendingAccept = { resource?: IAdapterMessageResource; opening: Promise<void> }

/**
 * Attach SharedWorker acceptance while Core retains negotiation, directory, dispatch and event
 * semantics.
 */
export async function listenBrowserPorts(
  scope: IRuntimeBrowserListen,
  context: IAdapterDeploymentContext,
  adopt: IAdapterDeploymentAccept
) {
  if (boundScopes.has(scope))
    throw createBrowserPeerError(
      RpcBrowserErrorCode.listenerAlreadyBound,
      BrowserPeerErrorText.listenerAlreadyBound
    )
  if (context.signal?.aborted) throw readAdapterAbortReason(context.signal)
  /** The selected carrier loads lazily while the native connect hook attaches before any yield. */
  const carrier = import('./adapters/shared-worker.js')
  /** Native membership remains in one owner; closed services are filtered using Core's held output. */
  const services = new Set<IBrowserListenerService>()
  /**
   * Incomplete accepts retain their actual held resources so listener close also releases cold
   * capture.
   */
  const pending = new Set<IBrowserPendingAccept>()
  /** Close prevents later native accepts from acquiring a new Core resource. */
  let closed = false
  /** Repeated close and asyncDispose retain one complete cleanup Promise. */
  let closing: Promise<void> | undefined
  /** Reporting isolates cleanup observers without replacing the exact opening failure. */
  const report = (error: unknown): void => {
    try {
      ;(context.report ?? console.error)(error)
    } catch (failure) {
      hostRethrowReporter(failure, IpcReporterContext)
    }
  }
  /**
   * Native resource retirement determines active sessions; browser never claims accepted Peer
   * identity.
   */
  const active = (): readonly IBrowserListenerService[] => {
    for (const service of services) if (service.channel.transport.closed) services.delete(service)
    return [...services]
  }
  /** Stop native acceptance before joining all existing session and opening cleanup. */
  const close = (): Promise<void> => {
    if (closing) return closing
    closed = true
    closing = Promise.resolve().then(async () => {
      /** Native cleanup attempts all registrations even when one remover fails. */
      const failures = collectListenerCleanupFailures([
        () => scope.removeEventListener(BrowserPeerEvent.connect, accept),
        () => context.signal?.removeEventListener('abort', cancel)
      ])
      boundScopes.delete(scope)
      /** All cold resources and accepted Peers are retired; borrowed native ports remain open. */
      const results = await Promise.allSettled([
        ...[...pending].map((accepting) => accepting.resource?.close()),
        ...[...services].map((service) => service.session.peer.close()),
        ...[...pending].map((accepting) => accepting.opening)
      ])
      for (const result of results) if (result.status === 'rejected') failures.push(result.reason)
      services.clear()
      await drainTerminalListenerFailures(failures, {
        code: RpcCoreErrorCode.transport,
        message: BrowserPeerErrorText.listenerCleanupFailed
      })
    })
    return closing
  }
  /** Caller cancellation joins the same listener cleanup owner and reports its observable failure. */
  const cancel = (): void => {
    void close().catch(report)
  }
  /** Each real connect event supplies a separate one-to-one port to the exact Core resource factory. */
  const accept = (event: IRuntimeBrowserConnectEvent): void => {
    if (closed) return
    for (const port of event.ports) {
      /**
       * Native MessagePort queuing retains early data until this selected carrier starts its
       * reader.
       */
      const accepting: IBrowserPendingAccept = {
        opening: carrier
          .then(async ({ createSharedWorkerTransport }) => {
            if (closed) return
            /** Core owns the exact physical message resource from the first carrier subscription. */
            const resource = createEventTargetMessageResource(
              projectBrowserPeerPort(createSharedWorkerTransport(port))
            )
            accepting.resource = resource
            try {
              /** One deadline covers the original identity and ACK preparation phases. */
              const budget = createAdapterMessageHandshakeBudget(
                systemScheduler,
                context.connectTimeoutMs
              )
              /** Native messages determine the remote identity before shared endpoint adoption. */
              const peerId = await resource.exchangeIdentity(context, context.signal, budget)
              /** The canonical resource owns agreement, codec, and physical control capture. */
              const channel = await resource.open({
                peerId,
                scheduler: systemScheduler,
                offer: context.capabilities,
                control: rpcMessageCapabilityControl,
                signal: context.signal,
                handshakeBudget: budget
              })
              /** Adoption borrows the host endpoint instead of constructing another peer endpoint. */
              const session = await adopt(channel)
              if (closed) {
                await session.peer.close()
                return
              }
              active()
              services.add({ channel, session })
            } catch (primary) {
              try {
                await resource.close()
              } catch (cleanup) {
                report(cleanup)
              }
              throw primary
            }
          })
          .catch((failure: unknown) => {
            if (!closed) report(failure)
          })
          .finally(() => {
            pending.delete(accepting)
          })
      }
      pending.add(accepting)
      // Native accept callbacks cannot return an asynchronous failure to their event owner.
      void accepting.opening.catch(report)
    }
  }
  boundScopes.add(scope)
  try {
    scope.addEventListener(BrowserPeerEvent.connect, accept)
    context.signal?.addEventListener('abort', cancel, { once: true })
    if (context.signal?.aborted) await close()
    return { close }
  } catch (primary) {
    try {
      await close()
    } catch (cleanup) {
      report(cleanup)
    }
    throw primary
  }
}
