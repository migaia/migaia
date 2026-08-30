import type { IWebRpcSendOptions, IWebRpcTransport } from '../transport.js'
import { safeRead } from '../internal/safe-value.js'
import { WebRpcPlatform, WebRpcTransportOwnership } from '../protocol-constants.js'
import { WebRpcErrorCode } from '../errors.js'
import {
  createListenerFailureState,
  drainListenerFailures,
  observeListener,
  registerListeners,
  releaseListenerRegistration,
  reportListenerFailure
} from '../internal/listener-safety.js'
import { createMessageListenerHub } from '../internal/message-listener-hub.js'

/** Outbound ServiceWorker or Client target. */
export type IServiceWorkerMessageTarget = {
  postMessage(message: unknown, transfer?: readonly Transferable[]): void
  readonly id?: string
}

/** Inbound page or ServiceWorkerGlobalScope event target. */
export type IServiceWorkerMessageReceiver = {
  addEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void
  removeEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void
}

export type IServiceWorkerTransportOptions = {
  readonly target: IServiceWorkerMessageTarget
  readonly receiver: IServiceWorkerMessageReceiver
  readonly peerId?: string
}

/** Wraps distinct ServiceWorker send and receive owners. */
export function createServiceWorkerTransport(
  options: IServiceWorkerTransportOptions
): IWebRpcTransport<unknown, Transferable> {
  const { target, receiver } = options
  const peerId = options.peerId ?? target.id
  const listeners = createMessageListenerHub<{
    data: unknown
    origin?: string
    source?: unknown
  }>()
  const listenerErrors = new Set<(error: unknown) => void>()
  const transportErrors = new Set<(error: unknown) => void>()
  const secondaryFailures = createListenerFailureState()
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
    listeners.dispatch({ data, origin, source }, (listener, message) => {
      observeListener(
        () => listener(message),
        (error) => reportListenerFailure(error, listenerErrors, secondaryFailures),
        secondaryFailures
      )
    })
  }
  return {
    platform: WebRpcPlatform.worker,
    topology: 'multiplexed',
    ownership: WebRpcTransportOwnership.borrowed,
    peerId,
    sourceProof: (source) =>
      source === target || (peerId !== undefined && safeRead<unknown>(source, 'id') === peerId),
    send(message, options?: IWebRpcSendOptions<Transferable>) {
      target.postMessage(message, options?.transfer)
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
          { code: WebRpcErrorCode.transport, secondaryFailures }
        )
      )
      return () => {
        if (!listeners.has(listener)) return
        releaseListenerRegistration(
          listeners.size === 1 ? [() => receiver.removeEventListener('message', onMessage)] : [],
          () => listeners.remove(listener, () => undefined),
          { code: WebRpcErrorCode.transport, secondaryFailures }
        )
      }
    },
    onListenerError(listener) {
      listenerErrors.add(listener)
      return () => {
        const deleted = listenerErrors.delete(listener)
        drainListenerFailures([], { code: WebRpcErrorCode.transport, secondaryFailures })
        return deleted
      }
    },
    onTransportError(listener) {
      transportErrors.add(listener)
      return () => {
        const deleted = transportErrors.delete(listener)
        drainListenerFailures([], { code: WebRpcErrorCode.transport, secondaryFailures })
        return deleted
      }
    }
  }
}
