/** Borrow native connect events and retire exact Host handles on either close outcome. */
import type { IRpcTransportSetupContext } from '@migaia/rpc-host/sdk'
import type { IRpcSessionHandle } from '@migaia/rpc-contract/interfaces'
import { attachErrorIdentity } from '@migaia/utils/error'
import {
  RpcCoreErrorCode,
  RpcBrowserErrorCode,
  RPC_ENDPOINT_ERROR_SOURCE
} from '@migaia/rpc-contract/error-code'
import { BrowserPeerErrorText } from '../error-text.js'
import { normalizeBrowserHandshakeFailure } from './error.js'
import { createBrowserPeerError } from './peer-error.js'
import { BrowserPeerEvent } from './peer-text.js'
import { createSharedWorkerCarrier } from './adapters/shared-worker.js'
import type { IRuntimeBrowserListen, IRuntimeBrowserConnectEvent } from './peer-types.js'

/** The native connect scope can have only one active accept owner, as before this migration. */
const boundScopes = new WeakSet<object>()

/** Each accepted native port remains borrowed; Host owns its handshake and every work table. */
class BrowserPortListener {
  /** Exact native registration is retained for original listener removal. */
  readonly #scope: IRuntimeBrowserListen
  /** The installed host is the sole source of attach, detach, cancellation and reporting. */
  readonly #context: IRpcTransportSetupContext
  /** Original native port membership stores only actual Host lifecycle handles. */
  readonly #sessions = new Set<IRpcSessionHandle>()
  /** Publishing this Promise first makes concurrent and reentrant cleanup join one operation. */
  #closing: Promise<void> | undefined

  /** Admit one native scope before installing the same original connect callback. */
  constructor(scope: IRuntimeBrowserListen, context: IRpcTransportSetupContext) {
    if (boundScopes.has(scope))
      throw createBrowserPeerError(
        RpcBrowserErrorCode.listenerAlreadyBound,
        BrowserPeerErrorText.listenerAlreadyBound
      )
    this.#scope = scope
    this.#context = context
    boundScopes.add(scope)
    try {
      scope.addEventListener(BrowserPeerEvent.connect, this.#accept)
    } catch (primary) {
      boundScopes.delete(scope)
      throw primary
    }
  }
  /** Native connect supplies actual ports, never accepted identity from payload metadata. */
  readonly #accept = (event: IRuntimeBrowserConnectEvent): void => {
    if (this.#closing) return
    try {
      for (const port of event.ports) {
        /** Each native port creates precisely one real Session. */
        const carrier = createSharedWorkerCarrier(port, this.#context)
        /** Failed Host admission must release this exact acquired native listener set. */
        let handle: IRpcSessionHandle
        try {
          handle = this.#context.attach(carrier)
        } catch (primary) {
          void carrier.close(primary).catch(this.#context.report)
          throw primary
        }
        this.#sessions.add(handle)
        void handle.closed.then(
          () => this.#sessions.delete(handle),
          (error: unknown) => {
            this.#sessions.delete(handle)
            this.#context.report(error)
          }
        )
        void handle.ready.catch((error: unknown) => {
          /** Session reports local failures; only a received remote reject lacks that reporter. */
          if (handle.handshakeFailure) this.#context.report(normalizeBrowserHandshakeFailure(error))
        })
      }
    } catch (error) {
      this.#context.report(error)
    }
  }
  /** Remove the native accept listener before joining every exact Host retirement. */
  readonly close = (): Promise<void> =>
    (this.#closing ??= Promise.resolve().then(async () => {
      /** Cleanup attempts all original resources even when native listener removal throws. */
      const failures: unknown[] = []
      try {
        this.#scope.removeEventListener(BrowserPeerEvent.connect, this.#accept)
      } catch (error) {
        failures.push(error)
      }
      /** Snapshotting keeps a synchronously retiring handle from changing the cleanup iteration. */
      const handles = [...this.#sessions]
      /** Start every original detach eagerly in the same native acceptance order. */
      const pending: Promise<void>[] = []
      for (const handle of handles) pending.push(this.#context.detach(handle))
      /** All original results retain their index without a nested callback component. */
      const results = await Promise.allSettled(pending)
      for (const result of results) if (result.status === 'rejected') failures.push(result.reason)
      this.#sessions.clear()
      boundScopes.delete(this.#scope)
      if (failures.length === 1) throw failures[0]
      if (failures.length > 1)
        throw attachErrorIdentity(
          new AggregateError(failures, BrowserPeerErrorText.listenerCleanupFailed, {
            cause: failures[0]
          }),
          { source: RPC_ENDPOINT_ERROR_SOURCE, code: RpcCoreErrorCode.transport }
        )
    }))
}

/** Install one original native accept owner without another host, directory or request facade. */
export function listenBrowserPorts(
  scope: IRuntimeBrowserListen,
  context: IRpcTransportSetupContext
) {
  /** This native installation has a single independent cleanup owner. */
  const listener = new BrowserPortListener(scope, context)
  return { dispose: listener.close }
}
