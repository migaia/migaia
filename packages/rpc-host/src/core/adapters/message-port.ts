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
  /** Send through the original native port, preserving the supplied transfer list. */
  postMessage(message: unknown, transferList?: readonly unknown[]): void
  /** Attach a native message or terminal listener without replacing another subscription. */
  on(event: 'message', listener: (message: unknown) => void): unknown
  /** Attach a native message or terminal listener without replacing another subscription. */
  on(event: 'messageerror' | 'close', listener: (error?: unknown) => void): unknown
  /** Remove the exact native listener registered by the adapter. */
  off(event: 'message' | 'messageerror' | 'close', listener: (...args: unknown[]) => void): unknown
}

/** Browser MessagePort surface with EventTarget lifecycle. */
export type IBrowserMessagePortLike<TTransfer = unknown, TEvent = unknown> = {
  /** A projected Browser Peer preserves its original Window/RTC/Worker physical observer. */
  observe?: IRpcTransport['observe']
  /** Send a native message and optional transfer list through this port. */
  postMessage(message: unknown, transfer?: readonly TTransfer[]): void
  /** Begin native queued message delivery after listeners are attached. */
  start(): void
  /** Close the physical port when this adapter owns it. */
  close(): void
  /** Attach one native message/error listener without replacing other subscribers. */
  addEventListener(type: 'message' | 'messageerror', listener: (event: TEvent) => void): void
  /** Detach the exact native registration. */
  removeEventListener(type: 'message' | 'messageerror', listener: (event: TEvent) => void): void
  /** Optional physical failure observation preserves an adapter's original terminal error. */
  onError?(listener: (error: unknown) => void): () => void
}

/** Controls whether the browser adapter is allowed to close the supplied port. */
export type IBrowserMessagePortTransportOptions = {
  /**
   * Defaults to owned, which closes the port; borrowed detaches adapter listeners without physical
   * close.
   */
  readonly ownership?: 'owned' | 'borrowed'
}

/** One diagnostic listener is identified by its original function. */
type IRpcErrorListener = (error: unknown) => void

/** One logical listener retains its wrapper identity across registration generations. */
type IErrorListenerRecord = {
  wrapper: (event: { value: unknown }) => void
  generation: number
  active: boolean
}

/** Each disposer can release only the exact listener generation that created it. */
class ErrorListenerRegistration {
  /** Channel membership remains the sole listener admission and size authority. */
  #channel: ReturnType<typeof createEventChannel<unknown>>
  /** Shared listener record advances only when the channel accepts a new registration. */
  #record: IErrorListenerRecord
  /** The immutable generation distinguishes an older disposer from a current registration. */
  #generation: number
  /** The original channel disposer owns actual listener removal. */
  #dispose: () => void

  /** Retain the native channel receipt without creating another listener or lifecycle owner. */
  constructor(
    channel: ReturnType<typeof createEventChannel<unknown>>,
    record: IErrorListenerRecord,
    generation: number,
    dispose: () => void
  ) {
    this.#channel = channel
    this.#record = record
    this.#generation = generation
    this.#dispose = dispose
  }
  /** An old or already released handle cannot detach a newer native subscription. */
  isCurrent = (): boolean => this.#record.generation === this.#generation && this.#record.active
  /** Return whether this exact handle removed the current channel listener. */
  release = (): boolean => {
    if (this.#record.generation !== this.#generation || !this.#record.active) return false
    /** The before/after count is the original channel-owned removal receipt. */
    const size = this.#channel.size
    ;(0, this.#dispose)()
    /** A stale channel disposer remains a no-op without retiring its successor. */
    const removed = this.#channel.size < size
    if (removed) this.#record.active = false
    return removed
  }
}

/** One adapter owns logical error registration while preserving native detach generations. */
class ErrorListenerChannel {
  /** The existing event channel alone owns admission and ordered dispatch snapshots. */
  #channel = createEventChannel<unknown>({
    admissionPolicy: EventAdmissionPolicy.unique,
    report: () => undefined
  })
  /** Wrapper identity and generation guard physical port detachment for each original listener. */
  #wrappers = new WeakMap<IRpcErrorListener, IErrorListenerRecord>()
  /** Native listeners are needed exactly while this logical channel has registrations. */
  get size(): number {
    return this.#channel.size
  }
  /** Admit one logical listener and bind its disposer to the resulting registration generation. */
  add = (listener: IRpcErrorListener): ErrorListenerRegistration => {
    /** A stable wrapper lets duplicate logical listeners reuse event-channel equality. */
    let record = this.#wrappers.get(listener)
    if (record === undefined) {
      record = { wrapper: (event) => listener(event.value), generation: 0, active: false }
      this.#wrappers.set(listener, record)
    }
    /** Only a size increase creates a new live registration generation. */
    const before = this.#channel.size
    /** The original event channel owns the exact disposer and listener lifetime. */
    const dispose = this.#channel.subscribe(record.wrapper)
    if (this.#channel.size > before) {
      record.generation += 1
      record.active = true
    }
    return new ErrorListenerRegistration(this.#channel, record, record.generation, dispose)
  }
  /** Preserve ordered failure isolation and the original secondary-error collector. */
  report = (error: unknown, failures: ReturnType<typeof createListenerFailureState>): void => {
    withSnapshotEntries(this.#channel, error, (entries) =>
      reportListenerFailure(
        error,
        entries.map((entry) => () => entry.invoke()),
        failures
      )
    )
  }
}

/** Allocate the adapter's sole logical error-channel owner. */
function createErrorListenerChannel() {
  return new ErrorListenerChannel()
}

/**
 * Wrap a browser MessagePort with lazy receive listeners. Ownership defaults to owned; borrowed
 * close only retires this wrapper and its listeners. Native send failures retain their original
 * cause.
 */
/** Allocate native carrier state before any lazy subscription is published. */
function browserMessagePortTransportState<TTransfer = unknown, TEvent = unknown>(
  port: IBrowserMessagePortLike<TTransfer, TEvent>,
  options: IBrowserMessagePortTransportOptions = {}
) {
  /**
   * The original logical message hub shares native receive registration without changing listener
   * order.
   */
  const messageListeners = createMessageListenerHub<{ data: unknown }>()
  /**
   * Transport error registrations preserve their original physical-listener generation and failure
   * delivery.
   */
  const errorListeners = createErrorListenerChannel()
  /** Listener failures remain isolated through the original diagnostic registration owner. */
  const listenerErrors = createErrorListenerChannel()
  /**
   * Secondary reporter and cleanup failures stay retained until the existing failure drain observes
   * them.
   */
  const secondaryFailures = createListenerFailureState()
  /** The sole installed probe is replaced per observation generation. */
  const probe = undefined as IRpcCarrierProbe | undefined
  /** Disposers compare generations even when the same probe object is installed twice. */
  let probeGeneration = 0
  /** Reused detail belongs to this adapter; recipients consume it synchronously. */
  const probeDetail = { [RpcCarrierDetailKey.transfers]: -1 }
  /** Terminal admission prevents sends and subscriptions from reviving this retired carrier. */
  let closed = false
  /** Repeated close returns the same first cleanup result, including its Promise identity. */
  const closeResult = undefined as void | Promise<void>
  /** The admitted option alone decides whether wrapper retirement may close the native port. */
  const ownership = options.ownership ?? 'owned'
  /** This transport owns only its raw error subscription, never the borrowed physical port. */
  const removeRawError = undefined as (() => void) | undefined
  /** Raw carrier observation is released by this adapter's existing close owner. */
  const removeRawProbe = undefined as (() => void) | undefined

  return {
    messageListeners,
    errorListeners,
    listenerErrors,
    secondaryFailures,
    probe,
    probeGeneration,
    probeDetail,
    closed,
    closeResult,
    ownership,
    removeRawError,
    removeRawProbe,
    port,
    options
  }
}

/** Own one native carrier projection; event callbacks retain only this explicit instance. */
class BrowserMessagePortTransport<TTransfer = unknown, TEvent = unknown> {
  /** All mutable observation, listener and close state belongs to this native carrier. */
  #state: ReturnType<typeof browserMessagePortTransportState<TTransfer, TEvent>>

  /** Original transport metadata and callback identities remain on the same public object. */
  readonly value: IRpcTransport<unknown, TTransfer>
  /** Initialize state before publishing lazy native registrations or private carrier capabilities. */
  constructor(
    port: IBrowserMessagePortLike<TTransfer, TEvent>,
    options: IBrowserMessagePortTransportOptions = {}
  ) {
    this.#state = browserMessagePortTransportState(port, options)

    /** The transport retains its original own enumerable operation keys. */
    const transport: IRpcTransport<unknown, TTransfer> = {
      platform: RpcPlatform.messagePort,
      topology: 'exclusive',
      ownership: this.#state.ownership,
      closed: false,
      observe: this.#observe,
      send: this.#send,
      subscribe: this.#subscribe,
      close: this.#close,
      onTransportError: this.#onTransportError,
      onListenerError: this.#onListenerError
    }
    Object.defineProperty(transport, 'closed', {
      configurable: true,
      enumerable: true,
      get: () => {
        return this.#state.closed
      }
    })

    this.value = registerCloneTransferCarrier(transport)
  }
  /** Handle this native carrier event through its original listener failure owner. */
  #onMessage = (event: TEvent): void => {
    let readFailed = false
    const data = safeRead<unknown>(event, 'data', ({ error }) => {
      readFailed = true
      this.#state.errorListeners.report(
        createRpcTransportError(RpcCoreErrorText.propertyReadFailed, error),
        this.#state.secondaryFailures
      )
      return undefined
    })
    if (readFailed) return
    if (this.#state.probe !== undefined) {
      /** One event retains the installed handle even if its callback replaces observation. */
      const currentProbe = this.#state.probe
      try {
        this.#state.probeDetail[RpcCarrierDetailKey.transfers] = -1
        currentProbe.emit(
          1,
          carrierSizeBytes(data),
          RpcPlatform.messagePort,
          this.#state.probeDetail,
          currentProbe.capturing ? data : undefined
        )
      } catch (error) {
        this.#state.listenerErrors.report(
          createRpcTransportError(RpcAdapterErrorText.probeFailed, error),
          this.#state.secondaryFailures
        )
      }
    }
    this.#state.messageListeners.dispatch({ data }, (listener, message) => {
      observeListener(
        () => listener(message),
        (error) => this.#state.listenerErrors.report(error, this.#state.secondaryFailures),
        this.#state.secondaryFailures
      )
    })
  }

  /** Handle this native carrier event through its original listener failure owner. */
  #onMessageError = (): void => {
    const error = tagRpcError(
      new Error(RpcMessagePortErrorText.browserMessagePortDeserializeFailed),
      RpcCoreErrorCode.transport
    )
    this.#state.errorListeners.report(error, this.#state.secondaryFailures)
  }
  /** Replace observation; the returned disposer retires only its own installation generation. */
  #observe: NonNullable<IRpcTransport<unknown, TTransfer>['observe']> = (next) => {
    /** Registration remains inert after this adapter's terminal boundary. */
    const generation = ++this.#state.probeGeneration
    this.#state.removeRawProbe?.()
    this.#state.removeRawProbe = undefined
    if (!this.#state.closed) {
      if (this.#state.port.observe !== undefined) {
        this.#state.probe = undefined
        this.#state.removeRawProbe = this.#state.port.observe(next)
      } else this.#state.probe = next
    }
    return () => {
      if (generation !== this.#state.probeGeneration) return
      this.#state.probe = undefined
      this.#state.removeRawProbe?.()
      this.#state.removeRawProbe = undefined
    }
  }

  /** Preserve the native send operation and its original registration or settlement lifetime. */
  #send: NonNullable<IRpcTransport<unknown, TTransfer>['send']> = (
    message,
    options?: IRpcSendOptions<TTransfer>
  ) => {
    if (this.#state.closed)
      throw createRpcTransportError(RpcMessagePortErrorText.browserMessagePortClosed)
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
          RpcPlatform.messagePort,
          this.#state.probeDetail,
          currentProbe.capturing ? captureTransferredContent(message, transfer) : undefined
        )
      } catch (error) {
        this.#state.listenerErrors.report(
          createRpcTransportError(RpcAdapterErrorText.probeFailed, error),
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
        RpcAdapterErrorText.nativeSendFailed
      )
    }
  }

  /** Preserve the native subscribe operation and its original registration or settlement lifetime. */
  #subscribe: NonNullable<IRpcTransport<unknown, TTransfer>['subscribe']> = (listener) => {
    if (this.#state.closed)
      throw createRpcTransportError(RpcMessagePortErrorText.browserMessagePortClosed)
    this.#state.messageListeners.add(listener, () =>
      registerListeners(
        [
          {
            add: () => this.#state.port.addEventListener('message', this.#onMessage),
            remove: () => this.#state.port.removeEventListener('message', this.#onMessage)
          },
          {
            add: () => this.#state.port.addEventListener('messageerror', this.#onMessageError),
            remove: () => this.#state.port.removeEventListener('messageerror', this.#onMessageError)
          },
          {
            add: () => {
              this.#state.removeRawError = this.#state.port.onError?.((error) =>
                this.#state.errorListeners.report(error, this.#state.secondaryFailures)
              )
            },
            remove: () => {
              this.#state.removeRawError?.()
              this.#state.removeRawError = undefined
            }
          },
          { add: () => this.#state.port.start(), remove: () => undefined }
        ],
        { code: RpcCoreErrorCode.transport, secondaryFailures: this.#state.secondaryFailures }
      )
    )
    return () => {
      if (!this.#state.messageListeners.has(listener)) return
      releaseListenerRegistration(
        this.#state.messageListeners.size === 1
          ? [
              () => this.#state.port.removeEventListener('message', this.#onMessage),
              () => this.#state.port.removeEventListener('messageerror', this.#onMessageError),
              () => {
                this.#state.removeRawError?.()
                this.#state.removeRawError = undefined
              }
            ]
          : [],
        () => {
          this.#state.messageListeners.remove(listener, () => undefined)
        },
        { code: RpcCoreErrorCode.transport, secondaryFailures: this.#state.secondaryFailures }
      )
    }
  }

  /** Preserve the native close operation and its original registration or settlement lifetime. */
  #close: NonNullable<IRpcTransport<unknown, TTransfer>['close']> = () => {
    if (this.#state.closed) return this.#state.closeResult
    this.#state.closed = true
    this.#state.probe = undefined
    this.#state.messageListeners.clear(() => undefined)
    const cleanupErrors = collectListenerCleanupFailures([
      () => {
        this.#state.removeRawProbe?.()
        this.#state.removeRawProbe = undefined
      },
      () => this.#state.port.removeEventListener('message', this.#onMessage),
      () => this.#state.port.removeEventListener('messageerror', this.#onMessageError),
      () => {
        this.#state.removeRawError?.()
        this.#state.removeRawError = undefined
      }
    ])
    if (this.#state.ownership === 'owned') {
      try {
        this.#state.port.close()
      } catch (error) {
        cleanupErrors.push(error)
      }
    }
    this.#state.closeResult = drainTerminalListenerFailures(cleanupErrors, {
      code: RpcCoreErrorCode.transport,
      message: RpcAdapterErrorText.messagePortCleanupFailed,
      secondaryFailures: this.#state.secondaryFailures,
      aggregateSingle: true
    })
    return this.#state.closeResult
  }

  /**
   * Preserve the native onTransportError operation and its original registration or settlement
   * lifetime.
   */
  #onTransportError: NonNullable<IRpcTransport<unknown, TTransfer>['onTransportError']> = (
    listener
  ) => {
    const registration = this.#state.errorListeners.add(listener)
    return () => {
      const deleted = registration.release()
      drainListenerFailures([], {
        code: RpcCoreErrorCode.transport,
        secondaryFailures: this.#state.secondaryFailures
      })
      return deleted
    }
  }

  /**
   * Preserve the native onListenerError operation and its original registration or settlement
   * lifetime.
   */
  #onListenerError: NonNullable<IRpcTransport<unknown, TTransfer>['onListenerError']> = (
    listener
  ) => {
    const registration = this.#state.listenerErrors.add(listener)
    return () => {
      const deleted = registration.release()
      drainListenerFailures([], {
        code: RpcCoreErrorCode.transport,
        secondaryFailures: this.#state.secondaryFailures
      })
      return deleted
    }
  }
}

/** Construct one explicit native carrier owner while preserving the original transport boundary. */
export function createBrowserMessagePortTransport<TTransfer = unknown, TEvent = unknown>(
  port: IBrowserMessagePortLike<TTransfer, TEvent>,
  options: IBrowserMessagePortTransportOptions = {}
): IRpcTransport<unknown, TTransfer> {
  return new BrowserMessagePortTransport<TTransfer, TEvent>(port, options).value
}

/**
 * Wrap a borrowed Node MessagePort without owning physical close. The wrapper preserves native
 * message/terminal listener ownership and transfer lists; native send failures retain their cause.
 */
/** Allocate native carrier state before any lazy subscription is published. */
function nodeMessagePortTransportState(port: INodeMessagePortLike) {
  /**
   * The original logical message hub shares native receive registration without changing listener
   * order.
   */
  const messageListeners = createMessageListenerHub<{ data: unknown }>()
  /**
   * Transport error registrations preserve their original physical-listener generation and failure
   * delivery.
   */
  const errorListeners = createErrorListenerChannel()
  /** Listener failures remain isolated through the original diagnostic registration owner. */
  const listenerErrors = createErrorListenerChannel()
  /**
   * Secondary reporter and cleanup failures stay retained until the existing failure drain observes
   * them.
   */
  const secondaryFailures = createListenerFailureState()
  /** The sole installed probe is replaced per observation generation. */
  const probe = undefined as IRpcCarrierProbe | undefined
  /** Disposers compare generations even when the same probe object is installed twice. */
  let probeGeneration = 0
  /**
   * Logical channel close retires observation without claiming that the borrowed native port
   * closed.
   */
  let observationRetired = false
  /** Reused detail belongs to this adapter; recipients consume it synchronously. */
  const probeDetail = { [RpcCarrierDetailKey.transfers]: -1 }
  /** Terminal admission prevents sends and subscriptions from reviving this retired carrier. */
  let closed = false
  /** The native close event publishes one terminal failure even if several observers remain. */
  let terminalReported = false
  /** Late transport subscribers observe the same original terminal Error instance. */
  const terminalError = undefined as Error | undefined

  return {
    messageListeners,
    errorListeners,
    listenerErrors,
    secondaryFailures,
    probe,
    probeGeneration,
    observationRetired,
    probeDetail,
    closed,
    terminalReported,
    terminalError,
    port
  }
}

/** Own one native carrier projection; event callbacks retain only this explicit instance. */
class NodeMessagePortTransport {
  /** All mutable observation, listener and close state belongs to this native carrier. */
  #state: ReturnType<typeof nodeMessagePortTransportState>

  /** Original transport metadata and callback identities remain on the same public object. */
  readonly value: IRpcTransport
  /** Initialize state before publishing lazy native registrations or private carrier capabilities. */
  constructor(port: INodeMessagePortLike) {
    this.#state = nodeMessagePortTransportState(port)

    /** The transport retains its original own enumerable operation keys. */
    const transport: IRpcTransport = {
      platform: RpcPlatform.messagePort,
      topology: 'exclusive',
      ownership: RpcTransportOwnership.borrowed,
      closed: false,
      observe: this.#observe,
      close: this.#close,
      send: this.#send,
      subscribe: this.#subscribe,
      onTransportError: this.#onTransportError,
      onListenerError: this.#onListenerError
    }
    Object.defineProperty(transport, 'closed', {
      configurable: true,
      enumerable: true,
      get: () => {
        return this.#state.closed
      }
    })
    bindNativeReplayTransport(this.#state.port, transport)
    this.value = registerCloneTransferCarrier(transport)
  }
  /** Handle this native carrier event through its original listener failure owner. */
  #emitTransportError = (error: unknown): void => {
    this.#state.errorListeners.report(error, this.#state.secondaryFailures)
  }

  /** Handle this native carrier event through its original listener failure owner. */
  #onMessage = (message: unknown): void => {
    if (this.#state.probe !== undefined) {
      /** One event retains the installed handle even if its callback replaces observation. */
      const currentProbe = this.#state.probe
      try {
        this.#state.probeDetail[RpcCarrierDetailKey.transfers] = -1
        currentProbe.emit(
          1,
          carrierSizeBytes(message),
          RpcPlatform.messagePort,
          this.#state.probeDetail,
          currentProbe.capturing ? message : undefined
        )
      } catch (error) {
        this.#state.listenerErrors.report(
          createRpcTransportError(RpcAdapterErrorText.probeFailed, error),
          this.#state.secondaryFailures
        )
      }
    }
    this.#state.messageListeners.dispatch({ data: message }, (listener, messageValue) => {
      observeListener(
        () => listener(messageValue),
        (error) => this.#state.listenerErrors.report(error, this.#state.secondaryFailures),
        this.#state.secondaryFailures
      )
    })
  }

  /** Handle this native carrier event through its original listener failure owner. */
  #onMessageError = (error?: unknown): void => {
    const detail =
      error === undefined
        ? ''
        : `: ${safeString(error, RpcCoreErrorText.unknownError, ({ error: conversionError }) => {
            this.#emitTransportError(
              createRpcTransportError(
                RpcMessagePortErrorText.messagePortDeserializeFailed(''),
                conversionError
              )
            )
            return undefined
          })}`
    this.#emitTransportError(
      tagRpcError(
        new Error(RpcMessagePortErrorText.messagePortDeserializeFailed(detail)),
        RpcCoreErrorCode.transport
      )
    )
  }

  /** Handle this native carrier event through its original listener failure owner. */
  #onClose = (): void => {
    if (this.#state.terminalReported) return
    this.#state.terminalReported = true
    this.#state.closed = true
    this.#state.probe = undefined
    this.#state.terminalError = tagRpcError(
      new Error(RpcMessagePortErrorText.messagePortTerminated),
      RpcCoreErrorCode.transport
    )
    this.#emitTransportError(this.#state.terminalError)
  }
  /** Replace observation; the returned disposer retires only its own installation generation. */
  #observe: NonNullable<IRpcTransport['observe']> = (next) => {
    /** Registration remains inert after this adapter's terminal boundary. */
    const generation = ++this.#state.probeGeneration
    if (!this.#state.closed && !this.#state.observationRetired) this.#state.probe = next
    return () => {
      if (generation !== this.#state.probeGeneration) return
      this.#state.probe = undefined
    }
  }

  /** Retire only observation; the native close event keeps its original physical error ownership. */
  #close: NonNullable<IRpcTransport['close']> = () => {
    this.#state.observationRetired = true
    this.#state.probe = undefined
  }

  /** Preserve the native send operation and its original registration or settlement lifetime. */
  #send: NonNullable<IRpcTransport['send']> = (message, options?: IRpcSendOptions) => {
    if (this.#state.closed) throw createRpcTransportError(RpcMessagePortErrorText.messagePortClosed)
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
          RpcPlatform.messagePort,
          this.#state.probeDetail,
          currentProbe.capturing ? captureTransferredContent(message, transfer) : undefined
        )
      } catch (error) {
        this.#state.listenerErrors.report(
          createRpcTransportError(RpcAdapterErrorText.probeFailed, error),
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
        RpcAdapterErrorText.nativeSendFailed
      )
    }
  }

  /** Preserve the native subscribe operation and its original registration or settlement lifetime. */
  #subscribe: NonNullable<IRpcTransport['subscribe']> = (listener) => {
    if (this.#state.closed) throw createRpcTransportError(RpcMessagePortErrorText.messagePortClosed)
    this.#state.messageListeners.add(listener, () =>
      registerListeners(
        [
          {
            add: () => this.#state.port.on('message', this.#onMessage),
            remove: () => this.#state.port.off('message', this.#onMessage)
          }
        ],
        { code: RpcCoreErrorCode.transport, secondaryFailures: this.#state.secondaryFailures }
      )
    )
    return () => {
      if (!this.#state.messageListeners.has(listener)) return
      releaseListenerRegistration(
        this.#state.messageListeners.size === 1
          ? [() => this.#state.port.off('message', this.#onMessage)]
          : [],
        () => {
          this.#state.messageListeners.remove(listener, () => undefined)
        },
        { code: RpcCoreErrorCode.transport, secondaryFailures: this.#state.secondaryFailures }
      )
    }
  }

  /**
   * Preserve the native onTransportError operation and its original registration or settlement
   * lifetime.
   */
  #onTransportError: NonNullable<IRpcTransport['onTransportError']> = (listener) => {
    if (!this.#state.closed && this.#state.errorListeners.size === 0)
      registerListeners(
        [
          {
            add: () => this.#state.port.on('messageerror', this.#onMessageError),
            remove: () => this.#state.port.off('messageerror', this.#onMessageError)
          },
          {
            add: () => this.#state.port.on('close', this.#onClose),
            remove: () => this.#state.port.off('close', this.#onClose)
          }
        ],
        { code: RpcCoreErrorCode.transport, secondaryFailures: this.#state.secondaryFailures }
      )
    const registration = this.#state.errorListeners.add(listener)
    if (this.#state.terminalError !== undefined) {
      observeListener(
        () => listener(this.#state.terminalError),
        (error) => collectListenerFailure(this.#state.secondaryFailures, error),
        this.#state.secondaryFailures
      )
    }
    return () => {
      if (!registration.isCurrent()) return
      releaseListenerRegistration(
        this.#state.errorListeners.size === 1
          ? [
              () => this.#state.port.off('messageerror', this.#onMessageError),
              () => this.#state.port.off('close', this.#onClose)
            ]
          : [],
        () => {
          registration.release()
        },
        { code: RpcCoreErrorCode.transport, secondaryFailures: this.#state.secondaryFailures }
      )
    }
  }

  /**
   * Preserve the native onListenerError operation and its original registration or settlement
   * lifetime.
   */
  #onListenerError: NonNullable<IRpcTransport['onListenerError']> = (listener) => {
    const registration = this.#state.listenerErrors.add(listener)
    return () => {
      const deleted = registration.release()
      drainListenerFailures([], {
        code: RpcCoreErrorCode.transport,
        secondaryFailures: this.#state.secondaryFailures
      })
      return deleted
    }
  }
}

/** Construct one explicit native carrier owner while preserving the original transport boundary. */
export function createNodeMessagePortTransport(port: INodeMessagePortLike): IRpcTransport {
  return new NodeMessagePortTransport(port).value
}
