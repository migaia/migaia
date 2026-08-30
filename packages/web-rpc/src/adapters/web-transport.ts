import { WebRpcErrorCode, WebRpcTransportError, tagWebRpcError } from '../errors.js'
import { WebRpcErrorText } from '../error-text.js'
import type { IWebRpcTransport } from '../transport.js'
import { isUint8Array } from '../internal/safe-value.js'
import { WebRpcPlatform, WebRpcTransportOwnership } from '../protocol-constants.js'
import {
  collectListenerFailure,
  createListenerFailureState,
  drainListenerFailures,
  drainTerminalListenerFailures,
  observeListener,
  reportListenerFailure
} from '../internal/listener-safety.js'
import { createMessageListenerHub } from '../internal/message-listener-hub.js'

/** Minimal datagram surface accepted by the WebTransport adapter. */
export type IWebTransportDatagrams = {
  writable: WritableStream<Uint8Array>
  readable: ReadableStream<Uint8Array>
}

/** Wraps WebTransport datagrams; protocol middleware owns encoding and decoding. */
export function createWebTransportDatagramTransport(
  datagrams: IWebTransportDatagrams
): IWebRpcTransport<Uint8Array> {
  const writer = datagrams.writable.getWriter()
  const listeners = createMessageListenerHub<{ data: Uint8Array }>()
  const listenerErrors = new Set<(error: unknown) => void>()
  const transportErrors = new Set<(error: unknown) => void>()
  const secondaryFailures = createListenerFailureState()
  let reading = false
  let readPromise: Promise<void> | undefined
  let activeReader: ReadableStreamDefaultReader<Uint8Array> | undefined
  const readCleanupErrors: unknown[] = []
  let closed = false
  let terminalReported = false
  let terminalOccurred = false
  let terminalError: unknown
  let closePromise: Promise<void> | undefined
  const transitionTerminal = (error: unknown): void => {
    if (terminalReported) return
    terminalReported = true
    terminalOccurred = true
    terminalError = error
    closed = true
    listeners.clear(() => undefined)
    reportListenerFailure(error, transportErrors, secondaryFailures)
  }
  const read = async (): Promise<void> => {
    if (reading) return
    reading = true
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
    try {
      reader = datagrams.readable.getReader()
      activeReader = reader
      // The reader belongs to the transport, not to an individual subscription.
      // Unsubscribe only removes business listeners; close is the sole read owner stop.
      while (!closed) {
        const result = await reader.read()
        if (result.done) {
          // EOF is terminal for a datagram transport. Leaving the adapter open
          // would make timeout=false operations wait forever on a dead reader.
          transitionTerminal(new Error('WebTransport datagram stream ended'))
          break
        }
        listeners.dispatch({ data: result.value }, (listener, message) =>
          observeListener(
            () => listener(message),
            (error) => reportListenerFailure(error, listenerErrors, secondaryFailures),
            secondaryFailures
          )
        )
      }
    } catch (error) {
      transitionTerminal(error)
    } finally {
      reading = false
      activeReader = undefined
      try {
        reader?.releaseLock()
      } catch (error) {
        readCleanupErrors.push(error)
        reportListenerFailure(error, transportErrors, secondaryFailures)
      }
    }
  }
  return {
    platform: WebRpcPlatform.webTransport,
    topology: 'exclusive',
    encodedType: 'uint8array',
    ownership: WebRpcTransportOwnership.owned,
    get closed() {
      return closed
    },
    send(message) {
      if (closed) throw new WebRpcTransportError('WebTransport is closed')
      if (!isUint8Array(message))
        throw tagWebRpcError(
          new TypeError('WebTransport requires Uint8Array encoded messages'),
          WebRpcErrorCode.invalidConfig
        )
      return writer.write(message)
    },
    subscribe(listener) {
      if (closed) throw new WebRpcTransportError('WebTransport is closed')
      listeners.add(listener, () => undefined)
      if (!readPromise) {
        readPromise = read().finally(() => {
          readPromise = undefined
        })
        void readPromise.catch((error) => {
          reportListenerFailure(error, transportErrors, secondaryFailures)
        })
      }
      return () => {
        const deleted = listeners.remove(listener, () => undefined)
        drainListenerFailures([], { code: WebRpcErrorCode.transport, secondaryFailures })
        return deleted
      }
    },
    close() {
      if (closePromise) return closePromise
      closed = true
      terminalReported = true
      listeners.clear(() => undefined)
      const readOwner = readPromise
      closePromise = (async () => {
        const errors: unknown[] = []
        try {
          await activeReader?.cancel()
        } catch (error) {
          errors.push(error)
        }
        try {
          await readOwner
        } catch (error) {
          errors.push(error)
        }
        errors.push(...readCleanupErrors.splice(0))
        try {
          await writer.close()
        } catch (error) {
          errors.push(error)
        }
        try {
          writer.releaseLock()
        } catch (error) {
          errors.push(error)
        }
        await drainTerminalListenerFailures(errors, {
          code: WebRpcErrorCode.transport,
          message: WebRpcErrorText.webTransportCleanupFailed,
          secondaryFailures
        })
      })()
      return closePromise
    },
    onTransportError(listener) {
      transportErrors.add(listener)
      if (terminalOccurred) {
        observeListener(
          () => listener(terminalError),
          (error) => collectListenerFailure(secondaryFailures, error),
          secondaryFailures
        )
      }
      return () => {
        const deleted = transportErrors.delete(listener)
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
