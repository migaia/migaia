import { BrowserCarrierObservation, BrowserRpcCarrier } from '../probe-detail.js'
import type { IRpcTransport } from '@migaia/rpc-host/plugin'
import {
  RpcPlatform,
  RpcTransportOwnership,
  collectListenerFailure,
  createListenerFailureState,
  createMessageListenerHub,
  drainListenerFailures,
  drainTerminalListenerFailures,
  identifyRpcBoundaryFailure,
  observeListener,
  reportListenerFailure
} from '@migaia/rpc-host/plugin'
import { isUint8Array } from '@migaia/utils/bytes'
import { RPC_CORE_ERROR_SOURCE, RpcCoreErrorCode } from '@migaia/rpc-host'
import { createBrowserTransportError } from '../error.js'
import { attachErrorIdentity } from '@migaia/utils/error'
import { BrowserRpcErrorText } from '../error-text.js'

/** Minimal datagram surface accepted by the WebTransport adapter. */
export type IWebTransportDatagrams = {
  /** Unlocked outgoing datagram stream; construction immediately acquires its sole writer. */
  writable: WritableStream<Uint8Array>
  /** Incoming datagram stream; the first subscription acquires the transport-owned reader. */
  readable: ReadableStream<Uint8Array>
}

/**
 * Adapt datagram streams as an owned exclusive byte transport. Every send must be Uint8Array; other
 * sends throw TypeError/INVALID_CONFIG. An Endpoint integration needs both a byte codec and a
 * framer that emits only Uint8Array; this package supplies no ready-made combination. Datagrams do
 * not provide the ordered reliable delivery required by Runtime Peer.
 *
 * The writer is acquired now and the reader on first subscribe. Unsubscribe does not stop that
 * reader. Read failure or EOF marks closed, clears business listeners and reports TRANSPORT; late
 * error subscribers receive the terminal failure. Write rejection preserves its native exception or
 * cause through Core's boundary. Probe/listener failures use onListenerError.
 *
 * Close returns one shared Promise, cancels and joins the reader, closes/releases the writer and
 * rejects with cleanup failures without skipping the remaining cleanup. Later send/subscribe
 * reject. Only these stream resources are owned; the caller still closes the WebTransport session.
 */
export function createWebTransportDatagramTransport(
  datagrams: IWebTransportDatagrams
): IRpcTransport<Uint8Array> {
  const writer = datagrams.writable.getWriter()
  const listeners = createMessageListenerHub<{ data: Uint8Array }>()
  const listenerErrors = new Set<(error: unknown) => void>()
  const transportErrors = new Set<(error: unknown) => void>()
  const secondaryFailures = createListenerFailureState()
  /** Observation failures use listener reporting so Endpoint never rejects pending business calls. */
  const observation = new BrowserCarrierObservation(BrowserRpcCarrier.webTransport, (error) =>
    reportListenerFailure(error, listenerErrors, secondaryFailures)
  )
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
    observation.close()
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
          transitionTerminal(
            attachErrorIdentity(new Error(BrowserRpcErrorText.webTransportDatagramStreamEnded), {
              source: RPC_CORE_ERROR_SOURCE,
              code: RpcCoreErrorCode.transport
            })
          )
          break
        }
        /** Datagram content is observed by reference before existing business dispatch. */
        const probe = observation.probe
        if (probe !== undefined) observation.emit(probe, 1, result.value)
        listeners.dispatch({ data: result.value }, (listener, message) =>
          observeListener(
            () => listener(message),
            (error) => reportListenerFailure(error, listenerErrors, secondaryFailures),
            secondaryFailures
          )
        )
      }
    } catch (error) {
      transitionTerminal(
        identifyRpcBoundaryFailure(
          error,
          RpcCoreErrorCode.transport,
          BrowserRpcErrorText.carrierOperationFailed
        )
      )
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
    platform: RpcPlatform.webTransport,
    topology: 'exclusive',
    encodedType: 'uint8array',
    ownership: RpcTransportOwnership.owned,
    get closed() {
      return closed
    },
    send(message) {
      if (closed) throw createBrowserTransportError(BrowserRpcErrorText.webTransportIsClosed)
      if (!isUint8Array(message))
        throw attachErrorIdentity(
          new TypeError(BrowserRpcErrorText.webTransportRequiresUint8ArrayEncodedMessages),
          { source: RPC_CORE_ERROR_SOURCE, code: RpcCoreErrorCode.invalidConfig }
        )
      /** Classify rejection through Core's shared boundary; mutable native errors keep identity. */
      const probe = observation.probe
      if (probe !== undefined) observation.emit(probe, 0, message)
      return writer.write(message).catch((error) => {
        throw identifyRpcBoundaryFailure(
          error,
          RpcCoreErrorCode.transport,
          BrowserRpcErrorText.carrierOperationFailed
        )
      })
    },
    /** Replace the single endpoint probe; disposal is generation-safe and idempotent. */
    observe(probe) {
      return observation.observe(probe)
    },
    subscribe(listener) {
      if (closed) throw createBrowserTransportError(BrowserRpcErrorText.webTransportIsClosed)
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
        drainListenerFailures([], { code: RpcCoreErrorCode.transport, secondaryFailures })
        return deleted
      }
    },
    close() {
      if (closePromise) return closePromise
      closed = true
      observation.close()
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
          code: RpcCoreErrorCode.transport,
          message: BrowserRpcErrorText.webTransportCleanupFailed,
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
        drainListenerFailures([], { code: RpcCoreErrorCode.transport, secondaryFailures })
        return deleted
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
