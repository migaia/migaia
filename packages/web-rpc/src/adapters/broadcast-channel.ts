import type { IWebRpcTransport } from '../transport.js'
import { WebRpcPlatform, WebRpcTransportOwnership } from '../protocol-constants.js'
import { WebRpcErrorCode } from '../errors.js'
import {
  collectListenerFailure,
  createListenerFailureState,
  drainListenerFailures,
  observeListener,
  registerListeners,
  releaseListenerRegistration,
  reportListenerFailure
} from '../internal/listener-safety.js'
import { createMessageListenerHub } from '../internal/message-listener-hub.js'

/** Adapts BroadcastChannel for tab-to-tab and storage-backed coordination. */
export function createBroadcastChannelTransport(channel: BroadcastChannel): IWebRpcTransport {
  const listeners = createMessageListenerHub<{
    data: unknown
    origin?: string
    source?: unknown
  }>()
  const listenerErrors = new Set<(error: unknown) => void>()
  const transportErrorWrappers = new Set<EventListener>()
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
      reportListenerFailure(error, listenerErrors, secondaryFailures)
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
    platform: WebRpcPlatform.broadcastChannel,
    topology: 'broadcast',
    ownership: WebRpcTransportOwnership.borrowed,
    send(message) {
      channel.postMessage(message)
    },
    subscribe(listener) {
      listeners.add(listener, () =>
        registerListeners(
          [
            {
              add: () => channel.addEventListener('message', onMessage),
              remove: () => channel.removeEventListener('message', onMessage)
            }
          ],
          { code: WebRpcErrorCode.transport, secondaryFailures }
        )
      )
      return () => {
        if (!listeners.has(listener)) return
        releaseListenerRegistration(
          listeners.size === 1 ? [() => channel.removeEventListener('message', onMessage)] : [],
          () => listeners.remove(listener, () => undefined),
          { code: WebRpcErrorCode.transport, secondaryFailures }
        )
      }
    },
    onTransportError(listener) {
      const wrapper: EventListener = (event) => {
        observeListener(
          () => listener(event),
          (error) => collectListenerFailure(secondaryFailures, error),
          secondaryFailures
        )
      }
      registerListeners(
        [
          {
            add: () => channel.addEventListener('messageerror', wrapper),
            remove: () => channel.removeEventListener('messageerror', wrapper)
          }
        ],
        { code: WebRpcErrorCode.transport, secondaryFailures }
      )
      transportErrorWrappers.add(wrapper)
      return () => {
        if (!transportErrorWrappers.has(wrapper)) return
        releaseListenerRegistration(
          [() => channel.removeEventListener('messageerror', wrapper)],
          () => {
            transportErrorWrappers.delete(wrapper)
          },
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
    }
  }
}
