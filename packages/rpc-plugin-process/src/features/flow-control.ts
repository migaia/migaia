/**
 * Owns native data/control lane admission, watermarks and backlog diagnostics through physical
 * write completion. It borrows the original write operation without becoming an RPC pending-call
 * owner.
 */
import { hostRethrowReporter } from '@migaia/utils/promise'
import { inspectThenable, observeThenableRejection } from '@migaia/utils/function'
import { markRpcCarrierAdmissionFailure } from '@migaia/rpc-host/sdk'
import {
  RpcError,
  RpcLifecycleError,
  RpcCoreErrorText,
  tagRpcError
} from '@migaia/rpc-contract/errors'
import { RpcCoreErrorCode } from '@migaia/rpc-contract/error-code'
import {
  IpcSendClass,
  type IRpcWriteAdmission,
  type IRpcWriteQueueGuard
} from '@migaia/rpc-contract/interfaces'
import { IpcCapacity, IpcReporterContext, ProcessFeatureName, ProcessFeatureText } from './text.js'
import type {
  IProcessFeatureContext,
  IIpcSendFacts,
  IIpcSendAdmission,
  IIpcWrite
} from './metadata.js'

export { IpcSendClass } from '@migaia/rpc-contract/interfaces'
/** The existing local event vocabulary is shared by queue and stderr observations. */
export const IpcLogEventName = {
  'ipc.backlog.high': 'ipc.backlog.high',
  'ipc.backlog.low': 'ipc.backlog.low',
  'ipc.backlog.rejected': 'ipc.backlog.rejected',
  'ipc.send.failed': 'ipc.send.failed',
  'ipc.stderr': 'ipc.stderr'
} as const
export type IpcLogEventName = keyof typeof IpcLogEventName
/** Immutable snapshots retain counts and original failures, never a business envelope. */
export type IIpcBacklogEvent = Readonly<{
  name: Exclude<IpcLogEventName, 'ipc.stderr'>
  connectionId: string
  sessionId?: string
  pendingData: number
  pendingControl: number
  active: IpcSendClass | null
  trace?: string
  error?: unknown
}>
/** Capacities include active writes and are captured before native acquisition. */
export type IIpcFlowControlOptions = Readonly<{
  maxPendingData?: number
  maxPendingControl?: number
}>
/** Public diagnostics remain local own data and preserve explicit stderr identity. */
export type IIpcLogRecord =
  | IIpcBacklogEvent
  | Readonly<{
      name: 'ipc.stderr'
      connectionId: string
      sessionId: string
      processId?: string
      text: string
      droppedChunks?: number
    }>
/** An exact subscriber receipt preserves independent registrations of the same callback. */
type IIpcListener = Readonly<{ invoke(event: IIpcBacklogEvent): void }>
/** The concrete FIFO lends execution only; flow owns admission and logical settlement. */
export type IIpcSchedule = (write: () => Promise<void>) => Promise<void>

/** One genuine logical reservation owns only its original capacity release and queue guard. */
class IpcWriteAdmission implements IRpcWriteAdmission {
  /** Issuing flow identity prevents another connection from borrowing this capacity. */
  #owner: IpcFlowControl | undefined
  /** One callback returns the counted lane without retaining a message or physical frame. */
  #release: (() => void) | undefined
  /** The original queue lends its existing queued-member cancellation registration. */
  #guard: IRpcWriteQueueGuard | undefined

  /** Captures one already-counted reservation with its concrete native owner. */
  constructor(owner: IpcFlowControl, release: () => void, guard?: IRpcWriteQueueGuard) {
    this.#owner = owner
    this.#release = release
    this.#guard = guard
  }
  /** Queue guard remains the existing callback and disappears with the returned credit. */
  get guard(): IRpcWriteQueueGuard | undefined {
    return this.#guard
  }
  /** Only a live credit issued by this exact flow can replace ordinary physical admission. */
  belongsTo(owner: IpcFlowControl): boolean {
    return this.#owner === owner
  }
  /** Revokes the reservation before watermark callbacks can synchronously reenter release. */
  readonly release = (): void => {
    /** Publish idempotent return before invoking the original flow's release callback. */
    const release = this.#release
    if (!release) return
    this.#release = undefined
    this.#owner = undefined
    this.#guard = undefined
    release()
  }
}

/** One installed flow owns the original two capacities, watermarks, listeners and pending writes. */
export class IpcFlowControl {
  /** Native diagnostic identity is held without keeping a carrier/host facade. */
  readonly #context: IProcessFeatureContext
  /** Validated capacities never change after this installation. */
  readonly #capacity: Readonly<Record<IpcSendClass, number>>
  /** Accepted logical writes retain capacity through their exact physical completion. */
  readonly #pending = { data: 0, control: 0 }
  /** Each lane emits one high crossing until it drains below its own low threshold. */
  readonly #high = { data: false, control: false }
  /** Only actual noncoalesced physical execution occupies this diagnostic slot. */
  #active: IpcSendClass | null = null
  /** Independent exact receipts are snapshotted before synchronous nested delivery. */
  readonly #listeners = new Set<IIpcListener>()
  /** Pending operation identities make drain independent from listener failures and native policy. */
  readonly #writes = new Set<Promise<void>>()
  /** The concrete owner closes admission once; accepted native completion remains observable. */
  #closed = false
  /** Original close reason reaches accepted work that has not yet entered its physical sender. */
  #closeReason: unknown
  /** Concurrent drain callers borrow one original pending completion until all writes settle. */
  #idle: Promise<void> | undefined
  /** The current idle resolver is released before arbitrary Promise continuations can reenter. */
  #resolveIdle: (() => void) | undefined

  /** Validate both lanes before allocating or sending any native work. */
  constructor(options: IIpcFlowControlOptions, context: IProcessFeatureContext) {
    this.#context = context
    this.#capacity = {
      data: options.maxPendingData ?? IpcCapacity.data,
      control: options.maxPendingControl ?? IpcCapacity.control
    }
    // The canonical IpcSendClass constant fixes this validation loop to two lanes.
    for (const capacity of Object.values(this.#capacity))
      if (!Number.isSafeInteger(capacity) || capacity < 1)
        throw tagRpcError(
          new TypeError(ProcessFeatureText.capacityInvalid),
          RpcCoreErrorCode.invalidConfig
        )
  }
  /** Reserve one original logical message before its frame pipeline can batch or fragment it. */
  reserveWrite(facts: IIpcSendFacts, guard?: IRpcWriteQueueGuard): IRpcWriteAdmission {
    if (this.#closed) throw new RpcLifecycleError(RpcCoreErrorText.endpointDisposed)
    /** This immutable lane fact cannot change while this logical message holds capacity. */
    const lane = facts.sendClass
    if (this.#pending[lane] >= this.#capacity[lane]) {
      /** Overload keeps the original error identity in diagnostics and the synchronous admission. */
      const error = markRpcCarrierAdmissionFailure(
        new RpcError(RpcCoreErrorCode.overloaded, ProcessFeatureText.overloaded)
      )
      this.#emit(this.#snapshot(IpcLogEventName['ipc.backlog.rejected'], facts, error))
      throw error
    }
    this.#pending[lane] += 1
    this.#watermark(lane)
    // Synchronous observers can close admission before a new frame pipeline has received its loan.
    if (this.#closed) {
      this.#release(lane)
      throw this.#closeReason
    }
    return Object.freeze(new IpcWriteAdmission(this, () => this.#release(lane), guard))
  }

  /** Return a logical reservation once; physical operations retain their independent drain fence. */
  #release(lane: IpcSendClass): void {
    this.#pending[lane] -= 1
    this.#watermark(lane)
    this.#resolveWhenIdle()
  }

  /** Resolve the shared drain only after every logical credit and physical write has left. */
  #resolveWhenIdle(): void {
    if (this.#pending.data !== 0 || this.#pending.control !== 0 || this.#writes.size !== 0) return
    this.#resolveIdle?.()
    this.#idle = undefined
    this.#resolveIdle = undefined
  }

  /** Select original lane facts, borrowing genuine logical credit without counting each fragment. */
  run(
    facts: IIpcSendFacts,
    write: IIpcWrite,
    admission?: IIpcSendAdmission,
    schedule?: IIpcSchedule
  ): Promise<void> {
    if (this.#closed)
      return Promise.reject(new RpcLifecycleError(RpcCoreErrorText.endpointDisposed))
    /** Legacy physical callers own a fresh credit; the Session returns explicitly borrowed ones. */
    let owned: IRpcWriteAdmission | undefined
    if (
      !(admission?.admission instanceof IpcWriteAdmission && admission.admission.belongsTo(this))
    ) {
      try {
        owned = this.reserveWrite(facts)
      } catch (error) {
        return Promise.reject(error)
      }
    }
    /** Original scheduler controls physical entry only, never the lifetime of borrowed credit. */
    let sending: Promise<void>
    /** Queued send inputs are retained only until their original native turn begins. */
    const scheduling = { facts, write, admission }
    try {
      sending = schedule
        ? schedule(() => this.#write(scheduling.facts, scheduling.write, scheduling.admission))
        : this.#write(facts, write, admission)
    } catch (error) {
      sending = Promise.reject(error)
    }
    /** Physical settlement remains indexed by its original returned completion. */
    const receipt = { owned } as { owned?: IRpcWriteAdmission; settled: Promise<void> }
    /** Native failures are reported once here, before Session applies its existing IO wrapper. */
    const settled = sending
      .catch((error: unknown) => {
        this.#emit(this.#snapshot(IpcLogEventName['ipc.send.failed'], facts, error))
        throw error
      })
      .finally(() => {
        receipt.owned?.release()
        this.#writes.delete(receipt.settled)
        this.#resolveWhenIdle()
      })
    receipt.settled = settled
    this.#writes.add(settled)
    return settled
  }
  /** Check the original operation immediately before actual preparation; never after handoff. */
  async #write(
    facts: IIpcSendFacts,
    write: IIpcWrite,
    admission?: IIpcSendAdmission
  ): Promise<void> {
    if (this.#closed) throw this.#closeReason
    ;(0, admission?.assertCanSend)?.()
    if (!admission?.coalesced) this.#active = facts.sendClass
    try {
      await write()
    } finally {
      if (!admission?.coalesced) this.#active = null
    }
  }
  /** Retain duplicate callbacks independently and make each remover idempotent. */
  readonly onEvent = (listener: (event: IIpcBacklogEvent) => void): (() => void) => {
    /** Receipt identity makes removal during delivery affect the following publish only. */
    const receipt = { invoke: listener }
    this.#listeners.add(receipt)
    return () => {
      this.#listeners.delete(receipt)
    }
  }
  /** Capture original local counts before arbitrary observers can reenter this flow. */
  #snapshot(
    name: IIpcBacklogEvent['name'],
    facts?: IIpcSendFacts,
    error?: unknown
  ): IIpcBacklogEvent {
    return Object.freeze({
      name,
      connectionId: this.#context.connectionId,
      ...(this.#context.sessionId === undefined ? {} : { sessionId: this.#context.sessionId }),
      pendingData: this.#pending.data,
      pendingControl: this.#pending.control,
      active: this.#active,
      ...(facts?.trace === undefined ? {} : { trace: facts.trace }),
      ...(error === undefined ? {} : { error })
    })
  }
  /**
   * Every selected receipt runs in registration order; late rejection reaches the original terminal
   * reporter.
   */
  #emit(event: IIpcBacklogEvent): void {
    for (const receipt of Array.from(this.#listeners)) {
      try {
        /** Runtime-returned thenables remain observed even though listener result type is void. */
        const result = (0, receipt.invoke)(event)
        observeThenableRejection(result, inspectThenable(result), (error) =>
          hostRethrowReporter(error, IpcReporterContext)
        )
      } catch (error) {
        hostRethrowReporter(error, IpcReporterContext)
      }
    }
  }
  /** Original hysteresis is independent per reserved lane and emits only threshold crossings. */
  #watermark(lane: IpcSendClass): void {
    if (
      !this.#high[lane] &&
      this.#pending[lane] >= Math.ceil(this.#capacity[lane] * IpcCapacity.high)
    ) {
      this.#high[lane] = true
      this.#emit(this.#snapshot(IpcLogEventName['ipc.backlog.high']))
    } else if (
      this.#high[lane] &&
      this.#pending[lane] <= Math.floor(this.#capacity[lane] * IpcCapacity.low)
    ) {
      this.#high[lane] = false
      this.#emit(this.#snapshot(IpcLogEventName['ipc.backlog.low']))
    }
  }
  /** Stop new admission and release listener ownership; native active writes still settle normally. */
  readonly close = (reason?: unknown): void => {
    if (this.#closed) return
    this.#closed = true
    this.#closeReason = reason ?? new RpcLifecycleError(RpcCoreErrorText.endpointDisposed)
    this.#listeners.clear()
  }
  /** Existing limiter diagnostics enter the same original local event stream. */
  reportFailure(error: unknown): void {
    this.#emit(this.#snapshot(IpcLogEventName['ipc.send.failed'], undefined, error))
  }
  /** Snapshot accepted operations after close; this never fabricates remote acknowledgement. */
  readonly whenIdle = (): Promise<void> => {
    if (this.#writes.size === 0 && this.#pending.data === 0 && this.#pending.control === 0)
      return Promise.resolve()
    this.#idle ??= new Promise<void>((resolve) => {
      this.#resolveIdle = resolve
    })
    return this.#idle
  }
}

/**
 * One complete definition creates one installation-local admission owner; no options registry
 * exists.
 */
export function flowControl(options: IIpcFlowControlOptions = {}) {
  /** Capture both fields before a later caller mutation can reconfigure an open connection. */
  const captured = Object.freeze({
    maxPendingData: options.maxPendingData,
    maxPendingControl: options.maxPendingControl
  })
  return Object.freeze({
    kind: ProcessFeatureName.flowControl,
    install: (context: IProcessFeatureContext) => {
      /** Native ownership installs this exact lane state once and lends it to its actual queue. */
      const value = new IpcFlowControl(captured, context)
      return { value, dispose: value.close }
    }
  })
}
/** The exact complete flow definition is used by concrete process installation identity checks. */
export type IRpcFlowControlFeature = ReturnType<typeof flowControl>
export default flowControl
