import { withTimeout, type ITimeoutOperation } from '@migaia/utils/promise'
import { isUtilsTimeoutError } from '@migaia/utils/error'
import type { IScheduledTask, IScheduler } from '@migaia/utils/scheduler'
import type { ILogPluginCore } from './typing.ts'
import { createLogError } from './errors.ts'
import { LogHostErrorCode } from './error-code.ts'
import { LogHostErrorText } from './error-text.ts'

/** The actual output installation owns delivery and reporting; an attempt owns only its outcome. */
type IAttemptOutput<R> = {
  readonly core: ILogPluginCore
  deliver(records: readonly R[], signal: AbortSignal): void | Promise<void>
  report(error: unknown): void
}

/** An absent outcome means delivery did not settle before another attempt boundary failed. */
type IDeliveryOutcome = { fulfilled: true } | { fulfilled: false; error: unknown }

/** One attempt preserves delivery primary identity while canonical utils owns timing and cleanup. */
export class DeliveryAttempt<R> implements IScheduler {
  /** The transport installation retains its original scheduler and failure channel. */
  #output: IAttemptOutput<R>
  /** This attempt borrows one already-built batch without changing its record type. */
  #records: readonly R[]
  /** Actual deliver settlement distinguishes transport failure from cleanup after success. */
  #outcome: IDeliveryOutcome | undefined
  /** Only known timeout cleanup branches are retained separately from the deliver primary. */
  #cleanupErrors: readonly unknown[] = []
  /** The original utils cleanup value stays reachable when several attempts must be composed. */
  #cleanupFailure: unknown
  /** Failed scheduler admission is primary even if an early callback already settled utils. */
  #admissionFailure: { error: unknown } | undefined
  /** Only callback failure during registration requires rollback of a subsequently returned receipt. */
  #registering = false

  /** Capture one attempt's original transport and batch before it can start. */
  constructor(output: IAttemptOutput<R>, records: readonly R[]) {
    this.#output = output
    this.#records = records
  }

  /** Cleanup after a successful operation must never be offered for transport replay. */
  get fulfilled(): boolean {
    return this.#outcome?.fulfilled === true
  }

  /** Retry may consume an attempt failure, but its independent cleanup errors remain host-owned. */
  get cleanupErrors(): readonly unknown[] {
    return this.#cleanupErrors
  }

  /** Preserve the original utils aggregate rather than rebuilding its native identity. */
  get cleanupFailure(): unknown {
    return this.#cleanupFailure
  }

  /** Retry classification receives the exact deliver primary, never a cleanup wrapper. */
  primary(fallback: unknown): unknown {
    if (this.#outcome?.fulfilled === false) return this.#outcome.error
    return this.#admissionFailure ? this.#admissionFailure.error : fallback
  }

  /** Use the original admitted clock rather than creating another timing domain. */
  now(): number {
    return this.#output.core.scheduler.now()
  }

  /** Observe failed admission without replacing the canonical scheduler or timeout state machine. */
  schedule(callback: () => void, delayMs: number): IScheduledTask {
    /** Only a successfully returned original receipt can be rolled back by this admission owner. */
    let task: IScheduledTask
    this.#registering = true
    try {
      task = this.#output.core.scheduler.schedule(() => this.#invoke(callback), delayMs)
    } catch (error) {
      this.#admissionFailure ??= { error }
      throw error
    } finally {
      this.#registering = false
    }
    if (this.#admissionFailure) {
      try {
        task.cancel()
      } catch (cleanup) {
        this.#admissionFailure = {
          error: new AggregateError(
            [this.#admissionFailure.error, cleanup],
            LogHostErrorText.deliveryFailed
          )
        }
      }
      throw this.#admissionFailure.error
    }
    return task
  }

  /** An admission callback failure cannot prevent ownership of the receipt returned afterward. */
  #invoke(callback: () => void): void {
    if (!this.#registering) {
      callback()
      return
    }
    try {
      callback()
    } catch (error) {
      this.#admissionFailure ??= { error }
    }
  }

  /** Capture the actual transport outcome before timeout cleanup can change the public rejection. */
  async #deliver(signal: AbortSignal): Promise<void> {
    try {
      await this.#output.deliver(this.#records, signal)
      this.#outcome = { fulfilled: true }
    } catch (error) {
      this.#outcome = { fulfilled: false, error }
      throw error
    }
  }

  /** The timeout receives its own real cooperative signal without another controller. */
  readonly #timedDeliver: ITimeoutOperation<void> = (context) =>
    this.#deliver(context.signal as AbortSignal)

  /** Late rejections retain the output's established report policy. */
  readonly #report = (error: unknown): void => this.#output.report(error)

  /** Keep utils errors intact on cause while assigning host-owned cleanup a coded boundary. */
  async run(signal: AbortSignal, timeoutMs?: number): Promise<void> {
    if (timeoutMs === undefined) return this.#deliver(signal)
    try {
      await withTimeout(this.#timedDeliver, {
        timeoutMs,
        signal,
        scheduler: this,
        report: this.#report
      })
    } catch (error) {
      this.#captureCleanup(error)
      if (this.#admissionFailure) throw this.#hostFailure(this.#admissionFailure.error)
      if (this.#outcome?.fulfilled === false && error === this.#outcome.error) throw error
      if (this.#outcome !== undefined || isUtilsTimeoutError(error)) throw this.#hostFailure(error)
      throw error
    }
  }

  /** Extract only the canonical cleanup result correlated with this attempt's actual outcome. */
  #captureCleanup(error: unknown): void {
    if (!this.#outcome) return
    if (!this.#outcome.fulfilled && error === this.#outcome.error) return
    if (error instanceof AggregateError) {
      if (!this.#outcome.fulfilled && error.errors[0] !== this.#outcome.error) return
      this.#cleanupErrors = this.#outcome.fulfilled ? error.errors : error.errors.slice(1)
    } else if (this.#outcome.fulfilled) this.#cleanupErrors = [error]
    this.#cleanupFailure = error
  }

  /** The original primary or cleanup aggregate remains the exact cause of the host boundary. */
  #hostFailure(cause: unknown): Error {
    return createLogError(LogHostErrorCode.deliveryFailed, LogHostErrorText.deliveryFailed, {
      cause
    })
  }
}
