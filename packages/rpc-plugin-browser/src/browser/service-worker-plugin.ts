import {
  createAdapterDeployment,
  createAdapterMessageHandshakeBudget,
  createEventTargetMessageResource,
  defineTransportPlugin,
  type IAdapterDeploymentAccept,
  type IAdapterDeploymentContext,
  type IAdapterMessageResource,
  type IRuntimePeerSourceResult,
  type IRpcTransportPlugin
} from '@migaia/rpc-host/plugin'
import { rpcMessageCapabilityControl } from '@migaia/rpc-contract/runtime'
import { systemScheduler } from '@migaia/utils/scheduler'
import { createServiceWorkerTransport } from './adapters/service-worker.js'
import type {
  IServiceWorkerMessageReceiver,
  IServiceWorkerMessageTarget
} from './adapters/service-worker.js'
import { projectBrowserPeerPort } from './peer-port.js'
import { createBrowserPeerError } from './peer-error.js'
import { createBrowserTransportError } from './error.js'
import { BrowserRpcErrorText } from './error-text.js'
import { BrowserPeerErrorText } from '../error-text.js'
import { RpcBrowserErrorCode } from '../error-code.js'
import { BrowserPeerEvent } from './peer-text.js'
import { ServiceWorkerPluginText } from './service-worker-text.js'
import type {
  IServiceWorkerClientEvent,
  IServiceWorkerClientsScope,
  IServiceWorkerPluginOptions
} from './service-worker-types.js'

/** The native Client, not the application envelope, selects one raw preparation and listener set. */
type IServiceWorkerClientSession = {
  resource?: IAdapterMessageResource
  opening: Promise<void>
  listeners: Set<(event: MessageEvent<unknown>) => void>
}

/** Native borrowed targets expose only postMessage; receiver subscription is a separate operation. */
function isTarget(value: unknown): value is IServiceWorkerMessageTarget {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof Reflect.get(value, 'postMessage') === 'function'
  )
}

/** A missing page container rejects synchronously, before any message or native subscription. */
function isReceiver(value: unknown): value is IServiceWorkerMessageReceiver {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof Reflect.get(value, 'addEventListener') === 'function' &&
    typeof Reflect.get(value, 'removeEventListener') === 'function'
  )
}

/** The same original initial/ACK owner consumes the SDK's one finite preparation budget. */
async function openResource(
  resource: IAdapterMessageResource,
  context: IAdapterDeploymentContext,
  first?: () => void
): Promise<IRuntimePeerSourceResult> {
  /** Initial exchange and capability acceptance share the same absolute deadline. */
  const budget = createAdapterMessageHandshakeBudget(systemScheduler, context.connectTimeoutMs)
  try {
    /** Capture attaches synchronously before the first held native event is replayed. */
    const identity = resource.exchangeIdentity(context, context.signal, budget)
    first?.()
    /** The accepted peer identity comes only from this source-filtered raw handshake. */
    const peerId = await identity
    return await resource.open({
      peerId,
      scheduler: systemScheduler,
      offer: context.capabilities,
      control: rpcMessageCapabilityControl,
      signal: context.signal,
      handshakeBudget: budget
    })
  } catch (primary) {
    try {
      await resource.close()
    } catch (cleanup) {
      context.report(cleanup)
    }
    throw primary
  }
}

/** Each native Client owns its original raw resource; Host remains the sole endpoint/session owner. */
function listenClients(
  scope: IServiceWorkerClientsScope,
  context: IAdapterDeploymentContext,
  accept: IAdapterDeploymentAccept
) {
  /**
   * This map routes native Client events only; it stores no provider directory or endpoint
   * identity.
   */
  const sessions = new Map<string, IServiceWorkerClientSession>()
  /** Closing stops native acceptance before joining the existing raw preparation operations. */
  let closed = false
  /** Concurrent Host cleanup joins the same subscription/resource retirement Promise. */
  let closing: Promise<void> | undefined
  /** Native callbacks report preparation failures without replacing their actual error object. */
  const report = (error: unknown): void => context.report(error)
  /** Dispatch preserves original event/source metadata until the canonical sourceProof projection. */
  const dispatch = (
    session: IServiceWorkerClientSession,
    event: IServiceWorkerClientEvent
  ): void => {
    /** Native dispatch must not also invoke a receiver installed during this frame's handoff. */
    const listeners = [...session.listeners]
    for (const listener of listeners) listener(event)
  }
  /** A genuine worker event supplies Client.id; wire-level ids cannot choose a different resource. */
  const onMessage = (event: IServiceWorkerClientEvent): void => {
    if (closed) return
    try {
      /** Native source identity is read once before selecting or constructing any capture owner. */
      const source = event.source
      const id = source && Reflect.get(source, 'id')
      if (typeof id !== 'string' || id.length === 0) return
      /** Existing accepted and preparing sessions retain their original native resource. */
      let session = sessions.get(id)
      if (session) dispatch(session, event)
      else {
        /**
         * The original first native event is held only until Clients.get resolves its actual
         * target.
         */
        const created: IServiceWorkerClientSession = {
          listeners: new Set(),
          opening: Promise.resolve()
        }
        session = created
        sessions.set(id, created)
        created.opening = Promise.resolve()
          .then(async () => {
            /** Native Clients is the authority for the current addressable reply object. */
            const client = await scope.clients.get(id)
            if (closed || !isTarget(client) || client.id !== id) {
              if (sessions.get(id) === created) sessions.delete(id)
              return
            }
            /** Separate receiver operations expose only this native Client's filtered events. */
            const receiver: IServiceWorkerMessageReceiver = {
              addEventListener: (_type, listener) => created.listeners.add(listener),
              removeEventListener: (_type, listener) => created.listeners.delete(listener)
            }
            /** Existing sourceProof rejects mismatched native Client metadata before raw capture. */
            const resource = createEventTargetMessageResource(
              projectBrowserPeerPort(
                createServiceWorkerTransport({ target: client, receiver, peerId: id })
              )
            )
            created.resource = resource
            /** Core owns handshake, accepted capabilities and the one Host endpoint's new session. */
            const channel = await openResource(resource, context, () => dispatch(created, event))
            if (closed) {
              await channel.close?.()
              return
            }
            await accept(channel)
          })
          .catch(async (error: unknown) => {
            if (sessions.get(id) === created) sessions.delete(id)
            try {
              await created.resource?.close()
            } catch (cleanup) {
              report(cleanup)
            }
            if (!closed) report(error)
          })
      }
      /** Native lifetime extension joins this Client's real preparation; no extra keepalive exists. */
      event.waitUntil?.(session.opening)
    } catch (cause) {
      report(createBrowserTransportError(BrowserRpcErrorText.serviceWorkerSourceReadFailed, cause))
    }
  }
  scope.addEventListener(BrowserPeerEvent.message, onMessage)
  return {
    /**
     * Host close removes listeners/resources but never terminates the borrowed native
     * worker/client.
     */
    close: (): Promise<void> => {
      if (closing) return closing
      closed = true
      scope.removeEventListener(BrowserPeerEvent.message, onMessage)
      closing = Promise.allSettled([
        ...[...sessions.values()].map((session) => session.resource?.close()),
        ...[...sessions.values()].map((session) => session.opening)
      ]).then((results) => {
        sessions.clear()
        for (const result of results) if (result.status === 'rejected') report(result.reason)
      })
      return closing
    }
  }
}

/** Define a cold page-to-worker or native Clients listener without creating a complete Peer. */
export function serviceWorkerPlugin(options: IServiceWorkerPluginOptions): IRpcTransportPlugin {
  /** Invalid or conflicting sources retain the browser package's original synchronous admission. */
  const configured = options as IServiceWorkerPluginOptions | undefined
  const target = configured?.serviceWorker
  const clients = configured?.clients
  /**
   * The native container receives replies; the ServiceWorker target itself never receives
   * listeners.
   */
  const receiver =
    configured?.receiver ??
    (globalThis as unknown as { navigator?: { serviceWorker?: IServiceWorkerMessageReceiver } })
      .navigator?.serviceWorker
  if (
    (target !== undefined) === (clients !== undefined) ||
    (target !== undefined && (!isTarget(target) || !isReceiver(receiver))) ||
    (clients !== undefined &&
      (!isReceiver(clients) ||
        typeof clients.clients?.get !== 'function' ||
        configured?.receiver !== undefined))
  )
    throw createBrowserPeerError(
      RpcBrowserErrorCode.invalidPeerSource,
      BrowserPeerErrorText.invalidPeerSource
    )
  /** A cold recipe borrows its exact original native target and opens only canonical raw resources. */
  const deployment = createAdapterDeployment({
    runtimeKey: 'thread',
    runtimeFamily: createServiceWorkerTransport,
    open: (context) =>
      openResource(
        createEventTargetMessageResource(
          projectBrowserPeerPort(
            createServiceWorkerTransport({ target: target!, receiver: receiver! })
          )
        ),
        context
      ),
    ...(clients
      ? { listen: async (context, accept) => listenClients(clients, context, accept) }
      : {})
  })
  return defineTransportPlugin({
    name: configured!.name ?? ServiceWorkerPluginText.name,
    mode: clients ? 'listen' : 'connect',
    ...(configured!.expose ? { expose: configured!.expose } : {}),
    ...(configured!.connect ? { connect: configured!.connect } : {}),
    deployment
  })
}
