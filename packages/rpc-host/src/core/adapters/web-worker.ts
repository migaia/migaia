import type { IRpcCarrierProbe } from '../probe/types.js'
import { RpcCarrierDetailKey } from './probe-detail.js'
import { carrierSizeBytes, captureTransferredContent } from './probe-content.js'
import { createRpcTransportError, identifyRpcBoundaryFailure, tagRpcError } from '../errors.js'
import { registerBatchAgreement } from '../internal/batch-frame.js'
import { RpcCapability } from '@migaia/rpc-contract/wire'
import { RpcAdapterErrorText as BrowserRpcErrorText } from './error-text.js'
import type { IRpcSendOptions, IRpcTransport } from '../transport.js'
import { RpcPlatform, RpcTransportOwnership } from '../transport-constants.js'
import {
  createListenerFailureState,
  collectListenerCleanupFailures,
  drainTerminalListenerFailures,
  drainListenerFailures,
  observeListener,
  registerListeners,
  releaseListenerRegistration,
  reportListenerFailure
} from '../internal/listener-safety.js'
import { createMessageListenerHub } from '../internal/message-listener-hub.js'
import { safeString } from '../internal/safe-value.js'

import { RpcCoreErrorCode } from '../errors.js'

/**
 * Minimal event-listener worker/port surface — a real `Worker`, `MessagePort`, or
 * `SharedWorker.port` all satisfy this. Deliberately not `Worker` itself: shared workers and ports
 * must not use a mutable `onmessage` slot (that would silently steal another listener's
 * subscription). The event and transfer shapes are structural, so the declaration needs no DOM or
 * Node types; a real `Worker`/`MessagePort` is assignable.
 */
export type IWebWorkerLikePort = {
  /** Send via the original Worker/port with the selected physical transfer list. */
  postMessage(message: unknown, transfer?: readonly unknown[]): void
  /** Register one native message or failure observer without replacing other listeners. */
  addEventListener(
    type: 'message' | 'error' | 'messageerror',
    listener: (event: IWebWorkerPortEvent) => void
  ): void
  /** Remove the adapter's exact native listener. */
  removeEventListener(
    type: 'message' | 'error' | 'messageerror',
    listener: (event: IWebWorkerPortEvent) => void
  ): void
}

/** The fields this adapter reads from a native message, error or messageerror event. */
export type IWebWorkerPortEvent = {
  /** Native ErrorEvent retains the actual failure independently from its presentation message. */
  readonly error?: unknown
  /** Native message payload, absent on ordinary failure events. */
  readonly data?: unknown
  /** Native delivery origin, if available. */
  readonly origin?: unknown
  /** Native delivery source object, if available. */
  readonly source?: unknown
  /** Native event kind used for diagnostics. */
  readonly type?: string
}

/** Static metadata for a dedicated worker channel whose peer is known by construction. */
export type IWebWorkerTransportOptions = {
  /** Explicit static agreement; both deployment endpoints must use the same capabilities. */
  readonly capabilities?: readonly string[]
  /** Optional static direct-peer address known by deployment. */
  readonly peerId?: string
  /** Optional expected native origin used in connection verification. */
  readonly origin?: string
}

/**
 * Wraps a Worker/MessagePort-like object as an `RpcTransport`. `error` and `messageerror` (script
 * failure, structured-clone failure) have no message payload of their own — they're surfaced
 * through `onTransportError`, which the endpoint uses to fail every pending call at once instead of
 * leaving them hanging with no response ever coming.
 */
/** Allocate native carrier state before any lazy subscription is published. */
function webWorkerTransportState(
  port: IWebWorkerLikePort,
  options: IWebWorkerTransportOptions = {}
) {
  /** The sole installed probe is replaced per observation generation. */
  const probe = undefined as IRpcCarrierProbe | undefined
  /** Disposers compare generations even when the same probe object is installed twice. */
  let probeGeneration = 0
  /** Reused detail belongs to this adapter; recipients consume it synchronously. */
  const probeDetail = { [RpcCarrierDetailKey.transfers]: -1 }
  /** Adapter retirement never terminates its borrowed native Worker. */
  let closed = false
  /** Repeated close shares its first cleanup result. */
  const closeResult = undefined as void | Promise<void>
  /**
   * The original logical message hub shares native receive registration without changing listener
   * order.
   */
  const messageListeners = createMessageListenerHub<{
    data: unknown
    origin?: string
    source?: unknown
  }>()
  /**
   * Transport error registrations preserve their original physical-listener generation and failure
   * delivery.
   */
  const errorListeners = new Set<(error: unknown) => void>()
  /** Listener failures remain isolated through the original diagnostic registration owner. */
  const listenerErrors = new Set<(error: unknown) => void>()
  /**
   * Secondary reporter and cleanup failures stay retained until the existing failure drain observes
   * them.
   */
  const secondaryFailures = createListenerFailureState()

  return {
    probe,
    probeGeneration,
    probeDetail,
    closed,
    closeResult,
    messageListeners,
    errorListeners,
    listenerErrors,
    secondaryFailures,
    port,
    options
  }
}

/** Own one native carrier projection; event callbacks retain only this explicit instance. */
class WebWorkerTransport {
  /** All mutable observation, listener and close state belongs to this native carrier. */
  #state: ReturnType<typeof webWorkerTransportState>
  /** The exact native failure callback remains stable until the last listener is released. */
  #onError: (event: IWebWorkerPortEvent) => void
  /** The exact native failure callback remains stable until the last listener is released. */
  #onMessageError: (event: IWebWorkerPortEvent) => void
  /** Original transport metadata and callback identities remain on the same public object. */
  readonly value: IRpcTransport<unknown, unknown>
  /** Initialize state before publishing lazy native registrations or private carrier capabilities. */
  constructor(port: IWebWorkerLikePort, options: IWebWorkerTransportOptions = {}) {
    this.#state = webWorkerTransportState(port, options)
    this.#onError = this.#onFailure(BrowserRpcErrorText.workerFailedReason)
    this.#onMessageError = this.#onFailure(BrowserRpcErrorText.workerMessageErrorReason)
    /** The transport retains its original own enumerable operation keys. */
    const transport: IRpcTransport<unknown, unknown> = {
      platform: RpcPlatform.worker,
      topology: 'exclusive',
      ownership: RpcTransportOwnership.borrowed,
      peerId: this.#state.options.peerId,
      origin: this.#state.options.origin,
      closed: false,
      /** Replace observation; the returned disposer retires only its own installation generation. */
      observe: this.#observe,
      send: this.#send,
      // Attached lazily on first subscriber, detached once the last one
      // leaves — a client that closes must not leave the underlying port
      // still holding real listeners it can no longer reach.
      subscribe: this.#subscribe,
      /** Retire observation and detach borrowed native hooks without terminating the Worker. */
      close: this.#close,
      onTransportError: this.#onTransportError,
      onListenerError: this.#onListenerError
    }

    Object.defineProperty(transport, 'closed', {
      configurable: true,
      enumerable: true,
      get: () => this.#state.closed
    })
    this.value = registerBatchAgreement(
      transport,
      this.#state.options.capabilities ?? [RpcCapability.batch]
    )
  }
  /** Handle this native carrier event through its original listener failure owner. */
  #emitTransportError = (error: unknown): void => {
    reportListenerFailure(error, this.#state.errorListeners, this.#state.secondaryFailures)
  }

  /** Handle this native carrier event through its original listener failure owner. */
  #onMessage = (event: IWebWorkerPortEvent): void => {
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
        this.#emitTransportError(
          createRpcTransportError(BrowserRpcErrorText.workerMessageReadFailed(''), conversionError)
        )
        return undefined
      })
      this.#emitTransportError(
        tagRpcError(
          new Error(BrowserRpcErrorText.workerMessageReadFailed(detail), { cause: error }),
          RpcCoreErrorCode.transport
        )
      )
      return
    }
    if (this.#state.probe !== undefined) {
      /** One event retains the installed handle even if its callback replaces observation. */
      const currentProbe = this.#state.probe
      try {
        this.#state.probeDetail[RpcCarrierDetailKey.transfers] = -1
        currentProbe.emit(
          1,
          carrierSizeBytes(data),
          RpcPlatform.worker,
          this.#state.probeDetail,
          currentProbe.capturing ? data : undefined
        )
      } catch (error) {
        reportListenerFailure(
          createRpcTransportError(BrowserRpcErrorText.probeFailed, error),
          this.#state.listenerErrors,
          this.#state.secondaryFailures
        )
      }
    }
    this.#state.messageListeners.dispatch({ data, origin, source }, (listener, message) => {
      observeListener(
        () => listener(message),
        (error) =>
          reportListenerFailure(error, this.#state.listenerErrors, this.#state.secondaryFailures),
        this.#state.secondaryFailures
      )
    })
  }

  /** Handle this native carrier event through its original listener failure owner. */
  #onFailure =
    (reason: string) =>
    (event: IWebWorkerPortEvent): void => {
      let detail: string
      /** Native event causes remain local diagnostic references instead of being rebuilt as text. */
      let cause: unknown
      try {
        cause = event?.error
        detail = safeString(
          (event as unknown as { message?: string } | undefined)?.message || reason,
          reason,
          ({ error }) => {
            this.#emitTransportError(
              createRpcTransportError(BrowserRpcErrorText.workerFailure(reason, reason), error)
            )
            return undefined
          }
        )
      } catch (error) {
        cause = error
        this.#emitTransportError(
          createRpcTransportError(BrowserRpcErrorText.workerFailure(reason, reason), error)
        )
        detail = reason
      }
      this.#emitTransportError(
        tagRpcError(
          new Error(
            BrowserRpcErrorText.workerFailure(reason, detail),
            cause === undefined ? undefined : { cause }
          ),
          RpcCoreErrorCode.transport
        )
      )
    }
  /** Replace observation; the returned disposer retires only its own installation generation. */
  #observe: NonNullable<IRpcTransport<unknown, unknown>['observe']> = (next) => {
    /** Every installation replaces the prior generation, including equal probe identities. */
    const generation = ++this.#state.probeGeneration
    if (!this.#state.closed) this.#state.probe = next
    return () => {
      if (generation === this.#state.probeGeneration) this.#state.probe = undefined
    }
  }

  /** Preserve the native send operation and its original registration or settlement lifetime. */
  #send: NonNullable<IRpcTransport<unknown, unknown>['send']> = (
    message,
    options?: IRpcSendOptions<unknown>
  ) => {
    if (this.#state.closed) throw createRpcTransportError(BrowserRpcErrorText.workerClosed)
    /** Read the native transfer option once; observation cannot select a different list. */
    const transfer = options?.transfer
    if (this.#state.probe !== undefined) {
      /** One event retains the installed handle even if its callback replaces observation. */
      const currentProbe = this.#state.probe
      try {
        this.#state.probeDetail[RpcCarrierDetailKey.transfers] = transfer?.length ?? 0
        currentProbe.emit(
          0,
          carrierSizeBytes(message),
          RpcPlatform.worker,
          this.#state.probeDetail,
          currentProbe.capturing ? captureTransferredContent(message, transfer) : undefined
        )
      } catch (error) {
        reportListenerFailure(
          createRpcTransportError(BrowserRpcErrorText.probeFailed, error),
          this.#state.listenerErrors,
          this.#state.secondaryFailures
        )
      }
    }
    try {
      this.#state.port.postMessage(message, transfer)
    } catch (error) {
      throw identifyRpcBoundaryFailure(
        error,
        RpcCoreErrorCode.transport,
        BrowserRpcErrorText.nativeSendFailed
      )
    }
  }

  /** Preserve the native subscribe operation and its original registration or settlement lifetime. */
  #subscribe: NonNullable<IRpcTransport<unknown, unknown>['subscribe']> = (listener) => {
    if (this.#state.closed) throw createRpcTransportError(BrowserRpcErrorText.workerClosed)
    this.#state.messageListeners.add(listener, () =>
      registerListeners(
        [
          {
            add: () => this.#state.port.addEventListener('message', this.#onMessage),
            remove: () => this.#state.port.removeEventListener('message', this.#onMessage)
          }
        ],
        { code: RpcCoreErrorCode.transport, secondaryFailures: this.#state.secondaryFailures }
      )
    )
    return () => {
      if (!this.#state.messageListeners.has(listener)) return
      releaseListenerRegistration(
        this.#state.messageListeners.size === 1
          ? [() => this.#state.port.removeEventListener('message', this.#onMessage)]
          : [],
        () => this.#state.messageListeners.remove(listener, () => undefined),
        { code: RpcCoreErrorCode.transport, secondaryFailures: this.#state.secondaryFailures }
      )
    }
  }

  /** Retire observation and detach borrowed native hooks without terminating the Worker. */
  #close: NonNullable<IRpcTransport<unknown, unknown>['close']> = () => {
    if (this.#state.closed) return this.#state.closeResult
    this.#state.closed = true
    this.#state.probe = undefined
    this.#state.messageListeners.clear(() => undefined)
    this.#state.closeResult = drainTerminalListenerFailures(
      collectListenerCleanupFailures([
        () => this.#state.port.removeEventListener('message', this.#onMessage),
        () => this.#state.port.removeEventListener('error', this.#onError),
        () => this.#state.port.removeEventListener('messageerror', this.#onMessageError)
      ]),
      {
        code: RpcCoreErrorCode.transport,
        message: BrowserRpcErrorText.workerCleanupFailed,
        secondaryFailures: this.#state.secondaryFailures,
        aggregateSingle: true
      }
    )
    return this.#state.closeResult
  }

  /**
   * Preserve the native onTransportError operation and its original registration or settlement
   * lifetime.
   */
  #onTransportError: NonNullable<IRpcTransport<unknown, unknown>['onTransportError']> = (
    listener
  ) => {
    if (!this.#state.closed && this.#state.errorListeners.size === 0) {
      registerListeners(
        [
          {
            add: () => this.#state.port.addEventListener('error', this.#onError),
            remove: () => this.#state.port.removeEventListener('error', this.#onError)
          },
          {
            add: () => this.#state.port.addEventListener('messageerror', this.#onMessageError),
            remove: () => this.#state.port.removeEventListener('messageerror', this.#onMessageError)
          }
        ],
        { code: RpcCoreErrorCode.transport, secondaryFailures: this.#state.secondaryFailures }
      )
    }
    this.#state.errorListeners.add(listener)
    return () => {
      if (!this.#state.errorListeners.has(listener)) return
      releaseListenerRegistration(
        this.#state.errorListeners.size === 1
          ? [
              () => this.#state.port.removeEventListener('error', this.#onError),
              () => this.#state.port.removeEventListener('messageerror', this.#onMessageError)
            ]
          : [],
        () => {
          this.#state.errorListeners.delete(listener)
        },
        { code: RpcCoreErrorCode.transport, secondaryFailures: this.#state.secondaryFailures }
      )
    }
  }

  /**
   * Preserve the native onListenerError operation and its original registration or settlement
   * lifetime.
   */
  #onListenerError: NonNullable<IRpcTransport<unknown, unknown>['onListenerError']> = (
    listener
  ) => {
    this.#state.listenerErrors.add(listener)
    return () => {
      const deleted = this.#state.listenerErrors.delete(listener)
      drainListenerFailures([], {
        code: RpcCoreErrorCode.transport,
        secondaryFailures: this.#state.secondaryFailures
      })
      return deleted
    }
  }
}

/** Construct one explicit native carrier owner while preserving the original transport boundary. */
export function createWebWorkerTransport(
  port: IWebWorkerLikePort,
  options: IWebWorkerTransportOptions = {}
): IRpcTransport<unknown, unknown> {
  return new WebWorkerTransport(port, options).value
}
