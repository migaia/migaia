import { BrowserCarrierObservation, BrowserRpcCarrier } from '../probe-detail.js'
import type { IRpcTransport } from '@migaia/rpc-core/transport-kit'
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
} from '@migaia/rpc-core/transport-kit'
import { RpcCoreErrorCode } from '@migaia/rpc-core'

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
  /** Observation owns no platform resource and reports through the existing carrier channel. */
  const observation = new BrowserCarrierObservation(BrowserRpcCarrier.broadcastChannel, (error) =>
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
      reportListenerFailure(error, listenerErrors, secondaryFailures)
      return
    }
    /** Exclusive or native-origin traffic is already admitted by this carrier. */
    const probe = observation.probe
    if (probe !== undefined) observation.emit(probe, 1, data, origin)
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
      /** Broadcast sends have no transfer list and retain captured content by reference. */
      const probe = observation.probe
      if (probe !== undefined) observation.emit(probe, 0, message)
      channel.postMessage(message)
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
