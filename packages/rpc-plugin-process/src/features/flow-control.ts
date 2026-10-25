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
import { IpcSendClass } from '@migaia/rpc-contract/interfaces'
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
    for (const capacity of Object.values(this.#capacity))
      if (!Number.isSafeInteger(capacity) || capacity < 1)
        throw tagRpcError(
          new TypeError(ProcessFeatureText.capacityInvalid),
          RpcCoreErrorCode.invalidConfig
        )
  }
  /** Select only admitted lane facts and preserve the exact physical write's failure identity. */
  run(
    facts: IIpcSendFacts,
    write: IIpcWrite,
    admission?: IIpcSendAdmission,
    schedule?: IIpcSchedule
  ): Promise<void> {
    if (this.#closed)
      return Promise.reject(new RpcLifecycleError(RpcCoreErrorText.endpointDisposed))
    /** This immutable lane fact cannot change while capacity is held. */
    const lane = facts.sendClass
    if (this.#pending[lane] >= this.#capacity[lane]) {
      /** The original overload identity is emitted and returned as the same native Error. */
      const error = markRpcCarrierAdmissionFailure(
        new RpcError(RpcCoreErrorCode.overloaded, ProcessFeatureText.overloaded)
      )
      this.#emit(this.#snapshot(IpcLogEventName['ipc.backlog.rejected'], facts, error))
      return Promise.reject(error)
    }
    this.#pending[lane]++
    this.#watermark(lane)
    /** The physical scheduler cannot release logical capacity before its returned write completes. */
    let sending: Promise<void>
    /** Only the queued sender retains preparation inputs until its original physical turn. */
    const scheduling = { facts, write, admission }
    try {
      sending = schedule
        ? schedule(() => this.#write(scheduling.facts, scheduling.write, scheduling.admission))
        : this.#write(facts, write, admission)
    } catch (error) {
      sending = Promise.reject(error)
    }
    /** Settlement retains only the lane and original completion, never preparation inputs. */
    const receipt = { lane } as { lane: IpcSendClass; settled: Promise<void> }
    /** Both drain and watermarks consume the original operation's settlement exactly once. */
    const settled = sending
      .catch((error: unknown) => {
        this.#emit(this.#snapshot(IpcLogEventName['ipc.send.failed'], facts, error))
        throw error
      })
      .finally(() => {
        this.#pending[receipt.lane]--
        this.#watermark(receipt.lane)
        this.#writes.delete(receipt.settled)
        if (this.#writes.size === 0) {
          this.#resolveIdle?.()
          this.#idle = undefined
          this.#resolveIdle = undefined
        }
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
    admission?.assertCanSend?.()
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
        const result = receipt.invoke(event)
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
    if (this.#writes.size === 0) return Promise.resolve()
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
