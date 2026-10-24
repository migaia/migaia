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
/** Allocate only the native listener's original membership and cleanup storage. */
function browserPortListenerState(
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
  const closing = undefined as Promise<void> | undefined
  return { scope, context, adopt, carrier, services, pending, closed, closing }
}

/** Own one native browser listener while the Host keeps accepted endpoint and directory ownership. */
class BrowserPortListener {
  /** Native membership, pending preparation and the one close receipt belong to this listener. */
  #state: ReturnType<typeof browserPortListenerState>
  /** Create storage before native callbacks can publish any accepted resource. */
  constructor(
    scope: IRuntimeBrowserListen,
    context: IAdapterDeploymentContext,
    adopt: IAdapterDeploymentAccept
  ) {
    this.#state = browserPortListenerState(scope, context, adopt)
  }
  /** Attach native acceptance and retain the original rollback and close semantics. */
  async open() {
    boundScopes.add(this.#state.scope)
    try {
      this.#state.scope.addEventListener(BrowserPeerEvent.connect, this.#accept)
      this.#state.context.signal?.addEventListener('abort', this.#cancel, { once: true })
      if (this.#state.context.signal?.aborted) await this.#close()
      return { close: this.#close }
    } catch (primary) {
      try {
        await this.#close()
      } catch (cleanup) {
        this.#report(cleanup)
      }
      throw primary
    }
  }
  /** Report asynchronous cleanup without replacing the exact opening failure. */
  #report = (error: unknown): void => {
    try {
      ;(this.#state.context.report ?? console.error)(error)
    } catch (failure) {
      hostRethrowReporter(failure, IpcReporterContext)
    }
  }
  /** Discard native resources retired by Core without duplicating accepted endpoint identity. */
  #active = (): readonly IBrowserListenerService[] => {
    for (const service of this.#state.services)
      if (service.channel.transport.closed) this.#state.services.delete(service)
    return [...this.#state.services]
  }
  /** Stop native acceptance before joining every cold preparation and accepted session cleanup. */
  #close = (): Promise<void> => {
    if (this.#state.closing) return this.#state.closing
    this.#state.closed = true
    this.#state.closing = Promise.resolve().then(async () => {
      /** Native cleanup attempts all registrations even when one remover fails. */
      const failures = collectListenerCleanupFailures([
        () => this.#state.scope.removeEventListener(BrowserPeerEvent.connect, this.#accept),
        () => this.#state.context.signal?.removeEventListener('abort', this.#cancel)
      ])
      boundScopes.delete(this.#state.scope)
      /** All cold resources and accepted Peers are retired; borrowed native ports remain open. */
      const results = await Promise.allSettled([
        ...[...this.#state.pending].map((accepting) => accepting.resource?.close()),
        ...[...this.#state.services].map((service) => service.session.peer.close()),
        ...[...this.#state.pending].map((accepting) => accepting.opening)
      ])
      for (const result of results) if (result.status === 'rejected') failures.push(result.reason)
      this.#state.services.clear()
      await drainTerminalListenerFailures(failures, {
        code: RpcCoreErrorCode.transport,
        message: BrowserPeerErrorText.listenerCleanupFailed
      })
    })
    return this.#state.closing
  }
  /** Join the same close transaction when caller cancellation ends listener lifetime. */
  #cancel = (): void => {
    void this.#close().catch(this.#report)
  }
  /**
   * Open each genuine SharedWorker port through its one canonical Core resource and adoption
   * receipt.
   */
  #accept = (event: IRuntimeBrowserConnectEvent): void => {
    if (this.#state.closed) return
    for (const port of event.ports) {
      /**
       * Native MessagePort queuing retains early data until this selected carrier starts its
       * reader.
       */
      const accepting: IBrowserPendingAccept = {
        opening: this.#state.carrier
          .then(async ({ createSharedWorkerTransport }) => {
            if (this.#state.closed) return
            /** Core owns the exact physical message resource from the first carrier subscription. */
            const resource = createEventTargetMessageResource(
              projectBrowserPeerPort(createSharedWorkerTransport(port))
            )
            accepting.resource = resource
            try {
              /** One deadline covers the original identity and ACK preparation phases. */
              const budget = createAdapterMessageHandshakeBudget(
                systemScheduler,
                this.#state.context.connectTimeoutMs
              )
              /** Native messages determine the remote identity before shared endpoint adoption. */
              const peerId = await resource.exchangeIdentity(
                this.#state.context,
                this.#state.context.signal,
                budget
              )
              /** The canonical resource owns agreement, codec, and physical control capture. */
              const channel = await resource.open({
                peerId,
                scheduler: systemScheduler,
                offer: this.#state.context.capabilities,
                control: rpcMessageCapabilityControl,
                signal: this.#state.context.signal,
                handshakeBudget: budget
              })
              /** Adoption borrows the host endpoint instead of constructing another peer endpoint. */
              const session = await (0, this.#state.adopt)(channel)
              if (this.#state.closed) {
                await session.peer.close()
                return
              }
              this.#active()
              this.#state.services.add({ channel, session })
            } catch (primary) {
              try {
                await resource.close()
              } catch (cleanup) {
                this.#report(cleanup)
              }
              throw primary
            }
          })
          .catch((failure: unknown) => {
            if (!this.#state.closed) this.#report(failure)
          })
          .finally(() => {
            this.#state.pending.delete(accepting)
          })
      }
      this.#state.pending.add(accepting)
      // Native accept callbacks cannot return an asynchronous failure to their event owner.
      void accepting.opening.catch(this.#report)
    }
  }
}

/** Attach the one native listener without creating another Host or endpoint. */
export async function listenBrowserPorts(
  scope: IRuntimeBrowserListen,
  context: IAdapterDeploymentContext,
  adopt: IAdapterDeploymentAccept
) {
  return new BrowserPortListener(scope, context, adopt).open()
}
