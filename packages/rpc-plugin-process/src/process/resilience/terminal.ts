/**
 * Tracks one native registration's terminal diagnostics and scheduled notifications before
 * liquidation. Supervisor state remains authoritative for actual restart and execution
 * availability.
 */
import { createProcessError } from '../error.ts'
import type { IScheduledTask, IScheduler } from '@migaia/utils/scheduler'
import { RpcProcessErrorCode } from '@migaia/rpc-contract/error-code'

import type {
  IProcessRegistration,
  IProcessRegistrationBinding,
  IProcessResilienceSnapshot
} from './types.ts'

/** One registration owns its terminal diagnostics, while supervision owns restart policy. */
export type IProcessTerminalRegistration = Readonly<{
  registration: IProcessRegistration
  assertAvailable(): void
  snapshot(): IProcessResilienceSnapshot | undefined
}>

/** Construction and public factory borrow the same actual native terminal-diagnostic ports. */
type IProcessTerminalOptions = Readonly<{
  name: string
  binding: IProcessRegistrationBinding
  scheduler: IScheduler
  reportAtMs: readonly number[]
  unhandledLimit: number
  report(error: unknown): void
  notify(snapshot: IProcessResilienceSnapshot): Promise<boolean>
  liquidate(): Promise<void>
  onClose(): void
}>

/** One offset rule is shared by primary registrations and suspended dependants. */
export function scheduleProcessDiagnostic(
  scheduler: IScheduler,
  offsets: readonly number[],
  beganAt: number,
  index: number,
  callback: () => void
): IScheduledTask {
  const last = offsets[offsets.length - 1]!
  const span = last - offsets[offsets.length - 2]!
  const offset =
    index < offsets.length ? offsets[index]! : last + (index - offsets.length + 1) * span
  return scheduler.schedule(callback, Math.max(0, beganAt + offset - scheduler.now()))
}

/** Create one terminal report clock without adding a second supervisor state machine. */
/** Allocate one registration terminal diagnostic clock before installing behavior callbacks. */
function processTerminalRegistrationState(options: IProcessTerminalOptions) {
  /** This owner stores only diagnostics not present in the supervisor snapshot. */
  let unhandled = 0
  /**
   * Committed liquidation prevents another owner-removal attempt for the same terminal
   * registration.
   */
  let liquidated = false
  /** Terminal admission state prevents this owner from accepting work after its resource is closed. */
  let closed = false
  /** The next configured recovery offset advances once per terminal diagnostic attempt. */
  let entry = 0
  /** The original terminal reason remains reachable through later liquidation and notification. */
  const reason = undefined as unknown
  /** At most one scheduled diagnostic or recovery step belongs to this owner at a time. */
  const timer = undefined as IScheduledTask | undefined
  /** The first owner-removal Promise is shared by concurrent terminal observations. */
  const liquidation = undefined as Promise<void> | undefined
  /** The first close operation owns cleanup; later callers observe the same settlement. */
  const closePromise = undefined as Promise<void> | undefined

  return {
    unhandled,
    liquidated,
    closed,
    entry,
    reason,
    timer,
    liquidation,
    closePromise,
    options,
    unsubscribe: undefined as unknown as () => void
  }
}

/** Own one registration terminal diagnostic clock; callbacks access only this explicit instance. */
class ProcessTerminalRegistration {
  /** All mutable storage and original construction inputs belong to this operation. */
  #state: ReturnType<typeof processTerminalRegistrationState>
  /** Preserve the original stable resource surface and callback identities. */
  readonly value: IProcessTerminalRegistration
  /** Publish genuine registration methods after acquiring the original terminal subscription. */
  constructor(options: IProcessTerminalOptions) {
    this.#state = processTerminalRegistrationState(options)
    this.#state.unsubscribe = this.#state.options.binding.supervisor.onTerminal(this.#terminal)
    /** Native availability remains local; the unresolved origin-routing policy is unchanged. */
    const registration: IProcessRegistration = Object.freeze({
      restart: this.#restart,
      inspect: this.#snapshot,
      close: this.#close
    })
    this.value = Object.freeze({
      registration,
      assertAvailable: this.#assertAvailable,
      snapshot: this.#snapshot
    })
  }

  /** Capture the same terminal entry and begin its original zero-offset diagnostic delivery. */
  readonly #terminal = (event: Readonly<{ entry: number; error: unknown }>): void => {
    this.#state.timer?.cancel()
    this.#state.entry = event.entry
    this.#state.reason = event.error
    /** The original scheduler alone supplies this entry's monotonic diagnostic origin. */
    const beganAt = this.#state.options.scheduler.now()
    void this.#deliver(this.#state.entry, 0, beganAt)
  }

  /** Retain the original terminal/liquidated distinction without changing originating policy. */
  readonly #assertAvailable = (): void => {
    if (this.#state.closed) return
    if (this.#state.liquidated)
      throw createProcessError(RpcProcessErrorCode.liquidated, this.#state.reason, {
        registrationId: this.#state.options.name
      })
    if (this.#state.options.binding.supervisor.inspect().state === 'terminal')
      throw createProcessError(RpcProcessErrorCode.terminalCall, this.#state.reason, {
        registrationId: this.#state.options.name
      })
  }

  /** Restart remains delegated to the original supervisor after any current liquidation settles. */
  readonly #restart: IProcessRegistration['restart'] = async () => {
    if (this.#state.liquidated)
      throw createProcessError(RpcProcessErrorCode.liquidated, this.#state.reason)
    if (this.#state.liquidation) await this.#state.liquidation.catch(() => undefined)
    if (this.#state.liquidated)
      throw createProcessError(RpcProcessErrorCode.liquidated, this.#state.reason)
    if (!this.#state.closed) {
      this.#state.timer?.cancel()
      this.#state.unhandled = 0
    }
    return this.#state.options.binding.supervisor.restart()
  }

  /** Return the same cached Promise while preserving the original synchronous close prefix. */
  readonly #close = (): Promise<void> => (this.#state.closePromise ??= this.#release())

  /** Cancel and unsubscribe before waiting for original liquidation, then remove this registration. */
  async #release(): Promise<void> {
    this.#state.closed = true
    this.#state.timer?.cancel()
    ;(0, this.#state.unsubscribe)()
    this.#state.unhandled = 0
    await this.#state.liquidation?.catch(() => undefined)
    this.#state.options.onClose()
  }

  /** Observe the original supervisor without changing its restart or terminal state. */
  #snapshot = (): IProcessResilienceSnapshot | undefined => {
    if (this.#state.closed) return undefined
    const supervisor = this.#state.options.binding.supervisor.inspect()
    return Object.freeze({
      id: this.#state.options.name,
      state: supervisor.state,
      health: this.#state.options.binding.health,
      unhandled: this.#state.unhandled,
      liquidated: this.#state.liquidated,
      ...(supervisor.state === 'terminal'
        ? { reason: this.#state.reason ?? supervisor.terminalError }
        : {})
    })
  }

  /** Schedule the next original report offset only for this still-current terminal entry. */
  #scheduleNext = (currentEntry: number, index: number, beganAt: number): void => {
    if (this.#state.closed || this.#state.liquidated || this.#state.entry !== currentEntry) return
    /** One explicit scheduled operation retains only this entry's original clock facts. */
    const delivery = { currentEntry, index, beganAt }
    this.#state.timer = scheduleProcessDiagnostic(
      this.#state.options.scheduler,
      this.#state.options.reportAtMs,
      beganAt,
      index,
      () => {
        void this.#deliver(delivery.currentEntry, delivery.index, delivery.beganAt)
      }
    )
  }

  /** Supervision already reported index zero; this owner reports only later ticks. */
  /** Notify observers, then retain the original unhandled threshold and liquidation ordering. */
  #deliver = async (currentEntry: number, index: number, beganAt: number): Promise<void> => {
    this.#state.timer = undefined
    if (this.#state.closed || this.#state.liquidated || this.#state.entry !== currentEntry) return
    if (this.#state.options.binding.supervisor.inspect().state !== 'terminal') return
    if (index > 0) this.#state.options.report(this.#state.reason)
    const current = this.#snapshot()
    if (!current) return
    let handled = false
    try {
      handled = await this.#state.options.notify(current)
    } catch (error) {
      this.#state.options.report(error)
    }
    if (this.#state.closed || this.#state.liquidated || this.#state.entry !== currentEntry) return
    if (handled) {
      this.#state.unhandled = 0
      return
    }
    this.#state.unhandled += 1
    if (this.#state.unhandled > this.#state.options.unhandledLimit) {
      this.#state.liquidation = Promise.resolve().then(() => this.#state.options.liquidate())
      try {
        await this.#state.liquidation
        this.#state.liquidated = true
        ;(0, this.#state.unsubscribe)()
        this.#state.options.onClose()
      } catch (error) {
        this.#state.liquidation = undefined
        this.#state.options.report(error)
      }
      return
    }
    this.#scheduleNext(currentEntry, index + 1, beganAt)
  }
}

/** Construct the single owner for one registration terminal diagnostic clock. */
export function createProcessTerminalRegistration(
  options: IProcessTerminalOptions
): IProcessTerminalRegistration {
  return new ProcessTerminalRegistration(options).value
}
