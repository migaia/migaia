import type { IRpcTransport } from '../../core/transport-kit.js'
import {
  RpcPlatform,
  RpcTransportOwnership,
  collectListenerFailure,
  createListenerFailureState,
  createMessageListenerHub,
  drainListenerFailures,
  observeListener,
  registerListeners,
  releaseListenerRegistration,
  reportListenerFailure
} from '../../core/transport-kit.js'
import { RpcCoreErrorCode } from '../../core/errors.js'

/** Adapts BroadcastChannel for tab-to-tab and storage-backed coordination. */
export function createBroadcastChannelTransport(channel: BroadcastChannel): IRpcTransport {
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
    platform: RpcPlatform.broadcastChannel,
    topology: 'broadcast',
    ownership: RpcTransportOwnership.borrowed,
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
          { code: RpcCoreErrorCode.transport, secondaryFailures }
        )
      )
      return () => {
        if (!listeners.has(listener)) return
        releaseListenerRegistration(
          listeners.size === 1 ? [() => channel.removeEventListener('message', onMessage)] : [],
          () => listeners.remove(listener, () => undefined),
          { code: RpcCoreErrorCode.transport, secondaryFailures }
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
        { code: RpcCoreErrorCode.transport, secondaryFailures }
      )
      transportErrorWrappers.add(wrapper)
      return () => {
        if (!transportErrorWrappers.has(wrapper)) return
        releaseListenerRegistration(
          [() => channel.removeEventListener('messageerror', wrapper)],
          () => {
            transportErrorWrappers.delete(wrapper)
          },
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
    }
  }
}
