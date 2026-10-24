import { createRpcError, createRpcLifecycleError, tagRpcError } from '../errors.js'
import { RpcOutboundAdmission } from '../internal/outbound-gate.js'
import { registerJsonObjectFeature } from '../internal/json-object-port.js'
import { carryNativeReplayTransport } from '../internal/native-replay.js'
import {
  carryBatchAgreement,
  isBatchWriter,
  type IBatchWriteGuard
} from '../internal/batch-frame.js'
import { RpcPluginErrorText } from './error-text.js'
import { createEventChannel } from '@migaia/event-subscriber'
import { createConcurrencyLimiter, hostRethrowReporter } from '@migaia/utils/promise'
import { RpcStreamEvent } from '@migaia/rpc-contract'
import type { IRpcEnvelope, IRpcRuntimeEnvelope } from '@migaia/rpc-contract'
import { RpcRuntimeKind, RpcRuntimeOperation } from '@migaia/rpc-contract/framing/v1'
import { RpcCoreErrorText } from '../error-text.js'
import { RpcCoreErrorCode } from '../error-code.js'

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
function classify(envelope: IRpcEnvelope | IRpcRuntimeEnvelope): IIpcSendClass {
  if (envelope.kind === RpcRuntimeKind.outcome) return IpcSendClass.control
  if (envelope.kind === RpcRuntimeKind.control) {
    /** Business replies retain the same data lane as legacy responses and stream data. */
    if (envelope.operation === RpcRuntimeOperation.terminal) return IpcSendClass.data
    if (
      envelope.operation === RpcRuntimeOperation.stream &&
      (envelope.stream.event === RpcStreamEvent.item ||
        envelope.stream.event === RpcStreamEvent.end ||
        envelope.stream.event === RpcStreamEvent.fail)
    )
      return IpcSendClass.data
    return IpcSendClass.control
  }
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

/**
 * Create one bounded physical send gate and its native installation Feature. Defaults to 256 data
 * and 8 control envelopes including active sends; invalid capacities throw INVALID_CONFIG. Install
 * the exact Feature with its wrapped transport and close the gate with the connection.
 */
/** Admit queue capacity and allocate counters before physical work is installed. */
function ipcSendQueueState(options: IIpcSendQueueOptions) {
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
  const active = null as IIpcSendClass | null
  /** Suppresses duplicate high events until data drains below the low watermark. */
  let dataHigh = false
  /** Suppresses duplicate high events for the reserved control lane. */
  let controlHigh = false
  /** Makes gate close idempotent and rejects later admissions. */
  let closed = false
  /** Original close reason rejects accepted queued members without replacing its identity. */
  const closeReason = undefined as unknown
  /** Shares one event source between endpoint hooks and the optional logger. */
  const events = createEventChannel<IIpcBacklogEvent>({
    report: ({ error }) => hostRethrowReporter(error, IpcReporterContext)
  })

  return {
    maxData,
    maxControl,
    connectionId,
    sessionId,
    pendingData,
    pendingControl,
    active,
    dataHigh,
    controlHigh,
    closed,
    closeReason,
    events
  }
}

/** One physical connection owns its complete logical capacity, FIFO and watermark lifetime. */
class IpcSendQueue {
  /** Admission counters and original diagnostic identities belong to this exact gate. */
  #state: ReturnType<typeof ipcSendQueueState>
  /** The existing utils limiter owns the non-coalesced physical FIFO and queued aborts. */
  #limiter: ReturnType<typeof createConcurrencyLimiter>
  /** Accepted coalesced envelopes retain their original per-envelope settlement Promises. */
  #coalesced: Set<Promise<void>>
  /** Only sender-queued members retain cancellation until physical preparation begins. */
  #queuedCancellations: Set<(reason: unknown) => void>
  /** Idle waiters settle after every accepted coalesced envelope has left the gate. */
  #idle: Set<() => void>
  /** The original frozen Feature and exact gate identity are published together. */
  readonly value: IIpcSendQueueInstallation
  /** Validate capacities before constructing any limiter or publishing the genuine native Feature. */
  constructor(options: IIpcSendQueueOptions) {
    this.#state = ipcSendQueueState(options)
    this.#limiter = createConcurrencyLimiter({
      concurrency: 1,
      report: (error) =>
        this.#emit(this.#snapshot(IpcLogEventName['ipc.send.failed'], undefined, error))
    })
    this.#coalesced = new Set<Promise<void>>()
    this.#queuedCancellations = new Set<(reason: unknown) => void>()
    this.#idle = new Set<() => void>()
    /** Public callbacks borrow this owner's original admission and close state. */
    const gate: IIpcSendGate = Object.freeze({
      run: this.#run,
      onEvent: this.#onEvent,
      close: this.#close,
      whenIdle: this.#whenIdle
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
    this.value = Object.freeze({ feature: registerJsonObjectFeature(feature), gate })
  }
  /** Captures counters at emission time without storing user envelope objects. */
  #snapshot = (
    name: IIpcBacklogEvent['name'],
    envelope?: IRpcEnvelope | IRpcRuntimeEnvelope,
    error?: unknown
  ): IIpcBacklogEvent => {
    const trace = envelope && 'data' in envelope ? envelope.data.route.trace : undefined
    return Object.freeze({
      name,
      connectionId: this.#state.connectionId,
      ...(this.#state.sessionId === undefined ? {} : { sessionId: this.#state.sessionId }),
      pendingData: this.#state.pendingData,
      pendingControl: this.#state.pendingControl,
      active: this.#state.active,
      ...(trace === undefined ? {} : { trace }),
      ...(error === undefined ? {} : { error })
    })
  }

  /** Reports listener errors to the host without changing the send result. */
  #emit = (event: IIpcBacklogEvent): void => {
    try {
      this.#state.events.publish(event)
    } catch (error) {
      hostRethrowReporter(error, IpcReporterContext)
    }
  }

  /** Emits each high/low crossing once for the selected capacity class. */
  #observeWatermark = (sendClass: IIpcSendClass): void => {
    const pending =
      sendClass === IpcSendClass.data ? this.#state.pendingData : this.#state.pendingControl
    const capacity = sendClass === IpcSendClass.data ? this.#state.maxData : this.#state.maxControl
    const high = sendClass === IpcSendClass.data ? this.#state.dataHigh : this.#state.controlHigh
    if (!high && pending >= Math.ceil(capacity * HIGH_WATERMARK_RATIO)) {
      if (sendClass === IpcSendClass.data) this.#state.dataHigh = true
      else this.#state.controlHigh = true
      this.#emit(this.#snapshot(IpcLogEventName['ipc.backlog.high']))
    } else if (high && pending <= Math.floor(capacity * LOW_WATERMARK_RATIO)) {
      if (sendClass === IpcSendClass.data) this.#state.dataHigh = false
      else this.#state.controlHigh = false
      this.#emit(this.#snapshot(IpcLogEventName['ipc.backlog.low']))
    }
  }
  /** Admit one logical envelope, then preserve the existing physical send and settlement boundaries. */
  #run = (
    envelope: IRpcEnvelope | IRpcRuntimeEnvelope,
    sendNow: () => void | Promise<void>,
    admission?: IIpcSendAdmission
  ): Promise<void> => {
    if (this.#state.closed)
      return Promise.reject(createRpcLifecycleError(RpcCoreErrorText.endpointDisposed))
    const sendClass = classify(envelope)
    const pending =
      sendClass === IpcSendClass.data ? this.#state.pendingData : this.#state.pendingControl
    const capacity = sendClass === IpcSendClass.data ? this.#state.maxData : this.#state.maxControl
    if (pending >= capacity) {
      const error = createRpcError(
        RpcCoreErrorCode.overloaded,
        RpcPluginErrorText.ipcSendOverloaded
      )
      this.#emit(this.#snapshot(IpcLogEventName['ipc.backlog.rejected'], envelope, error))
      return Promise.reject(error)
    }
    if (sendClass === IpcSendClass.data) this.#state.pendingData += 1
    else this.#state.pendingControl += 1
    this.#observeWatermark(sendClass)
    /** Only the private sender callback bypasses the legacy physical concurrency-one lane. */
    const coalescing = isBatchWriter(sendNow)
    let send: Promise<void>
    if (coalescing) {
      try {
        send = Promise.resolve(
          (sendNow as (guard: IBatchWriteGuard) => void | Promise<void>)((cancelQueued) => {
            if (this.#state.closed) throw this.#state.closeReason
            if (cancelQueued) {
              this.#queuedCancellations.add(cancelQueued)
              return () => {
                this.#queuedCancellations.delete(cancelQueued)
              }
            }
          })
        )
      } catch (error) {
        send = Promise.reject(error)
      }
    } else {
      /** This existing concurrency-one lane requires a child signal only when it actually queues. */
      const waiting = this.#limiter.activeCount > 0 || this.#limiter.pendingCount > 0
      send = this.#limiter.run(
        async () => {
          admission?.assertCanSend()
          this.#state.active = sendClass
          try {
            await sendNow()
          } finally {
            this.#state.active = null
          }
        },
        RpcOutboundAdmission.queuedSignal(admission, waiting) === undefined
          ? undefined
          : { signal: RpcOutboundAdmission.queuedSignal(admission, waiting) }
      )
    }
    /** Capacity and reporting retain their original per-envelope settlement boundary. */
    const settled = send
      .catch((error: unknown) => {
        this.#emit(this.#snapshot(IpcLogEventName['ipc.send.failed'], envelope, error))
        throw error
      })
      .finally(() => {
        if (sendClass === IpcSendClass.data) this.#state.pendingData -= 1
        else this.#state.pendingControl -= 1
        this.#observeWatermark(sendClass)
        if (coalescing) this.#coalesced.delete(settled)
        if (coalescing && this.#coalesced.size === 0) {
          for (const resolve of this.#idle) resolve()
          this.#idle.clear()
        }
      })
    if (coalescing) this.#coalesced.add(settled)
    return settled
  }

  /** Subscribe to the original backlog channel without changing listener error routing. */
  #onEvent = (listener: (event: IIpcBacklogEvent) => void): (() => void) => {
    return this.#state.events.subscribe((context) => listener(context.value))
  }

  /** Close admission once and reject queued work with the original close reason. */
  #close = (reason?: unknown): void => {
    if (this.#state.closed) return
    this.#state.closed = true
    this.#state.closeReason = reason ?? createRpcLifecycleError(RpcCoreErrorText.endpointDisposed)
    this.#limiter.close(this.#state.closeReason)
    for (const cancel of this.#queuedCancellations) cancel(this.#state.closeReason)
    this.#queuedCancellations.clear()
    this.#state.events.clear()
  }

  /** Wait for both logical coalesced work and the original physical FIFO to become idle. */
  #whenIdle = (): Promise<void> => {
    if (this.#coalesced.size === 0) return this.#limiter.whenIdle()
    return Promise.all([
      this.#limiter.whenIdle(),
      this.#coalesced.size === 0
        ? Promise.resolve()
        : new Promise<void>((resolve) => this.#idle.add(resolve))
    ]).then(() => undefined)
  }
}

/** Create the native Feature and gate with one explicit physical queue owner. */
export function createIpcSendQueueFeature(
  options: IIpcSendQueueOptions
): IIpcSendQueueInstallation {
  return new IpcSendQueue(options).value
}

/** One borrowed physical sender retains its original receiver and one wrapper claim. */
class IpcSendQueueTransport {
  /** Native transport identity remains the authority for replay, batching and wrapper claims. */
  #transport: IRpcTransport
  /** The exact gate is shared by wrapper metadata and native Feature installation. */
  #gate: IIpcSendGate
  /** Local close admission is independent of the underlying carrier's closed observation. */
  #closed = false
  /** Successful native installation owns physical close; rollback yields that claim. */
  #claimed = false
  /** Own enumerable properties retain the original transport projection and getter semantics. */
  readonly value: IIpcGatedTransport

  /** Reject duplicate wrapping before registering the exact original gate capability. */
  constructor(transport: IRpcTransport, gate: IIpcSendGate) {
    if (wrappedPhysical.has(transport) || isOutboundGateWrapper(transport))
      throw tagRpcError(
        new TypeError(RpcCoreErrorText.ipcGateDuplicated),
        RpcCoreErrorCode.invalidConfig
      )
    this.#transport = transport
    this.#gate = gate
    /** Allocate metadata slots in the original property order before installing native getters. */
    const wrapper: IIpcGatedTransport = {
      platform: undefined as unknown as IRpcTransport['platform'],
      topology: undefined,
      encodedType: undefined,
      ownership: undefined,
      peerId: undefined,
      origin: undefined,
      sourceProof: undefined,
      closed: false,
      ipcSendGate: gate,
      observe: transport.observe === undefined ? undefined : (probe) => transport.observe!(probe),
      send: this.#send,
      subscribe: this.#subscribe,
      onTransportError: this.#onTransportError,
      onListenerError: this.#onListenerError,
      close: this.#close
    }
    Object.defineProperties(wrapper, {
      platform: { enumerable: true, get: () => this.#transport.platform },
      topology: { enumerable: true, get: () => this.#transport.topology },
      encodedType: { enumerable: true, get: () => this.#transport.encodedType },
      ownership: { enumerable: true, get: () => this.#transport.ownership },
      peerId: { enumerable: true, get: () => this.#transport.peerId },
      origin: { enumerable: true, get: () => this.#transport.origin },
      sourceProof: { enumerable: true, get: () => this.#transport.sourceProof },
      closed: { enumerable: true, get: () => this.#closed || this.#transport.closed }
    })
    this.value = Object.freeze(wrapper)
    registerOutboundGate(this.value, gate, { restore: this.#restore, rollback: this.#rollback })
    carryNativeReplayTransport(transport, this.value)
    carryBatchAgreement(transport, this.value)
  }

  /** Delegate with the native sender's receiver and returned Promise identity. */
  #send: IRpcTransport['send'] = (message, options) => this.#transport.send(message, options)
  /** Subscribe through the exact original carrier registration. */
  #subscribe: IRpcTransport['subscribe'] = (listener) => this.#transport.subscribe(listener)
  /** An absent native error source retains the original inert disposer behavior. */
  #onTransportError = (listener: (error: unknown) => void) =>
    this.#transport.onTransportError?.(listener) ?? (() => undefined)
  /** Preserve listener diagnostics independently of physical retirement. */
  #onListenerError = (listener: (error: unknown) => void) =>
    this.#transport.onListenerError?.(listener) ?? (() => undefined)
  /** Close admission once; only the actual claim holder may close the physical carrier. */
  #close = () => {
    if (this.#closed) return
    this.#closed = true
    this.#gate.close()
    if (this.#claimed || !wrappedPhysical.has(this.#transport)) return this.#transport.close?.()
  }
  /** Reacquire the claim only if no competing wrapper owns the physical identity. */
  #restore = () => {
    if (wrappedPhysical.has(this.#transport))
      throw tagRpcError(
        new TypeError(RpcCoreErrorText.ipcGateDuplicated),
        RpcCoreErrorCode.invalidConfig
      )
    wrappedPhysical.add(this.#transport)
    this.#claimed = true
  }
  /** Rollback releases only this wrapper's actual claim and retains the native carrier. */
  #rollback = () => {
    if (!this.#claimed) return
    wrappedPhysical.delete(this.#transport)
    this.#claimed = false
  }
}

/** Wrap one physical connection while preserving native capability identity and close ownership. */
export function createIpcSendQueueTransport(
  transport: IRpcTransport,
  gate: IIpcSendGate
): IIpcGatedTransport {
  return new IpcSendQueueTransport(transport, gate).value
}
