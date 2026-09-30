import { createEventChannel } from '@migaia/event-subscriber'
import { createConcurrencyLimiter, hostRethrowReporter } from '@migaia/utils/promise'
import { RpcStreamEvent } from '../../contract/index.js'
import type { IRpcEnvelope } from '../../contract/index.js'
import { RpcCoreErrorText } from '../error-text.js'
import { RpcCoreErrorCode } from '../error-code.js'
import { RpcError, RpcLifecycleError, tagRpcError } from '../errors.js'
import { defineFeature } from '../feature.js'
import { installOutboundGate, registerOutboundGate } from '../internal/outbound-gate.js'
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

/** Prevents two wrappers from claiming the same physical connection identity. */
const wrappedPhysical = new WeakSet<object>()

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
  const maxData = options.maxPendingData ?? 256
  const maxControl = options.maxPendingControl ?? 8
  if (
    !Number.isSafeInteger(maxData) ||
    maxData < 1 ||
    !Number.isSafeInteger(maxControl) ||
    maxControl < 1
  )
    throw tagRpcError(
      new TypeError(RpcCoreErrorText.ipcCapacityInvalid),
      RpcCoreErrorCode.invalidConfig
    )
  const connectionId = options.connectionId
  const sessionId = options.sessionId
  let pendingData = 0
  let pendingControl = 0
  let active: IIpcSendClass | null = null
  let dataHigh = false
  let controlHigh = false
  let closed = false
  const events = createEventChannel<IIpcBacklogEvent>({
    report: ({ error }) => hostRethrowReporter(error, { operation: 'limiter', phase: 'reporter' })
  })
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
  const emit = (event: IIpcBacklogEvent): void => {
    try {
      events.publish(event)
    } catch (error) {
      hostRethrowReporter(error, { operation: 'limiter', phase: 'reporter' })
    }
  }
  const observeWatermark = (sendClass: IIpcSendClass): void => {
    const pending = sendClass === IpcSendClass.data ? pendingData : pendingControl
    const capacity = sendClass === IpcSendClass.data ? maxData : maxControl
    const high = sendClass === IpcSendClass.data ? dataHigh : controlHigh
    if (!high && pending >= Math.ceil(capacity * 0.75)) {
      if (sendClass === IpcSendClass.data) dataHigh = true
      else controlHigh = true
      emit(snapshot(IpcLogEventName['ipc.backlog.high']))
    } else if (high && pending <= Math.floor(capacity * 0.5)) {
      if (sendClass === IpcSendClass.data) dataHigh = false
      else controlHigh = false
      emit(snapshot(IpcLogEventName['ipc.backlog.low']))
    }
  }
  const limiter = createConcurrencyLimiter({
    concurrency: 1,
    report: (error) => emit(snapshot(IpcLogEventName['ipc.send.failed'], undefined, error))
  })
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
        const error = new RpcError(RpcCoreErrorCode.overloaded, RpcCoreErrorText.ipcSendOverloaded)
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
  const feature = defineFeature<Record<never, never>, Record<never, never>, IRpcFeatureExpose>(
    (core) => {
      const kernel = core.featureExpose.getKernel()
      installOutboundGate(kernel.transport, gate)
      kernel.resources.addSync('IPC send gate', () => gate.close())
      return Object.freeze({})
    }
  )
  return Object.freeze({ feature, gate })
}

/** Wraps one physical connection while keeping its own send receiver and close idempotent. */
export function createIpcSendQueueTransport(
  transport: IRpcTransport,
  gate: IIpcSendGate
): IIpcGatedTransport {
  if (wrappedPhysical.has(transport))
    throw tagRpcError(
      new TypeError(RpcCoreErrorText.ipcGateDuplicated),
      RpcCoreErrorCode.invalidConfig
    )
  let closed = false
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
      return transport.close?.()
    }
  })
  registerOutboundGate(wrapper, gate)
  wrappedPhysical.add(transport)
  return wrapper
}
