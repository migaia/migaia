import type { IRpcCarrierProbe } from '../probe/types.js'
import { RpcCarrierDetailKey } from './probe-detail.js'
import { carrierSizeBytes, captureTransferredContent } from './probe-content.js'
import {
  createRpcTransportError,
  identifyRpcBoundaryFailure,
  RpcCoreErrorCode,
  tagRpcError
} from '../errors.js'
import { RpcAdapterErrorText } from './error-text.js'
import { registerCloneTransferCarrier } from '../internal/batch-frame.js'
import {
  createEventChannel,
  EventAdmissionPolicy,
  withSnapshotEntries
} from '@migaia/event-subscriber'

import { RpcCoreErrorText } from '../error-text.js'
import type { IRpcSendOptions, IRpcTransport } from '../transport.js'
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
import { createMessageListenerHub } from '../internal/message-listener-hub.js'
import { RpcPlatform, RpcTransportOwnership } from '../transport-constants.js'
import { RpcMessagePortErrorText } from './message-port-text.js'
import { bindNativeReplayTransport } from '../internal/native-replay.js'

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
  /** A projected Browser Peer preserves its original Window/RTC/Worker physical observer. */
  observe?: IRpcTransport['observe']
  postMessage(message: unknown, transfer?: readonly TTransfer[]): void
  start(): void
  close(): void
  addEventListener(type: 'message' | 'messageerror', listener: (event: TEvent) => void): void
  removeEventListener(type: 'message' | 'messageerror', listener: (event: TEvent) => void): void
  /** Optional physical failure observation preserves an adapter's original terminal error. */
  onError?(listener: (error: unknown) => void): () => void
}

/** Controls whether the browser adapter is allowed to close the supplied port. */
export type IBrowserMessagePortTransportOptions = {
  readonly ownership?: 'owned' | 'borrowed'
}

/** One diagnostic listener is identified by its original function. */
type IRpcErrorListener = (error: unknown) => void

/** Uses one channel for admission while keeping native-listener release generation-safe. */
function createErrorListenerChannel() {
  /** The channel is the only owner of listener registration and dispatch snapshots. */
  const channel = createEventChannel<unknown>({
    admissionPolicy: EventAdmissionPolicy.unique,
    report: () => undefined
  })
  /** Wrapper identity and generation only guard physical port detachment. */
  const wrappers = new WeakMap<
    IRpcErrorListener,
    { wrapper: (event: { value: unknown }) => void; generation: number; active: boolean }
  >()
  return {
    /** Counts live channel registrations for native listener attachment decisions. */
    get size(): number {
      return channel.size
    },
    /** Admits a listener and binds its disposer to that registration generation. */
    add(listener: IRpcErrorListener) {
      /** One stable wrapper makes repeated public listeners equal to the channel. */
      let record = wrappers.get(listener)
      if (record === undefined) {
        record = { wrapper: (event) => listener(event.value), generation: 0, active: false }
        wrappers.set(listener, record)
      }
      /** A size increase distinguishes a new generation from duplicate admission. */
      const before = channel.size
      /** The channel-owned disposer remains bound to this exact registration. */
      const dispose = channel.subscribe(record.wrapper)
      if (channel.size > before) {
        record.generation += 1
        record.active = true
      }
      /** Old closures compare against this generation before detaching native hooks. */
      const generation = record.generation
      return {
        isCurrent: (): boolean => record.generation === generation && record.active,
        release: (): boolean => {
          if (record.generation !== generation || !record.active) return false
          /** The count comparison reports whether this handle removed its owner. */
          const size = channel.size
          dispose()
          /** A stale handle is a no-op even if a newer owner uses the same function. */
          const removed = channel.size < size
          if (removed) record.active = false
          return removed
        }
      }
    },
    /** Preserves the existing ordered isolation and secondary-failure collector. */
    report(error: unknown, failures: ReturnType<typeof createListenerFailureState>): void {
      withSnapshotEntries(channel, error, (entries) =>
        reportListenerFailure(
          error,
          entries.map((entry) => () => entry.invoke()),
          failures
        )
      )
    }
  }
}

/** Wraps a browser MessagePort and owns its terminal lifecycle. */
export function createBrowserMessagePortTransport<TTransfer = unknown, TEvent = unknown>(
  port: IBrowserMessagePortLike<TTransfer, TEvent>,
  options: IBrowserMessagePortTransportOptions = {}
): IRpcTransport<unknown, TTransfer> {
  const messageListeners = createMessageListenerHub<{ data: unknown }>()
  const errorListeners = createErrorListenerChannel()
  const listenerErrors = createErrorListenerChannel()
  const secondaryFailures = createListenerFailureState()
  /** The sole installed probe is replaced per observation generation. */
  let probe: IRpcCarrierProbe | undefined
  /** Disposers compare generations even when the same probe object is installed twice. */
  let probeGeneration = 0
  /** Reused detail belongs to this adapter; recipients consume it synchronously. */
  const probeDetail = { [RpcCarrierDetailKey.transfers]: -1 }
  let closed = false
  let closeResult: void | Promise<void>
  const ownership = options.ownership ?? 'owned'
  /** This transport owns only its raw error subscription, never the borrowed physical port. */
  let removeRawError: (() => void) | undefined
  /** Raw carrier observation is released by this adapter's existing close owner. */
  let removeRawProbe: (() => void) | undefined
  const onMessage = (event: TEvent): void => {
    let readFailed = false
    const data = safeRead<unknown>(event, 'data', ({ error }) => {
      readFailed = true
      errorListeners.report(
        createRpcTransportError(RpcCoreErrorText.propertyReadFailed, error),
        secondaryFailures
      )
      return undefined
    })
    if (readFailed) return
    if (probe !== undefined) {
      /** One event retains the installed handle even if its callback replaces observation. */
      const currentProbe = probe
      try {
        probeDetail[RpcCarrierDetailKey.transfers] = -1
        currentProbe.emit(
          1,
          carrierSizeBytes(data),
          RpcPlatform.messagePort,
          probeDetail,
          currentProbe.capturing ? data : undefined
        )
      } catch (error) {
        listenerErrors.report(
          createRpcTransportError(RpcAdapterErrorText.probeFailed, error),
          secondaryFailures
        )
      }
    }
    messageListeners.dispatch({ data }, (listener, message) => {
      observeListener(
        () => listener(message),
        (error) => listenerErrors.report(error, secondaryFailures),
        secondaryFailures
      )
    })
  }
  const onMessageError = (): void => {
    const error = tagRpcError(
      new Error(RpcMessagePortErrorText.browserMessagePortDeserializeFailed),
      RpcCoreErrorCode.transport
    )
    errorListeners.report(error, secondaryFailures)
  }
  return registerCloneTransferCarrier({
    platform: RpcPlatform.messagePort,
    topology: 'exclusive',
    ownership,
    get closed() {
      return closed
    },
    /** Replace observation; the returned disposer retires only its own installation generation. */
    observe(next) {
      /** Registration remains inert after this adapter's terminal boundary. */
      const generation = ++probeGeneration
      removeRawProbe?.()
      removeRawProbe = undefined
      if (!closed) {
        if (port.observe !== undefined) {
          probe = undefined
          removeRawProbe = port.observe(next)
        } else probe = next
      }
      return () => {
        if (generation !== probeGeneration) return
        probe = undefined
        removeRawProbe?.()
        removeRawProbe = undefined
      }
    },
    send(message, options?: IRpcSendOptions<TTransfer>) {
      if (closed) throw createRpcTransportError(RpcMessagePortErrorText.browserMessagePortClosed)
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
            RpcPlatform.messagePort,
            probeDetail,
            currentProbe.capturing ? captureTransferredContent(message, transfer) : undefined
          )
        } catch (error) {
          listenerErrors.report(
            createRpcTransportError(RpcAdapterErrorText.probeFailed, error),
            secondaryFailures
          )
        }
      }
      try {
        port.postMessage(message, transfer)
      } catch (error) {
        throw identifyRpcBoundaryFailure(
          error,
          RpcCoreErrorCode.transport,
          RpcAdapterErrorText.nativeSendFailed
        )
      }
    },
    subscribe(listener) {
      if (closed) throw createRpcTransportError(RpcMessagePortErrorText.browserMessagePortClosed)
      messageListeners.add(listener, () =>
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
            {
              add: () => {
                removeRawError = port.onError?.((error) =>
                  errorListeners.report(error, secondaryFailures)
                )
              },
              remove: () => {
                removeRawError?.()
                removeRawError = undefined
              }
            },
            { add: () => port.start(), remove: () => undefined }
          ],
          { code: RpcCoreErrorCode.transport, secondaryFailures }
        )
      )
      return () => {
        if (!messageListeners.has(listener)) return
        releaseListenerRegistration(
          messageListeners.size === 1
            ? [
                () => port.removeEventListener('message', onMessage),
                () => port.removeEventListener('messageerror', onMessageError),
                () => {
                  removeRawError?.()
                  removeRawError = undefined
                }
              ]
            : [],
          () => {
            messageListeners.remove(listener, () => undefined)
          },
          { code: RpcCoreErrorCode.transport, secondaryFailures }
        )
      }
    },
    close() {
      if (closed) return closeResult
      closed = true
      probe = undefined
      messageListeners.clear(() => undefined)
      const cleanupErrors = collectListenerCleanupFailures([
        () => {
          removeRawProbe?.()
          removeRawProbe = undefined
        },
        () => port.removeEventListener('message', onMessage),
        () => port.removeEventListener('messageerror', onMessageError),
        () => {
          removeRawError?.()
          removeRawError = undefined
        }
      ])
      if (ownership === 'owned') {
        try {
          port.close()
        } catch (error) {
          cleanupErrors.push(error)
        }
      }
      closeResult = drainTerminalListenerFailures(cleanupErrors, {
        code: RpcCoreErrorCode.transport,
        message: RpcAdapterErrorText.messagePortCleanupFailed,
        secondaryFailures,
        aggregateSingle: true
      })
      return closeResult
    },
    onTransportError(listener) {
      const registration = errorListeners.add(listener)
      return () => {
        const deleted = registration.release()
        drainListenerFailures([], { code: RpcCoreErrorCode.transport, secondaryFailures })
        return deleted
      }
    },
    onListenerError(listener) {
      const registration = listenerErrors.add(listener)
      return () => {
        const deleted = registration.release()
        drainListenerFailures([], { code: RpcCoreErrorCode.transport, secondaryFailures })
        return deleted
      }
    }
  })
}

/**
 * Wraps a Node `worker_threads.MessagePort` (or anything with the same shape) as a web-rpc
 * transport.
 */
export function createNodeMessagePortTransport(port: INodeMessagePortLike): IRpcTransport {
  const messageListeners = createMessageListenerHub<{ data: unknown }>()
  const errorListeners = createErrorListenerChannel()
  const listenerErrors = createErrorListenerChannel()
  const secondaryFailures = createListenerFailureState()
  /** The sole installed probe is replaced per observation generation. */
  let probe: IRpcCarrierProbe | undefined
  /** Disposers compare generations even when the same probe object is installed twice. */
  let probeGeneration = 0
  /**
   * Logical channel close retires observation without claiming that the borrowed native port
   * closed.
   */
  let observationRetired = false
  /** Reused detail belongs to this adapter; recipients consume it synchronously. */
  const probeDetail = { [RpcCarrierDetailKey.transfers]: -1 }
  let closed = false
  let terminalReported = false
  let terminalError: Error | undefined

  const emitTransportError = (error: unknown): void => {
    errorListeners.report(error, secondaryFailures)
  }

  const onMessage = (message: unknown): void => {
    if (probe !== undefined) {
      /** One event retains the installed handle even if its callback replaces observation. */
      const currentProbe = probe
      try {
        probeDetail[RpcCarrierDetailKey.transfers] = -1
        currentProbe.emit(
          1,
          carrierSizeBytes(message),
          RpcPlatform.messagePort,
          probeDetail,
          currentProbe.capturing ? message : undefined
        )
      } catch (error) {
        listenerErrors.report(
          createRpcTransportError(RpcAdapterErrorText.probeFailed, error),
          secondaryFailures
        )
      }
    }
    messageListeners.dispatch({ data: message }, (listener, messageValue) => {
      observeListener(
        () => listener(messageValue),
        (error) => listenerErrors.report(error, secondaryFailures),
        secondaryFailures
      )
    })
  }
  // `error` here is an external boundary the same way a DOM event is —
  // stringifying it must not itself throw and escape as an uncaught
  // exception from inside Node's event emitter dispatch.
  const onMessageError = (error?: unknown): void => {
    const detail =
      error === undefined
        ? ''
        : `: ${safeString(error, RpcCoreErrorText.unknownError, ({ error: conversionError }) => {
            emitTransportError(
              createRpcTransportError(
                RpcMessagePortErrorText.messagePortDeserializeFailed(''),
                conversionError
              )
            )
            return undefined
          })}`
    emitTransportError(
      tagRpcError(
        new Error(RpcMessagePortErrorText.messagePortDeserializeFailed(detail)),
        RpcCoreErrorCode.transport
      )
    )
  }
  const onClose = (): void => {
    if (terminalReported) return
    terminalReported = true
    closed = true
    probe = undefined
    terminalError = tagRpcError(
      new Error(RpcMessagePortErrorText.messagePortTerminated),
      RpcCoreErrorCode.transport
    )
    emitTransportError(terminalError)
  }

  /** Only a previously registered native resource grants the final adapter private provenance. */
  const transport: IRpcTransport = {
    platform: RpcPlatform.messagePort,
    topology: 'exclusive',
    ownership: RpcTransportOwnership.borrowed,
    get closed() {
      return closed
    },
    /** Replace observation; the returned disposer retires only its own installation generation. */
    observe(next) {
      /** Registration remains inert after this adapter's terminal boundary. */
      const generation = ++probeGeneration
      if (!closed && !observationRetired) probe = next
      return () => {
        if (generation !== probeGeneration) return
        probe = undefined
      }
    },
    /** Retire only observation; the native close event keeps its original physical error ownership. */
    close() {
      observationRetired = true
      probe = undefined
    },
    send(message, options?: IRpcSendOptions) {
      if (closed) throw createRpcTransportError(RpcMessagePortErrorText.messagePortClosed)
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
            RpcPlatform.messagePort,
            probeDetail,
            currentProbe.capturing ? captureTransferredContent(message, transfer) : undefined
          )
        } catch (error) {
          listenerErrors.report(
            createRpcTransportError(RpcAdapterErrorText.probeFailed, error),
            secondaryFailures
          )
        }
      }
      try {
        port.postMessage(message, transfer)
      } catch (error) {
        throw identifyRpcBoundaryFailure(
          error,
          RpcCoreErrorCode.transport,
          RpcAdapterErrorText.nativeSendFailed
        )
      }
    },
    // Lazily attached/detached the same way as the web-worker adapter —
    // a client that closes must not leave the underlying port still
    // referencing listeners it can no longer reach.
    subscribe(listener) {
      if (closed) throw createRpcTransportError(RpcMessagePortErrorText.messagePortClosed)
      messageListeners.add(listener, () =>
        registerListeners(
          [
            {
              add: () => port.on('message', onMessage),
              remove: () => port.off('message', onMessage)
            }
          ],
          { code: RpcCoreErrorCode.transport, secondaryFailures }
        )
      )
      return () => {
        if (!messageListeners.has(listener)) return
        releaseListenerRegistration(
          messageListeners.size === 1 ? [() => port.off('message', onMessage)] : [],
          () => {
            messageListeners.remove(listener, () => undefined)
          },
          { code: RpcCoreErrorCode.transport, secondaryFailures }
        )
      }
    },
    onTransportError(listener) {
      if (!closed && errorListeners.size === 0)
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
          { code: RpcCoreErrorCode.transport, secondaryFailures }
        )
      const registration = errorListeners.add(listener)
      if (terminalError !== undefined) {
        observeListener(
          () => listener(terminalError),
          (error) => collectListenerFailure(secondaryFailures, error),
          secondaryFailures
        )
      }
      return () => {
        if (!registration.isCurrent()) return
        releaseListenerRegistration(
          errorListeners.size === 1
            ? [() => port.off('messageerror', onMessageError), () => port.off('close', onClose)]
            : [],
          () => {
            registration.release()
          },
          { code: RpcCoreErrorCode.transport, secondaryFailures }
        )
      }
    },
    onListenerError(listener) {
      const registration = listenerErrors.add(listener)
      return () => {
        const deleted = registration.release()
        drainListenerFailures([], { code: RpcCoreErrorCode.transport, secondaryFailures })
        return deleted
      }
    }
  }
  bindNativeReplayTransport(port, transport)
  return registerCloneTransferCarrier(transport)
}
