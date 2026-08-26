import { WebRpcErrorCode, WebRpcTransportError } from '../errors.js'
import type { IWebRpcTransport } from '../transport.js'
import { WebRpcPlatform, WebRpcTransportOwnership } from '../protocol-constants.js'
import {
  createListenerFailureState,
  drainListenerFailures,
  drainTerminalListenerFailures,
  observeListener,
  reportListenerFailure
} from '../internal/listener-safety.js'

export type IMemoryTransport = IWebRpcTransport & {
  /**
   * Tears down the whole pair — closing either side closes both; after this, `send()` on either
   * throws.
   */
  close(): void
  readonly closed: boolean
}

/**
 * Same-process, no-DOM transport — mainly for tests and for wiring a client and server together
 * without a real channel. Delivery is queued as a microtask (not synchronous) so behavior matches a
 * real async transport: code that assumes "the other side hasn't seen this yet" immediately after
 * `send()` returns stays correct.
 */
export function createMemoryTransportPair(): readonly [IMemoryTransport, IMemoryTransport] {
  const listenersA = new Set<(message: { data: unknown }) => void>()
  const listenersB = new Set<(message: { data: unknown }) => void>()
  let closed = false
  const errorsA = new Set<(error: unknown) => void>(),
    errorsB = new Set<(error: unknown) => void>()
  const listenerErrorsA = new Set<(error: unknown) => void>(),
    listenerErrorsB = new Set<(error: unknown) => void>()
  const secondaryFailuresA = createListenerFailureState(),
    secondaryFailuresB = createListenerFailureState()
  let closeStarted = false
  let closeResult: void | Promise<void>

  const makeSide = (
    outgoing: Set<(message: { data: unknown }) => void>,
    incoming: Set<(message: { data: unknown }) => void>,
    errors: Set<(error: unknown) => void>,
    listenerErrors: Set<(error: unknown) => void>,
    remoteListenerErrors: Set<(error: unknown) => void>,
    secondaryFailures: ReturnType<typeof createListenerFailureState>,
    remoteSecondaryFailures: ReturnType<typeof createListenerFailureState>
  ): IMemoryTransport => ({
    platform: WebRpcPlatform.memory,
    topology: 'exclusive',
    ownership: WebRpcTransportOwnership.borrowed,
    send(message) {
      if (closed) throw new WebRpcTransportError('[rpc] memory transport is closed')
      queueMicrotask(() => {
        // Closed between send() and delivery — the other side is gone,
        // there is nobody left to deliver to.
        if (closed) return
        for (const listener of Array.from(outgoing)) {
          observeListener(
            () => listener({ data: message }),
            (error) => reportListenerFailure(error, remoteListenerErrors, remoteSecondaryFailures),
            remoteSecondaryFailures
          )
        }
      })
    },
    subscribe(listener) {
      incoming.add(listener)
      return () => {
        const deleted = incoming.delete(listener)
        drainListenerFailures([], { code: WebRpcErrorCode.transport, secondaryFailures })
        return deleted
      }
    },
    close() {
      if (closeStarted) return closeResult
      closeStarted = true
      closed = true
      reportListenerFailure(
        new Error('[rpc] memory transport is closed'),
        errorsA,
        secondaryFailuresA
      )
      reportListenerFailure(
        new Error('[rpc] memory transport is closed'),
        errorsB,
        secondaryFailuresB
      )
      listenersA.clear()
      listenersB.clear()
      closeResult = drainTerminalListenerFailures([], {
        code: WebRpcErrorCode.transport,
        secondaryFailures: [secondaryFailuresA, secondaryFailuresB]
      })
      return closeResult
    },
    get closed() {
      return closed
    },
    onTransportError(listener) {
      errors.add(listener)
      return () => {
        const deleted = errors.delete(listener)
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
  })

  return [
    makeSide(
      listenersB,
      listenersA,
      errorsA,
      listenerErrorsA,
      listenerErrorsB,
      secondaryFailuresA,
      secondaryFailuresB
    ),
    makeSide(
      listenersA,
      listenersB,
      errorsB,
      listenerErrorsB,
      listenerErrorsA,
      secondaryFailuresB,
      secondaryFailuresA
    )
  ]
}
