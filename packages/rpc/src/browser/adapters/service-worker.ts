import type { IRpcSendOptions, IRpcTransport } from '../../core/transport-kit.js'
import {
  RpcPlatform,
  RpcTransportOwnership,
  createListenerFailureState,
  createMessageListenerHub,
  drainListenerFailures,
  observeListener,
  registerListeners,
  releaseListenerRegistration,
  reportListenerFailure,
  safeRead
} from '../../core/transport-kit.js'
import { RpcCoreErrorCode, RpcTransportError } from '../../core/errors.js'
import { BrowserRpcErrorText } from '../error-text.js'

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
): IRpcTransport<unknown, Transferable> {
  const { target, receiver } = options
  const peerId = options.peerId ?? target.id
  /** Preserves the adapter's existing physical-source admission boundary. */
  const sourceProof = (source: unknown) =>
    source === target ||
    (peerId !== undefined &&
      safeRead<unknown>(source, 'id', ({ error }) => {
        reportListenerFailure(
          new RpcTransportError(BrowserRpcErrorText.serviceWorkerSourceReadFailed, error),
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
    const normalizedSource = sourceProof(source) ? target : source
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
