import { registerJsonObjectFeature } from '../internal/json-object-port.js'
import { RpcPluginErrorText } from './error-text.js'
import { createEventChannel } from '@migaia/event-subscriber'
import { createConcurrencyLimiter, hostRethrowReporter } from '@migaia/utils/promise'
import { RpcStreamEvent } from '../../contract/index.js'
import type { IRpcEnvelope } from '../../contract/index.js'
import { RpcCoreErrorText } from '../error-text.js'
import { RpcCoreErrorCode } from '../error-code.js'
import { RpcError, RpcLifecycleError, tagRpcError } from '../errors.js'
import { defineFeature } from '../feature.js'
import {
  installOutboundGate,
  isOutboundGateWrapper,
  registerOutboundGate,
  releaseInstalledOutboundGate
} from '../internal/outbound-gate.js'
import type { IRpcFeatureExpose } from '../internal/feature-contract.js'
import type { IRpcTransport } from '../transport.js'
import {
  IpcLogEventName,
  IpcSendClass,
  type IIpcBacklogEvent,
  type IIpcGatedTransport,
  type IIpcSendAdmission,
  type IIpcSendGate,
  type IIpcSendQueueInstallation,
  type IIpcSendQueueOptions,
  type IpcSendClass as IIpcSendClass
} from './flow-control.js'
import { IpcReporterContext } from './reporter-context.js'

/** Prevents two wrappers from claiming the same physical connection identity. */
const wrappedPhysical = new WeakSet<object>()
/** Contract defaults bound the entire connection's accepted data envelopes. */
const DEFAULT_PENDING_DATA = 256
/** Contract defaults reserve a separate lane for control envelopes. */
const DEFAULT_PENDING_CONTROL = 8
/** High watermark reports one upward crossing of accepted capacity. */
const HIGH_WATERMARK_RATIO = 0.75
/** Low watermark reports one downward crossing after drain. */
const LOW_WATERMARK_RATIO = 0.5

/** Selects the reserved control class from normalized fields without invoking user getters. */
function classify(envelope: IRpcEnvelope): IIpcSendClass {
  if (envelope.kind === 'variation') {
    const variation = envelope.data.route.variation
    if (
      variation === 'abort' ||
      variation === 'close' ||
      variation === 'ping' ||
      variation === 'pong'
    )
      return IpcSendClass.control
  }
  if (envelope.kind === 'stream') {
    const payload = envelope.data.payload as { readonly event?: unknown } | undefined
    if (
      payload?.event === RpcStreamEvent.pull ||
      payload?.event === RpcStreamEvent.cancel ||
      payload?.event === RpcStreamEvent.cancelled
    )
      return IpcSendClass.control
  }
  return IpcSendClass.data
}

/** Creates one connection's bounded admission token and native installation marker. */
export function createIpcSendQueueFeature(
  options: IIpcSendQueueOptions
): IIpcSendQueueInstallation {
  /** Configured data capacity, including one active envelope. */
  const maxData = options.maxPendingData ?? DEFAULT_PENDING_DATA
  /** Configured control capacity, including one active envelope. */
  const maxControl = options.maxPendingControl ?? DEFAULT_PENDING_CONTROL
  if (
    !Number.isSafeInteger(maxData) ||
    maxData < 1 ||
    !Number.isSafeInteger(maxControl) ||
    maxControl < 1
  )
    throw tagRpcError(
      new TypeError(RpcPluginErrorText.ipcCapacityInvalid),
      RpcCoreErrorCode.invalidConfig
    )
  /** Stable identity included in every local backlog diagnostic. */
  const connectionId = options.connectionId
  /** Optional session identity included only when supplied by the channel. */
  const sessionId = options.sessionId
  /** Counts admitted data work until each Promise settles. */
  let pendingData = 0
  /** Counts admitted control work independently of data saturation. */
  let pendingControl = 0
  /** Names the one envelope currently using the physical sender. */
  let active: IIpcSendClass | null = null
  /** Suppresses duplicate high events until data drains below the low watermark. */
  let dataHigh = false
  /** Suppresses duplicate high events for the reserved control lane. */
  let controlHigh = false
  /** Makes gate close idempotent and rejects later admissions. */
  let closed = false
  /** Shares one event source between endpoint hooks and the optional logger. */
  const events = createEventChannel<IIpcBacklogEvent>({
    report: ({ error }) => hostRethrowReporter(error, IpcReporterContext)
  })
  /** Captures counters at emission time without storing user envelope objects. */
  const snapshot = (
    name: IIpcBacklogEvent['name'],
    envelope?: IRpcEnvelope,
    error?: unknown
  ): IIpcBacklogEvent => {
    const trace = envelope?.data.route.trace
    return Object.freeze({
      name,
      connectionId,
      ...(sessionId === undefined ? {} : { sessionId }),
      pendingData,
      pendingControl,
      active,
      ...(trace === undefined ? {} : { trace }),
      ...(error === undefined ? {} : { error })
    })
  }
  /** Reports listener errors to the host without changing the send result. */
  const emit = (event: IIpcBacklogEvent): void => {
    try {
      events.publish(event)
    } catch (error) {
      hostRethrowReporter(error, IpcReporterContext)
    }
  }
  /** Emits each high/low crossing once for the selected capacity class. */
  const observeWatermark = (sendClass: IIpcSendClass): void => {
    const pending = sendClass === IpcSendClass.data ? pendingData : pendingControl
    const capacity = sendClass === IpcSendClass.data ? maxData : maxControl
    const high = sendClass === IpcSendClass.data ? dataHigh : controlHigh
    if (!high && pending >= Math.ceil(capacity * HIGH_WATERMARK_RATIO)) {
      if (sendClass === IpcSendClass.data) dataHigh = true
      else controlHigh = true
      emit(snapshot(IpcLogEventName['ipc.backlog.high']))
    } else if (high && pending <= Math.floor(capacity * LOW_WATERMARK_RATIO)) {
      if (sendClass === IpcSendClass.data) dataHigh = false
      else controlHigh = false
      emit(snapshot(IpcLogEventName['ipc.backlog.low']))
    }
  }
  /** Reuses the utils FIFO and queued-abort implementation for one connection. */
  const limiter = createConcurrencyLimiter({
    concurrency: 1,
    report: (error) => emit(snapshot(IpcLogEventName['ipc.send.failed'], undefined, error))
  })
  /** Gate owns the whole-envelope capacity and settlement lifetime. */
  const gate: IIpcSendGate = Object.freeze({
    run(
      envelope: IRpcEnvelope,
      sendNow: () => void | Promise<void>,
      admission?: IIpcSendAdmission
    ): Promise<void> {
      if (closed) return Promise.reject(new RpcLifecycleError(RpcCoreErrorText.endpointDisposed))
      const sendClass = classify(envelope)
      const pending = sendClass === IpcSendClass.data ? pendingData : pendingControl
      const capacity = sendClass === IpcSendClass.data ? maxData : maxControl
      if (pending >= capacity) {
        const error = new RpcError(
          RpcCoreErrorCode.overloaded,
          RpcPluginErrorText.ipcSendOverloaded
        )
        emit(snapshot(IpcLogEventName['ipc.backlog.rejected'], envelope, error))
        return Promise.reject(error)
      }
      if (sendClass === IpcSendClass.data) pendingData += 1
      else pendingControl += 1
      observeWatermark(sendClass)
      return limiter
        .run(
          async () => {
            admission?.assertCanSend()
            active = sendClass
            try {
              await sendNow()
            } finally {
              active = null
            }
          },
          admission?.queueSignal === undefined ? undefined : { signal: admission.queueSignal }
        )
        .catch((error: unknown) => {
          emit(snapshot(IpcLogEventName['ipc.send.failed'], envelope, error))
          throw error
        })
        .finally(() => {
          if (sendClass === IpcSendClass.data) pendingData -= 1
          else pendingControl -= 1
          observeWatermark(sendClass)
        })
    },
    onEvent(listener: (event: IIpcBacklogEvent) => void): () => void {
      return events.subscribe((context) => listener(context.value))
    },
    close(reason?: unknown): void {
      if (closed) return
      closed = true
      limiter.close(reason ?? new RpcLifecycleError(RpcCoreErrorText.endpointDisposed))
      events.clear()
    },
    whenIdle(): Promise<void> {
      return limiter.whenIdle()
    }
  })
  /** Native Feature installs the same gate identity selected by the wrapper. */
  const feature = defineFeature<Record<never, never>, Record<never, never>, IRpcFeatureExpose>(
    (core) => {
      const kernel = core.featureExpose.getKernel()
      installOutboundGate(kernel.transport, gate)
      kernel.resources.addSync('IPC send gate', () => {
        releaseInstalledOutboundGate(kernel.transport, gate)
        gate.close()
      })
      return Object.freeze({})
    }
  )
  return Object.freeze({ feature: registerJsonObjectFeature(feature), gate })
}

/** Wraps one physical connection while keeping its own send receiver and close idempotent. */
export function createIpcSendQueueTransport(
  transport: IRpcTransport,
  gate: IIpcSendGate
): IIpcGatedTransport {
  if (wrappedPhysical.has(transport) || isOutboundGateWrapper(transport))
    throw tagRpcError(
      new TypeError(RpcCoreErrorText.ipcGateDuplicated),
      RpcCoreErrorCode.invalidConfig
    )
  /** Physical close may run once even when callers repeat wrapper.close(). */
  let closed = false
  /** Active ownership permits physical close; construction rollback yields it for another wrapper. */
  let claimed = false
  /** The public transport view retains the physical sender's receiver and metadata. */
  const wrapper: IIpcGatedTransport = Object.freeze({
    get platform() {
      return transport.platform
    },
    get topology() {
      return transport.topology
    },
    get encodedType() {
      return transport.encodedType
    },
    get ownership() {
      return transport.ownership
    },
    get peerId() {
      return transport.peerId
    },
    get origin() {
      return transport.origin
    },
    get sourceProof() {
      return transport.sourceProof
    },
    get closed() {
      return closed || transport.closed
    },
    ipcSendGate: gate,
    send(message, options) {
      return transport.send(message, options)
    },
    subscribe(listener) {
      return transport.subscribe(listener)
    },
    onTransportError(listener) {
      return transport.onTransportError?.(listener) ?? (() => undefined)
    },
    onListenerError(listener) {
      return transport.onListenerError?.(listener) ?? (() => undefined)
    },
    close() {
      if (closed) return
      closed = true
      gate.close()
      if (claimed || !wrappedPhysical.has(transport)) return transport.close?.()
    }
  })
  registerOutboundGate(wrapper, gate, {
    restore() {
      if (wrappedPhysical.has(transport))
        throw tagRpcError(
          new TypeError(RpcCoreErrorText.ipcGateDuplicated),
          RpcCoreErrorCode.invalidConfig
        )
      wrappedPhysical.add(transport)
      claimed = true
    },
    rollback() {
      if (!claimed) return
      wrappedPhysical.delete(transport)
      claimed = false
    }
  })
  return wrapper
}
