import type { IRuntimePeer } from '@migaia/rpc-core/remote'
import {
  captureAdapterTask,
  createEventTargetMessageResource,
  readAdapterAbortReason,
  IpcReporterContext,
  type IAdapterListenerPreparation,
  type IAdapterMessageResource
} from '@migaia/rpc-core/adapter/internal-advanced'
import {
  collectListenerCleanupFailures,
  drainTerminalListenerFailures,
  RpcPlatform
} from '@migaia/rpc-core/transport-kit'
import { RpcCoreErrorCode } from '@migaia/rpc-core'
import { systemScheduler } from '@migaia/utils/scheduler'
import { hostRethrowReporter } from '@migaia/utils/promise'
import { BrowserPeerErrorText } from '../error-text.js'
import { RpcBrowserErrorCode } from '../error-code.js'
import { createBrowserPeerError } from './peer-error.js'
import { BrowserPeerEvent, BrowserPeerText } from './peer-text.js'
import { getBrowserMessageAdapter } from './peer-adapter.js'
import { projectBrowserPeerPort } from './peer-port.js'
import type { IRuntimeBrowserPeerOptions, IRuntimeBrowserConnectEvent } from './peer-types.js'

/** A concrete native connect scope may have only one active Runtime Peer accept owner. */
const boundScopes = new WeakSet<object>()

/**
 * Core creates this service and its exact transport-retirement observer; browser tracks native
 * membership.
 */
type IBrowserListenerService = Awaited<ReturnType<IAdapterListenerPreparation['messageSession']>>

/**
 * One native accept retains its loader operation and the held Core resource once construction
 * begins.
 */
type IBrowserPendingAccept = { resource?: IAdapterMessageResource; opening: Promise<void> }

/**
 * Attach SharedWorker acceptance while Core retains negotiation, directory, dispatch and event
 * semantics.
 */
export async function createBrowserListenerPeer(
  options: IRuntimeBrowserPeerOptions
): Promise<IRuntimePeer> {
  /** The worker's native connect scope is borrowed and never terminated by listener cleanup. */
  const scope = options.listen
  if (
    !scope ||
    typeof scope !== 'object' ||
    typeof scope.addEventListener !== 'function' ||
    typeof scope.removeEventListener !== 'function'
  )
    throw createBrowserPeerError(
      RpcBrowserErrorCode.invalidPeerSource,
      BrowserPeerErrorText.invalidPeerSource
    )
  if (boundScopes.has(scope))
    throw createBrowserPeerError(
      RpcBrowserErrorCode.listenerAlreadyBound,
      BrowserPeerErrorText.listenerAlreadyBound
    )
  if (options.signal?.aborted) throw readAdapterAbortReason(options.signal)
  /**
   * Capture original options before loading the carrier, matching the existing native adapter
   * structure.
   */
  const task = captureAdapterTask(getBrowserMessageAdapter(), options, BrowserPeerText.name)
  /** Existing Core listener assembly owns all callable and zero/one/many selection behavior. */
  const listener = task.listener(task.preparation.context.capabilities)
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
      ;(options.report ?? console.error)(error)
    } catch (failure) {
      hostRethrowReporter(failure, IpcReporterContext)
    }
  }
  /**
   * Native resource retirement determines active sessions; browser never claims accepted Peer
   * identity.
   */
  const active = (): readonly IBrowserListenerService[] => {
    for (const service of services) if (service.closed()) services.delete(service)
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
        () => options.signal?.removeEventListener('abort', cancel)
      ])
      boundScopes.delete(scope)
      /** All cold resources and accepted Peers are retired; borrowed native ports remain open. */
      const results = await Promise.allSettled([
        ...[...pending].map((accepting) => accepting.resource?.close()),
        ...[...services].map((service) => service.close()),
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
            /** Core alone receives initial/ACK control and creates a genuine listener-owned service. */
            const service = await listener.messageSession(resource, {
              scheduler: systemScheduler,
              signal: options.signal
            })
            if (closed) {
              await service.close()
              return
            }
            active()
            services.add(service)
            listener.publish(service)
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
    options.signal?.addEventListener('abort', cancel, { once: true })
    if (options.signal?.aborted) await close()
    task.preparation.own({ close })
    return listener.open({
      carrier: RpcPlatform.worker,
      current: () => {
        /** Canonical ambiguity remains explicit when more than one page is connected. */
        const peers = active()
        return peers.length > 1 ? null : peers[0]
      },
      services: active,
      closed: () => closed,
      close
    })
  } catch (primary) {
    try {
      await close()
    } catch (cleanup) {
      report(cleanup)
    }
    throw primary
  }
}
