import { BrowserCarrierObservation, BrowserRpcCarrier } from '../probe-detail.js'
import type { IRpcSendOptions, IRpcTransport } from '@migaia/rpc-core/transport-kit'
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
} from '@migaia/rpc-core/transport-kit'
import { RpcCoreErrorCode } from '@migaia/rpc-core'
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
export function createServiceWorkerTransport(
  options: IServiceWorkerTransportOptions
): IRpcTransport<unknown, Transferable> {
  const { target, receiver } = options
  const peerId = options.peerId ?? target.id
  /** Preserves the adapter's existing physical-source admission boundary. */
  const sourceProof = (source: unknown) =>
    source === target ||
    (peerId !== undefined &&
      safeRead<unknown>(source, 'id', ({ error }) => {
        reportListenerFailure(
          createBrowserTransportError(BrowserRpcErrorText.serviceWorkerSourceReadFailed, error),
          transportErrors,
          secondaryFailures
        )
      }) === peerId)
  const listeners = createMessageListenerHub<{
    data: unknown
    origin?: string
    source?: unknown
  }>()
  const listenerErrors = new Set<(error: unknown) => void>()
  const transportErrors = new Set<(error: unknown) => void>()
  const secondaryFailures = createListenerFailureState()
  /** Observation failures use listener reporting so Endpoint never rejects pending business calls. */
  const observation = new BrowserCarrierObservation(BrowserRpcCarrier.serviceWorker, (error) =>
    reportListenerFailure(error, listenerErrors, secondaryFailures)
  )
  const onMessage = (event: MessageEvent<unknown>): void => {
    let data: unknown
    let origin: string | undefined
    let source: unknown
    try {
      data = event.data
      origin = event.origin
      source = event.source
    } catch (error) {
      reportListenerFailure(error, transportErrors, secondaryFailures)
      return
    }
    /** A verified cross-realm Client wrapper represents the configured stable peer. */
    const acceptedSource = sourceProof(source)
    /** Reuse the existing proof result so observation never repeats hostile identity reads. */
    const probe = observation.probe
    if (probe !== undefined) {
      if (acceptedSource) observation.emit(probe, 1, data, origin)
      else observation.rejectSource()
    }
    const normalizedSource = acceptedSource ? target : source
    listeners.dispatch({ data, origin, source: normalizedSource }, (listener, message) => {
      observeListener(
        () => listener(message),
        (error) => reportListenerFailure(error, listenerErrors, secondaryFailures),
        secondaryFailures
      )
    })
  }
  return {
    platform: RpcPlatform.worker,
    topology: 'multiplexed',
    ownership: RpcTransportOwnership.borrowed,
    peerId,
    sourceProof,
    send(message, options?: IRpcSendOptions<Transferable>) {
      /** Read the caller's transfer choice once, preserving getter failure and native detachment. */
      const transfer = options?.transfer
      /** Observe before postMessage can detach an explicitly transferred byte buffer. */
      const probe = observation.probe
      if (probe !== undefined) observation.emit(probe, 0, message, undefined, transfer)
      try {
        target.postMessage(message, transfer)
      } catch (error) {
        throw identifyRpcBoundaryFailure(
          error,
          RpcCoreErrorCode.transport,
          BrowserRpcErrorText.carrierOperationFailed
        )
      }
    },
    /** Replace the single endpoint probe; disposal is generation-safe and idempotent. */
    observe(probe) {
      return observation.observe(probe)
    },
    subscribe(listener) {
      listeners.add(listener, () =>
        registerListeners(
          [
            {
              add: () => receiver.addEventListener('message', onMessage),
              remove: () => receiver.removeEventListener('message', onMessage)
            }
          ],
          { code: RpcCoreErrorCode.transport, secondaryFailures }
        )
      )
      return () => {
        if (!listeners.has(listener)) return
        releaseListenerRegistration(
          listeners.size === 1 ? [() => receiver.removeEventListener('message', onMessage)] : [],
          () => listeners.remove(listener, () => undefined),
          { code: RpcCoreErrorCode.transport, secondaryFailures }
        )
      }
    },
    onListenerError(listener) {
      listenerErrors.add(listener)
      return () => {
        const deleted = listenerErrors.delete(listener)
        drainListenerFailures([], { code: RpcCoreErrorCode.transport, secondaryFailures })
        return deleted
      }
    },
    onTransportError(listener) {
      transportErrors.add(listener)
      return () => {
        const deleted = transportErrors.delete(listener)
        drainListenerFailures([], { code: RpcCoreErrorCode.transport, secondaryFailures })
        return deleted
      }
    }
  }
}
