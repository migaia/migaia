/** Acquire borrowed ServiceWorker endpoints and retire only their exact native Client routes. */
import { defineTransportPlugin } from '@migaia/rpc-host/sdk'
import type {
  IRpcTransportPlugin,
  IRpcTransportSetupContext,
  IRpcTransportFeatureExtensions
} from '@migaia/rpc-host/sdk'
import type { IRpcSessionHandle } from '@migaia/rpc-contract/interfaces'
import {
  RpcBrowserErrorCode,
  RpcCoreErrorCode,
  RPC_ENDPOINT_ERROR_SOURCE
} from '@migaia/rpc-contract/error-code'
import { attachErrorIdentity } from '@migaia/utils/error'
import { createServiceWorkerCarrier } from './adapters/service-worker.js'
import type {
  IServiceWorkerMessageReceiver,
  IServiceWorkerMessageTarget
} from './adapters/service-worker.js'
import { attachBrowserCarrier } from './native-message.js'
import { createBrowserPeerError } from './peer-error.js'
import { createBrowserTransportError, normalizeBrowserHandshakeFailure } from './error.js'
import { BrowserRpcErrorText } from './error-text.js'
import { BrowserPeerErrorText } from '../error-text.js'
import { BrowserPeerEvent, BrowserNamespace } from './peer-text.js'
import { ServiceWorkerPluginText } from './service-worker-text.js'
import type {
  IServiceWorkerClientEvent,
  IServiceWorkerClientsScope,
  IServiceWorkerPluginOptions
} from './service-worker-types.js'
import type { IBrowserFeature } from './plugin-types.js'

/** Native Client routing retains only its held lookup operation, exact receiver and Host handle. */
type IServiceWorkerClientSession = {
  opening: Promise<void>
  handle?: IRpcSessionHandle
  receive?: (event: MessageEvent<unknown>) => void
}

/** Native shape admission does not rely on the current browser realm's constructor identity. */
function isTarget(value: unknown): value is IServiceWorkerMessageTarget {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof Reflect.get(value, 'postMessage') === 'function'
  )
}
/** Native receiving authority is separate from outgoing ServiceWorker/Client postMessage. */
function isReceiver(value: unknown): value is IServiceWorkerMessageReceiver {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof Reflect.get(value, 'addEventListener') === 'function' &&
    typeof Reflect.get(value, 'removeEventListener') === 'function'
  )
}

/** Retain the original native Clients lookup and per-Client isolation; Host owns every RPC table. */
class ServiceWorkerClientListener {
  /** The actual worker global owns one message subscription and Client resolution. */
  readonly #scope: IServiceWorkerClientsScope
  /** Actual installed host provides the only Session identity and lifecycle authority. */
  readonly #context: IRpcTransportSetupContext
  /** This is the existing native Client id routing map, never a provider or peer directory. */
  readonly #sessions = new Map<string, IServiceWorkerClientSession>()
  /** Shutdown revokes native acquisition synchronously and publishes its one joining Promise. */
  #closing: Promise<void> | undefined

  /** Install the original worker-global listener without fabricating an idle termination signal. */
  constructor(scope: IServiceWorkerClientsScope, context: IRpcTransportSetupContext) {
    this.#scope = scope
    this.#context = context
    scope.addEventListener(BrowserPeerEvent.message, this.#message)
  }
  /** Native Client metadata alone selects its original pending or accepted resource. */
  readonly #message = (event: IServiceWorkerClientEvent): void => {
    if (this.#closing) return
    try {
      /** Native source/id reads precede payload access and asynchronous Clients.get. */
      const source = event.source
      /** An actual browser Client id is not an accepted RPC peer id. */
      const id = source && Reflect.get(source, 'id')
      if (typeof id !== 'string' || !id) return
      /** A single original record is inserted before the real Clients lookup can suspend. */
      let record = this.#sessions.get(id)
      if (record) record.receive?.(event)
      else {
        record = { opening: Promise.resolve() }
        this.#sessions.set(id, record)
        record.opening = this.#open(id, record, event).catch((error: unknown) => {
          if (this.#sessions.get(id) === record) this.#sessions.delete(id)
          if (!this.#closing) this.#context.report(error)
        })
      }
      event.waitUntil?.(record.opening)
    } catch (cause) {
      this.#context.report(
        createBrowserTransportError(BrowserRpcErrorText.serviceWorkerSourceReadFailed, cause)
      )
    }
  }
  /**
   * Resolve the actual native reply target, install capture, then hand over the original first
   * event.
   */
  async #open(
    id: string,
    record: IServiceWorkerClientSession,
    first: IServiceWorkerClientEvent
  ): Promise<void> {
    /** Clients, rather than application metadata, supplies the current native reply object. */
    const target = await this.#scope.clients.get(id)
    if (this.#closing || !isTarget(target) || target.id !== id) {
      if (this.#sessions.get(id) === record) this.#sessions.delete(id)
      return
    }
    /** Each record projects only its native filtered event slot, not another subscription registry. */
    const receiver: IServiceWorkerMessageReceiver = {
      addEventListener: (type, listener) => {
        if (type === BrowserPeerEvent.message) record.receive = listener
      },
      removeEventListener: (type, listener) => {
        if (type === BrowserPeerEvent.message && record.receive === listener)
          record.receive = undefined
      }
    }
    /** SDK and Host retain codec, handshake and exact Session lifetime. */
    const carrier = createServiceWorkerCarrier({ target, receiver, peerId: id }, this.#context)
    try {
      record.handle = this.#context.attach(carrier)
      record.receive?.(first)
      await record.handle.ready
      /** Retirement deletes only this original native record; it never follows a successor handle. */
      void record.handle.closed.then(
        () => {
          if (this.#sessions.get(id) === record) this.#sessions.delete(id)
        },
        (error: unknown) => {
          if (this.#sessions.get(id) === record) this.#sessions.delete(id)
          this.#context.report(error)
        }
      )
    } catch (primary) {
      try {
        await carrier.close(primary)
      } catch (cleanup) {
        this.#context.report(cleanup)
      }
      throw normalizeBrowserHandshakeFailure(primary)
    }
  }
  /** Close only native subscriptions and this plugin's actual accepted/awaiting connections. */
  readonly close = (): Promise<void> =>
    (this.#closing ??= Promise.resolve().then(async () => {
      /** The original native remover failure cannot prevent sibling resources from being released. */
      const failures: unknown[] = []
      try {
        this.#scope.removeEventListener(BrowserPeerEvent.message, this.#message)
      } catch (error) {
        failures.push(error)
      }
      /** Pending native lookups and already-attached handles belong to the same original records. */
      const records = [...this.#sessions.values()]
      /** Real detach begins before waiting for original preparation failures. */
      const pending: Promise<void>[] = []
      for (const record of records)
        pending.push(
          record.handle ? this.#context.detach(record.handle) : Promise.resolve(),
          record.opening
        )
      /** Preserve the original detach/opening interleaving and aggregate failure order. */
      const results = await Promise.allSettled(pending)
      for (const result of results) if (result.status === 'rejected') failures.push(result.reason)
      this.#sessions.clear()
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

/** Capture either an actual page target/container or native worker Clients scope, without IO. */
export function serviceWorkerPlugin<
  const N extends string = 'serviceWorker',
  const TFeatures extends readonly IBrowserFeature[] = readonly IBrowserFeature[]
>(
  options: IServiceWorkerPluginOptions & Readonly<{ namespace?: N; features?: TFeatures }>
): IRpcTransportPlugin<NoInfer<N>, IRpcTransportFeatureExtensions<TFeatures[number]>, true> {
  /** Native page receive owner stays independent of the outgoing ServiceWorker. */
  const receiver =
    options?.receiver ??
    (globalThis as unknown as { navigator?: { serviceWorker?: IServiceWorkerMessageReceiver } })
      .navigator?.serviceWorker
  /** Native Client resolution is used only on the worker side. */
  const clients = options?.clients
  /** Source selection remains exclusive and synchronous as in the previous public factory. */
  const target = options?.serviceWorker
  if (
    (target !== undefined) === (clients !== undefined) ||
    (target !== undefined && (!isTarget(target) || !isReceiver(receiver))) ||
    (clients !== undefined &&
      (!isReceiver(clients) ||
        typeof clients.clients?.get !== 'function' ||
        options.receiver !== undefined))
  )
    throw createBrowserPeerError(
      RpcBrowserErrorCode.invalidPeerSource,
      BrowserPeerErrorText.invalidPeerSource
    )
  /** Cold acquisition borrows these exact admitted native sources without rereading caller getters. */
  const coldContext = { clients, target, receiver }
  return defineTransportPlugin({
    name: options.name ?? ServiceWorkerPluginText.name,
    namespace: (options.namespace ?? BrowserNamespace.service) as N,
    closingWrites: true,
    expose: options.expose,
    features: options.features,
    handshakeTimeoutMs: options.connect?.timeoutMs,
    connect: { retain: options.connect?.retain },
    open: (context) => {
      if (!coldContext.clients)
        return attachBrowserCarrier(
          createServiceWorkerCarrier(
            { target: coldContext.target!, receiver: coldContext.receiver! },
            context
          ),
          context
        )
      /** The one native listener belongs to this installation and remains borrowed. */
      const listener = new ServiceWorkerClientListener(coldContext.clients, context)
      return { dispose: listener.close }
    }
  }) as IRpcTransportPlugin<NoInfer<N>, IRpcTransportFeatureExtensions<TFeatures[number]>, true>
}
