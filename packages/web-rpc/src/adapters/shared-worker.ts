import type { IWebRpcSendOptions, IWebRpcTransport } from '../transport.js'
import {
  createListenerFailureState,
  drainListenerFailures,
  observeListener,
  registerListeners,
  releaseListenerRegistration,
  reportListenerFailure
} from '../internal/listener-safety.js'
import { createMessageListenerHub } from '../internal/message-listener-hub.js'
import { WebRpcPlatform, WebRpcTransportOwnership } from '../protocol-constants.js'
import { WebRpcErrorCode } from '../errors.js'

/** Minimal SharedWorker port surface accepted by the adapter. */
export type ISharedWorkerPort = {
  postMessage(message: unknown, transfer?: readonly Transferable[]): void
  start?(): void
  addEventListener(
    type: 'message' | 'messageerror',
    listener: (event: MessageEvent<unknown> | Event) => void
  ): void
  removeEventListener(
    type: 'message' | 'messageerror',
    listener: (event: MessageEvent<unknown> | Event) => void
  ): void
}

/** Wraps a SharedWorker's `port` without importing DOM or worker globals at runtime. */
export function createSharedWorkerTransport(
  port: ISharedWorkerPort
): IWebRpcTransport<unknown, Transferable> {
  const listeners = createMessageListenerHub<{
    data: unknown
    origin?: string
    source?: unknown
  }>()
  const listenerErrors = new Set<(error: unknown) => void>()
  const transportErrors = new Set<(error: unknown) => void>()
  const secondaryFailures = createListenerFailureState()
  const onMessage = (event: MessageEvent<unknown> | Event): void => {
    let data: unknown
    let origin: string | undefined
    let source: unknown
    try {
      data = (event as { data?: unknown }).data
      const eventOrigin = (event as { origin?: unknown }).origin
      origin = typeof eventOrigin === 'string' ? eventOrigin : undefined
      source = (event as { source?: unknown }).source
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
  const onError = (): void => {
    reportListenerFailure(
      new Error('[rpc] shared worker message error'),
      transportErrors,
      secondaryFailures
    )
  }
  return {
    platform: WebRpcPlatform.worker,
    topology: 'exclusive',
    ownership: WebRpcTransportOwnership.borrowed,
    send(message, options?: IWebRpcSendOptions<Transferable>) {
      port.postMessage(message, options?.transfer)
    },
    subscribe(listener) {
      listeners.add(listener, () =>
        registerListeners(
          [
            { add: () => port.start?.(), remove: () => undefined },
            {
              add: () => port.addEventListener('message', onMessage),
              remove: () => port.removeEventListener('message', onMessage)
            },
            {
              add: () => port.addEventListener('messageerror', onError),
              remove: () => port.removeEventListener('messageerror', onError)
            }
          ],
          { code: WebRpcErrorCode.transport, secondaryFailures }
        )
      )
      return () => {
        if (!listeners.has(listener)) return
        releaseListenerRegistration(
          listeners.size === 1
            ? [
                () => port.removeEventListener('message', onMessage),
                () => port.removeEventListener('messageerror', onError)
              ]
            : [],
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
