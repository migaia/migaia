import { BrowserRpcErrorText } from '../error-text.js'
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
  safeString,
  tagRpcError
} from '../../core/transport-kit.js'
import { RpcCoreErrorCode, RpcTransportError } from '../../core/errors.js'

/**
 * Minimal event-listener worker/port surface — a real `Worker`, `MessagePort`, or
 * `SharedWorker.port` all satisfy this. Deliberately not `Worker` itself: shared workers and ports
 * must not use a mutable `onmessage` slot (that would silently steal another listener's
 * subscription), and this file has no other DOM dependency beyond the ambient
 * `Transferable`/`MessageEvent` types.
 */
export type IWebWorkerLikePort = {
  postMessage(message: unknown, transfer?: readonly Transferable[]): void
  addEventListener(
    type: 'message' | 'error' | 'messageerror',
    listener: (event: MessageEvent<unknown> | Event) => void
  ): void
  removeEventListener(
    type: 'message' | 'error' | 'messageerror',
    listener: (event: MessageEvent<unknown> | Event) => void
  ): void
}

/** Static metadata for a dedicated worker channel whose peer is known by construction. */
export type IWebWorkerTransportOptions = {
  readonly peerId?: string
  readonly origin?: string
}

/**
 * Wraps a Worker/MessagePort-like object as an `RpcTransport`. `error` and `messageerror` (script
 * failure, structured-clone failure) have no message payload of their own — they're surfaced
 * through `onTransportError`, which the endpoint uses to fail every pending call at once instead of
 * leaving them hanging with no response ever coming.
 */
export function createWebWorkerTransport(
  port: IWebWorkerLikePort,
  options: IWebWorkerTransportOptions = {}
): IRpcTransport<unknown, Transferable> {
  const messageListeners = createMessageListenerHub<{
    data: unknown
    origin?: string
    source?: unknown
  }>()
  const errorListeners = new Set<(error: unknown) => void>()
  const listenerErrors = new Set<(error: unknown) => void>()
  const secondaryFailures = createListenerFailureState()

  const emitTransportError = (error: unknown): void => {
    reportListenerFailure(error, errorListeners, secondaryFailures)
  }

  // `event` is an external boundary — a real MessageEvent never throws
  // reading `.data`, but a hostile/mocked event object (or a getter that
  // itself throws) must not be allowed to escape as an uncaught exception
  // from inside the port's own event dispatch. Routed through
  // `onTransportError` rather than silently dropped: a message that could
  // not even be read is exactly the kind of thing pending callers need to
  // know happened, not have quietly vanish.
  const onMessage = (event: MessageEvent<unknown> | Event): void => {
    let data: unknown
    let origin: string | undefined
    let source: unknown
    try {
      data = (event as MessageEvent<unknown> | undefined)?.data
      const eventOrigin = (event as { origin?: unknown }).origin
      origin = typeof eventOrigin === 'string' ? eventOrigin : undefined
      source = (event as { source?: unknown }).source
    } catch (error) {
      const detail = safeString(error, undefined, ({ error: conversionError }) => {
        emitTransportError(
          new RpcTransportError(BrowserRpcErrorText.workerMessageReadFailed(''), conversionError)
        )
        return undefined
      })
      emitTransportError(
        tagRpcError(
          new Error(BrowserRpcErrorText.workerMessageReadFailed(detail), { cause: error }),
          RpcCoreErrorCode.transport
        )
      )
      return
    }
    messageListeners.dispatch({ data, origin, source }, (listener, message) => {
      observeListener(
        () => listener(message),
        (error) => reportListenerFailure(error, listenerErrors, secondaryFailures),
        secondaryFailures
      )
    })
  }
  const onFailure =
    (reason: string) =>
    (event: Event): void => {
      let detail: string
      try {
        detail = safeString(
          (event as unknown as { message?: string } | undefined)?.message || reason,
          reason,
          ({ error }) => {
            emitTransportError(
              new RpcTransportError(BrowserRpcErrorText.workerFailure(reason, reason), error)
            )
            return undefined
          }
        )
      } catch (error) {
        emitTransportError(
          new RpcTransportError(BrowserRpcErrorText.workerFailure(reason, reason), error)
        )
        detail = reason
      }
      emitTransportError(
        tagRpcError(
          new Error(BrowserRpcErrorText.workerFailure(reason, detail)),
          RpcCoreErrorCode.transport
        )
      )
    }
  const onError = onFailure('failed')
  const onMessageError = onFailure('could not deserialize a message')

  return {
    platform: RpcPlatform.worker,
    topology: 'exclusive',
    ownership: RpcTransportOwnership.borrowed,
    peerId: options.peerId,
    origin: options.origin,
    send(message, options?: IRpcSendOptions<Transferable>) {
      port.postMessage(message, options?.transfer)
    },
    // Attached lazily on first subscriber, detached once the last one
    // leaves — a client that closes must not leave the underlying port
    // still holding real listeners it can no longer reach.
    subscribe(listener) {
      messageListeners.add(listener, () =>
        registerListeners(
          [
            {
              add: () => port.addEventListener('message', onMessage),
              remove: () => port.removeEventListener('message', onMessage)
            }
          ],
          { code: RpcCoreErrorCode.transport, secondaryFailures }
        )
      )
      return () => {
        if (!messageListeners.has(listener)) return
        releaseListenerRegistration(
          messageListeners.size === 1 ? [() => port.removeEventListener('message', onMessage)] : [],
          () => messageListeners.remove(listener, () => undefined),
          { code: RpcCoreErrorCode.transport, secondaryFailures }
        )
      }
    },
    onTransportError(listener) {
      if (errorListeners.size === 0) {
        registerListeners(
          [
            {
              add: () => port.addEventListener('error', onError),
              remove: () => port.removeEventListener('error', onError)
            },
            {
              add: () => port.addEventListener('messageerror', onMessageError),
              remove: () => port.removeEventListener('messageerror', onMessageError)
            }
          ],
          { code: RpcCoreErrorCode.transport, secondaryFailures }
        )
      }
      errorListeners.add(listener)
      return () => {
        if (!errorListeners.has(listener)) return
        releaseListenerRegistration(
          errorListeners.size === 1
            ? [
                () => port.removeEventListener('error', onError),
                () => port.removeEventListener('messageerror', onMessageError)
              ]
            : [],
          () => {
            errorListeners.delete(listener)
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
