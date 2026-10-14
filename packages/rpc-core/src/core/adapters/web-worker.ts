import type { IRpcCarrierProbe } from '../probe/types.js'
import { RpcCarrierDetailKey } from './probe-detail.js'
import { carrierSizeBytes, captureTransferredContent } from './probe-content.js'
import { createRpcTransportError, tagRpcError } from '../errors.js'
import { registerBatchAgreement } from '../internal/batch-frame.js'
import { RpcCapability } from '@migaia/rpc-contract/wire'
import { RpcAdapterErrorText as BrowserRpcErrorText } from './error-text.js'
import type { IRpcSendOptions, IRpcTransport } from '../transport-kit.js'
import {
  RpcPlatform,
  RpcTransportOwnership,
  createListenerFailureState,
  collectListenerCleanupFailures,
  drainTerminalListenerFailures,
  createMessageListenerHub,
  drainListenerFailures,
  observeListener,
  registerListeners,
  releaseListenerRegistration,
  reportListenerFailure,
  safeString
} from '../transport-kit.js'

import { RpcCoreErrorCode } from '../index.js'

/**
 * Minimal event-listener worker/port surface — a real `Worker`, `MessagePort`, or
 * `SharedWorker.port` all satisfy this. Deliberately not `Worker` itself: shared workers and ports
 * must not use a mutable `onmessage` slot (that would silently steal another listener's
 * subscription). The event and transfer shapes are structural, so the declaration needs no DOM or
 * Node types; a real `Worker`/`MessagePort` is assignable.
 */
export type IWebWorkerLikePort = {
  postMessage(message: unknown, transfer?: readonly unknown[]): void
  addEventListener(
    type: 'message' | 'error' | 'messageerror',
    listener: (event: IWebWorkerPortEvent) => void
  ): void
  removeEventListener(
    type: 'message' | 'error' | 'messageerror',
    listener: (event: IWebWorkerPortEvent) => void
  ): void
}

/** The fields this adapter reads from a native message, error or messageerror event. */
export type IWebWorkerPortEvent = {
  readonly data?: unknown
  readonly origin?: unknown
  readonly source?: unknown
  readonly type?: string
}

/** Static metadata for a dedicated worker channel whose peer is known by construction. */
export type IWebWorkerTransportOptions = {
  /** Explicit static agreement; both deployment endpoints must use the same capabilities. */
  readonly capabilities?: readonly string[]
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
): IRpcTransport<unknown, unknown> {
  /** The sole installed probe is replaced per observation generation. */
  let probe: IRpcCarrierProbe | undefined
  /** Disposers compare generations even when the same probe object is installed twice. */
  let probeGeneration = 0
  /** Reused detail belongs to this adapter; recipients consume it synchronously. */
  const probeDetail = { [RpcCarrierDetailKey.transfers]: -1 }
  /** Adapter retirement never terminates its borrowed native Worker. */
  let closed = false
  /** Repeated close shares its first cleanup result. */
  let closeResult: void | Promise<void>
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
  const onMessage = (event: IWebWorkerPortEvent): void => {
    let data: unknown
    let origin: string | undefined
    let source: unknown
    try {
      data = (event as IWebWorkerPortEvent | undefined)?.data
      const eventOrigin = (event as { origin?: unknown }).origin
      origin = typeof eventOrigin === 'string' ? eventOrigin : undefined
      source = (event as { source?: unknown }).source
    } catch (error) {
      const detail = safeString(error, undefined, ({ error: conversionError }) => {
        emitTransportError(
          createRpcTransportError(BrowserRpcErrorText.workerMessageReadFailed(''), conversionError)
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
    if (probe !== undefined) {
      /** One event retains the installed handle even if its callback replaces observation. */
      const currentProbe = probe
      try {
        probeDetail[RpcCarrierDetailKey.transfers] = -1
        currentProbe.emit(
          1,
          carrierSizeBytes(data),
          RpcPlatform.worker,
          probeDetail,
          currentProbe.capturing ? data : undefined
        )
      } catch (error) {
        reportListenerFailure(
          createRpcTransportError(BrowserRpcErrorText.probeFailed, error),
          listenerErrors,
          secondaryFailures
        )
      }
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
    (event: IWebWorkerPortEvent): void => {
      let detail: string
      try {
        detail = safeString(
          (event as unknown as { message?: string } | undefined)?.message || reason,
          reason,
          ({ error }) => {
            emitTransportError(
              createRpcTransportError(BrowserRpcErrorText.workerFailure(reason, reason), error)
            )
            return undefined
          }
        )
      } catch (error) {
        emitTransportError(
          createRpcTransportError(BrowserRpcErrorText.workerFailure(reason, reason), error)
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
  const onError = onFailure(BrowserRpcErrorText.workerFailedReason)
  const onMessageError = onFailure(BrowserRpcErrorText.workerMessageErrorReason)

  /** The canonical factory is the sole owner of this static deployment agreement. */
  const transport: IRpcTransport<unknown, unknown> = {
    platform: RpcPlatform.worker,
    topology: 'exclusive',
    ownership: RpcTransportOwnership.borrowed,
    peerId: options.peerId,
    origin: options.origin,
    get closed() {
      return closed
    },
    /** Replace observation; the returned disposer retires only its own installation generation. */
    observe(next) {
      /** Every installation replaces the prior generation, including equal probe identities. */
      const generation = ++probeGeneration
      if (!closed) probe = next
      return () => {
        if (generation === probeGeneration) probe = undefined
      }
    },
    send(message, options?: IRpcSendOptions<unknown>) {
      if (closed) throw createRpcTransportError(BrowserRpcErrorText.workerClosed)
      /** Read the native transfer option once; observation cannot select a different list. */
      const transfer = options?.transfer
      if (probe !== undefined) {
        /** One event retains the installed handle even if its callback replaces observation. */
        const currentProbe = probe
        try {
          probeDetail[RpcCarrierDetailKey.transfers] = transfer?.length ?? 0
          currentProbe.emit(
            0,
            carrierSizeBytes(message),
            RpcPlatform.worker,
            probeDetail,
            currentProbe.capturing ? captureTransferredContent(message, transfer) : undefined
          )
        } catch (error) {
          reportListenerFailure(
            createRpcTransportError(BrowserRpcErrorText.probeFailed, error),
            listenerErrors,
            secondaryFailures
          )
        }
      }
      port.postMessage(message, transfer)
    },
    // Attached lazily on first subscriber, detached once the last one
    // leaves — a client that closes must not leave the underlying port
    // still holding real listeners it can no longer reach.
    subscribe(listener) {
      if (closed) throw createRpcTransportError(BrowserRpcErrorText.workerClosed)
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
    /** Retire observation and detach borrowed native hooks without terminating the Worker. */
    close() {
      if (closed) return closeResult
      closed = true
      probe = undefined
      messageListeners.clear(() => undefined)
      closeResult = drainTerminalListenerFailures(
        collectListenerCleanupFailures([
          () => port.removeEventListener('message', onMessage),
          () => port.removeEventListener('error', onError),
          () => port.removeEventListener('messageerror', onMessageError)
        ]),
        {
          code: RpcCoreErrorCode.transport,
          message: BrowserRpcErrorText.workerCleanupFailed,
          secondaryFailures,
          aggregateSingle: true
        }
      )
      return closeResult
    },
    onTransportError(listener) {
      if (!closed && errorListeners.size === 0) {
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
  return registerBatchAgreement(transport, options.capabilities ?? [RpcCapability.batch])
}
