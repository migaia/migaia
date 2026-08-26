import { WebRpcErrorCode, WebRpcTransportError } from '../errors.js'
import { WebRpcErrorText } from '../error-text.js'
import type { IWebRpcSendOptions, IWebRpcTransport } from '../transport.js'
import { safeRead, safeString } from '../internal/safe-value.js'
import {
  collectListenerFailure,
  collectListenerCleanupFailures,
  createListenerFailureState,
  drainListenerFailures,
  drainTerminalListenerFailures,
  observeListener,
  registerListeners,
  releaseListenerRegistration,
  reportListenerFailure
} from '../internal/listener-safety.js'
import { WebRpcPlatform, WebRpcTransportOwnership } from '../protocol-constants.js'

/**
 * Structural shape of Node's `worker_threads.MessagePort` (and close enough to `EventEmitter`
 * generally) — deliberately not imported from `node:worker_threads` itself, since this package's
 * app build has no Node lib/types configured and must stay usable in a browser-only build. Any
 * object with this shape works, including a real Node MessagePort at runtime.
 */
export type INodeMessagePortLike = {
  postMessage(message: unknown, transferList?: readonly unknown[]): void
  on(event: 'message', listener: (message: unknown) => void): unknown
  on(event: 'messageerror' | 'close', listener: (error?: unknown) => void): unknown
  off(event: 'message' | 'messageerror' | 'close', listener: (...args: unknown[]) => void): unknown
}

/** Browser MessagePort surface with EventTarget lifecycle. */
export type IBrowserMessagePortLike<TTransfer = unknown, TEvent = unknown> = {
  postMessage(message: unknown, transfer?: readonly TTransfer[]): void
  start(): void
  close(): void
  addEventListener(type: 'message' | 'messageerror', listener: (event: TEvent) => void): void
  removeEventListener(type: 'message' | 'messageerror', listener: (event: TEvent) => void): void
}

/** Controls whether the browser adapter is allowed to close the supplied port. */
export type IBrowserMessagePortTransportOptions = {
  readonly ownership?: 'owned' | 'borrowed'
}

/** Wraps a browser MessagePort and owns its terminal lifecycle. */
export function createBrowserMessagePortTransport<TTransfer = unknown, TEvent = unknown>(
  port: IBrowserMessagePortLike<TTransfer, TEvent>,
  options: IBrowserMessagePortTransportOptions = {}
): IWebRpcTransport<unknown, TTransfer> {
  const messageListeners = new Set<(message: { data: unknown }) => void>()
  const errorListeners = new Set<(error: unknown) => void>()
  const listenerErrors = new Set<(error: unknown) => void>()
  const secondaryFailures = createListenerFailureState()
  let closed = false
  let closeResult: void | Promise<void>
  const ownership = options.ownership ?? 'owned'
  const onMessage = (event: TEvent): void => {
    const data = safeRead<unknown>(event, 'data')
    for (const listener of Array.from(messageListeners)) {
      observeListener(
        () => listener({ data }),
        (error) => reportListenerFailure(error, listenerErrors, secondaryFailures),
        secondaryFailures
      )
    }
  }
  const onMessageError = (): void => {
    const error = new Error('[rpc] browser message port could not deserialize a message')
    reportListenerFailure(error, errorListeners, secondaryFailures)
  }
  return {
    platform: WebRpcPlatform.messagePort,
    topology: 'exclusive',
    ownership,
    get closed() {
      return closed
    },
    send(message, options?: IWebRpcSendOptions<TTransfer>) {
      if (closed) throw new WebRpcTransportError('[rpc] browser message port is closed')
      port.postMessage(message, options?.transfer)
    },
    subscribe(listener) {
      if (closed) throw new WebRpcTransportError('[rpc] browser message port is closed')
      if (messageListeners.size === 0) {
        registerListeners(
          [
            {
              add: () => port.addEventListener('message', onMessage),
              remove: () => port.removeEventListener('message', onMessage)
            },
            {
              add: () => port.addEventListener('messageerror', onMessageError),
              remove: () => port.removeEventListener('messageerror', onMessageError)
            },
            { add: () => port.start(), remove: () => undefined }
          ],
          { code: WebRpcErrorCode.transport, secondaryFailures }
        )
      }
      messageListeners.add(listener)
      return () => {
        if (!messageListeners.has(listener)) return
        releaseListenerRegistration(
          messageListeners.size === 1
            ? [
                () => port.removeEventListener('message', onMessage),
                () => port.removeEventListener('messageerror', onMessageError)
              ]
            : [],
          () => {
            messageListeners.delete(listener)
          },
          { code: WebRpcErrorCode.transport, secondaryFailures }
        )
      }
    },
    close() {
      if (closed) return closeResult
      closed = true
      messageListeners.clear()
      const cleanupErrors = collectListenerCleanupFailures([
        () => port.removeEventListener('message', onMessage),
        () => port.removeEventListener('messageerror', onMessageError)
      ])
      if (ownership === 'owned') {
        try {
          port.close()
        } catch (error) {
          cleanupErrors.push(error)
        }
      }
      closeResult = drainTerminalListenerFailures(cleanupErrors, {
        code: WebRpcErrorCode.transport,
        message: WebRpcErrorText.messagePortCleanupFailed,
        secondaryFailures,
        aggregateSingle: true
      })
      return closeResult
    },
    onTransportError(listener) {
      errorListeners.add(listener)
      return () => {
        const deleted = errorListeners.delete(listener)
        drainListenerFailures([], { code: WebRpcErrorCode.transport, secondaryFailures })
        return deleted
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

/**
 * Wraps a Node `worker_threads.MessagePort` (or anything with the same shape) as a web-rpc
 * transport.
 */
export function createNodeMessagePortTransport(port: INodeMessagePortLike): IWebRpcTransport {
  const messageListeners = new Set<(message: { data: unknown }) => void>()
  const errorListeners = new Set<(error: unknown) => void>()
  const listenerErrors = new Set<(error: unknown) => void>()
  const secondaryFailures = createListenerFailureState()
  let closed = false
  let terminalReported = false
  let terminalError: Error | undefined

  const emitTransportError = (error: unknown): void => {
    reportListenerFailure(error, errorListeners, secondaryFailures)
  }

  const onMessage = (message: unknown): void => {
    for (const listener of Array.from(messageListeners)) {
      observeListener(
        () => listener({ data: message }),
        (error) => reportListenerFailure(error, listenerErrors, secondaryFailures),
        secondaryFailures
      )
    }
  }
  // `error` here is an external boundary the same way a DOM event is —
  // stringifying it must not itself throw and escape as an uncaught
  // exception from inside Node's event emitter dispatch.
  const onMessageError = (error?: unknown): void => {
    const detail = error === undefined ? '' : `: ${safeString(error)}`
    emitTransportError(new Error(`[rpc] message port could not deserialize a message${detail}`))
  }
  const onClose = (): void => {
    if (terminalReported) return
    terminalReported = true
    closed = true
    terminalError = new Error('[rpc] message port closed')
    emitTransportError(terminalError)
  }

  return {
    platform: WebRpcPlatform.messagePort,
    topology: 'exclusive',
    ownership: WebRpcTransportOwnership.borrowed,
    get closed() {
      return closed
    },
    send(message, options?: IWebRpcSendOptions) {
      if (closed) throw new WebRpcTransportError('[rpc] message port is closed')
      port.postMessage(message, options?.transfer)
    },
    // Lazily attached/detached the same way as the web-worker adapter —
    // a client that closes must not leave the underlying port still
    // referencing listeners it can no longer reach.
    subscribe(listener) {
      if (closed) throw new WebRpcTransportError('[rpc] message port is closed')
      if (messageListeners.size === 0)
        registerListeners(
          [
            {
              add: () => port.on('message', onMessage),
              remove: () => port.off('message', onMessage)
            }
          ],
          { code: WebRpcErrorCode.transport, secondaryFailures }
        )
      messageListeners.add(listener)
      return () => {
        if (!messageListeners.has(listener)) return
        releaseListenerRegistration(
          messageListeners.size === 1 ? [() => port.off('message', onMessage)] : [],
          () => {
            messageListeners.delete(listener)
          },
          { code: WebRpcErrorCode.transport, secondaryFailures }
        )
      }
    },
    onTransportError(listener) {
      if (errorListeners.size === 0)
        registerListeners(
          [
            {
              add: () => port.on('messageerror', onMessageError),
              remove: () => port.off('messageerror', onMessageError)
            },
            {
              add: () => port.on('close', onClose),
              remove: () => port.off('close', onClose)
            }
          ],
          { code: WebRpcErrorCode.transport, secondaryFailures }
        )
      errorListeners.add(listener)
      if (terminalError !== undefined) {
        observeListener(
          () => listener(terminalError),
          (error) => collectListenerFailure(secondaryFailures, error),
          secondaryFailures
        )
      }
      return () => {
        if (!errorListeners.has(listener)) return
        releaseListenerRegistration(
          errorListeners.size === 1
            ? [() => port.off('messageerror', onMessageError), () => port.off('close', onClose)]
            : [],
          () => {
            errorListeners.delete(listener)
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
