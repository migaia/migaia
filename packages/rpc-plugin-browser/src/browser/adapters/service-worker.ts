import { BrowserCarrierObservation, BrowserRpcCarrier } from '../probe-detail.js'
import type { IRpcSendOptions, IRpcTransport } from '@migaia/rpc-host/plugin'
import {
  RpcPlatform,
  RpcTransportOwnership,
  createListenerFailureState,
  createMessageListenerHub,
  drainListenerFailures,
  identifyRpcBoundaryFailure,
  observeListener,
  registerListeners,
  releaseListenerRegistration,
  reportListenerFailure,
  safeRead
} from '@migaia/rpc-host/plugin'
import { RpcCoreErrorCode } from '@migaia/rpc-host'
import { createBrowserTransportError } from '../error.js'
import { BrowserRpcErrorText } from '../error-text.js'

/** Outbound ServiceWorker or Client target. */
export type IServiceWorkerMessageTarget = {
  /** Native send to the chosen ServiceWorker or Client; transfers can detach caller-owned buffers. */
  postMessage(message: unknown, transfer?: readonly Transferable[]): void
  /** Optional stable Client identity used as the default peerId for cross-realm source wrappers. */
  readonly id?: string
}

/** Inbound page or ServiceWorkerGlobalScope event target. */
export type IServiceWorkerMessageReceiver = {
  /** Register incoming messages on navigator.serviceWorker or the worker's own event scope. */
  addEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void
  /** Remove the exact native callback when the last logical subscription ends. */
  removeEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void
}

/** Explicit outgoing target and incoming event owner; no browser-global fallback is selected. */
export type IServiceWorkerTransportOptions = {
  /** ServiceWorker or Client that receives outgoing calls; pass the concrete authenticated target. */
  readonly target: IServiceWorkerMessageTarget
  /** Message event owner, usually navigator.serviceWorker in a page or self in the worker. */
  readonly receiver: IServiceWorkerMessageReceiver
  /** Expected remote Client identity; defaults to target.id when that identity is available. */
  readonly peerId?: string
}

/**
 * Adapt a borrowed ServiceWorker/Client pair for an Endpoint, not a Runtime Peer connection.
 * sourceProof accepts the target itself or its configured stable Client id; a proved wrapper is
 * normalized to target in received metadata. Raw subscribe also forwards unproved sources, so
 * Endpoint connect remains responsible for admission. A failed id read reports TRANSPORT with the
 * original cause rather than turning an unknown source into a trusted one.
 *
 * First/last subscriptions install/remove one receiver callback. No worker/client close is
 * provided. send preserves the native transfer choice and classifies native send failures with Core
 * TRANSPORT while retaining the original exception or its cause chain. Event-read failures use
 * onTransportError while listener/probe failures use onListenerError. The caller owns worker
 * lifecycle/reconnection.
 */
/** Allocate one borrowed ServiceWorker carrier before installing behavior callbacks. */
function serviceWorkerTransportState(options: IServiceWorkerTransportOptions) {
  const { target, receiver } = options
  /** The accepted ServiceWorker client identity filters traffic before logical subscriber dispatch. */
  const peerId = options.peerId ?? target.id
  /** Preserves the adapter's existing physical-source admission boundary. */
  const listeners = createMessageListenerHub<{
    data: unknown
    origin?: string
    source?: unknown
  }>()
  /** Registered diagnostic callbacks receive listener failures without losing the primary error. */
  const listenerErrors = new Set<(error: unknown) => void>()
  /** Native carrier failures fan out to the currently registered transport subscribers. */
  const transportErrors = new Set<(error: unknown) => void>()
  /**
   * Reporter and listener cleanup failures remain reachable until the existing failure drain
   * observes them.
   */
  const secondaryFailures = createListenerFailureState()
  /** Observation failures use listener reporting so Endpoint never rejects pending business calls. */
  const observation = new BrowserCarrierObservation(BrowserRpcCarrier.serviceWorker, (error) =>
    reportListenerFailure(error, listenerErrors, secondaryFailures)
  )

  return {
    target,
    receiver,
    peerId,
    listeners,
    listenerErrors,
    transportErrors,
    secondaryFailures,
    observation,
    options
  }
}

/** Own one borrowed ServiceWorker carrier; callbacks access only this explicit instance. */
class ServiceWorkerTransport {
  /** All mutable storage and original construction inputs belong to this operation. */
  #state: ReturnType<typeof serviceWorkerTransportState>
  /** Preserve the original stable resource surface and callback identities. */
  readonly value: IRpcTransport<unknown, Transferable>
  /** Initialize owned storage before publishing the resource's callbacks. */
  constructor(options: IServiceWorkerTransportOptions) {
    this.#state = serviceWorkerTransportState(options)

    this.value = {
      platform: RpcPlatform.worker,
      topology: 'multiplexed',
      ownership: RpcTransportOwnership.borrowed,
      peerId: this.#state.peerId,
      sourceProof: this.#sourceProof,
      send: (message, options?: IRpcSendOptions<Transferable>) => {
        /** Read the caller's transfer choice once, preserving getter failure and native detachment. */
        const transfer = options?.transfer
        /** Observe before postMessage can detach an explicitly transferred byte buffer. */
        const probe = this.#state.observation.probe
        if (probe !== undefined)
          this.#state.observation.emit(probe, 0, message, undefined, transfer)
        try {
          this.#state.target.postMessage(message, transfer)
        } catch (error) {
          throw identifyRpcBoundaryFailure(
            error,
            RpcCoreErrorCode.transport,
            BrowserRpcErrorText.carrierOperationFailed
          )
        }
      },
      /** Replace the single endpoint probe; disposal is generation-safe and idempotent. */
      observe: (probe) => {
        return this.#state.observation.observe(probe)
      },
      subscribe: (listener) => {
        this.#state.listeners.add(listener, () =>
          registerListeners(
            [
              {
                add: () => this.#state.receiver.addEventListener('message', this.#onMessage),
                remove: () => this.#state.receiver.removeEventListener('message', this.#onMessage)
              }
            ],
            { code: RpcCoreErrorCode.transport, secondaryFailures: this.#state.secondaryFailures }
          )
        )
        return () => {
          if (!this.#state.listeners.has(listener)) return
          releaseListenerRegistration(
            this.#state.listeners.size === 1
              ? [() => this.#state.receiver.removeEventListener('message', this.#onMessage)]
              : [],
            () => this.#state.listeners.remove(listener, () => undefined),
            { code: RpcCoreErrorCode.transport, secondaryFailures: this.#state.secondaryFailures }
          )
        }
      },
      onListenerError: (listener) => {
        this.#state.listenerErrors.add(listener)
        return () => {
          const deleted = this.#state.listenerErrors.delete(listener)
          drainListenerFailures([], {
            code: RpcCoreErrorCode.transport,
            secondaryFailures: this.#state.secondaryFailures
          })
          return deleted
        }
      },
      onTransportError: (listener) => {
        this.#state.transportErrors.add(listener)
        return () => {
          const deleted = this.#state.transportErrors.delete(listener)
          drainListenerFailures([], {
            code: RpcCoreErrorCode.transport,
            secondaryFailures: this.#state.secondaryFailures
          })
          return deleted
        }
      }
    }
  }

  #sourceProof = (source: unknown) =>
    source === this.#state.target ||
    (this.#state.peerId !== undefined &&
      safeRead<unknown>(source, 'id', ({ error }) => {
        reportListenerFailure(
          createBrowserTransportError(BrowserRpcErrorText.serviceWorkerSourceReadFailed, error),
          this.#state.transportErrors,
          this.#state.secondaryFailures
        )
      }) === this.#state.peerId)

  #onMessage = (event: MessageEvent<unknown>): void => {
    let data: unknown
    let origin: string | undefined
    let source: unknown
    try {
      data = event.data
      origin = event.origin
      source = event.source
    } catch (error) {
      reportListenerFailure(error, this.#state.transportErrors, this.#state.secondaryFailures)
      return
    }
    /** A verified cross-realm Client wrapper represents the configured stable peer. */
    const acceptedSource = this.#sourceProof(source)
    /** Reuse the existing proof result so observation never repeats hostile identity reads. */
    const probe = this.#state.observation.probe
    if (probe !== undefined) {
      if (acceptedSource) this.#state.observation.emit(probe, 1, data, origin)
      else this.#state.observation.rejectSource()
    }
    const normalizedSource = acceptedSource ? this.#state.target : source
    this.#state.listeners.dispatch(
      { data, origin, source: normalizedSource },
      (listener, message) => {
        observeListener(
          () => listener(message),
          (error) =>
            reportListenerFailure(error, this.#state.listenerErrors, this.#state.secondaryFailures),
          this.#state.secondaryFailures
        )
      }
    )
  }
}

/** Construct the single owner for one borrowed ServiceWorker carrier. */
export function createServiceWorkerTransport(
  options: IServiceWorkerTransportOptions
): IRpcTransport<unknown, Transferable> {
  return new ServiceWorkerTransport(options).value
}
