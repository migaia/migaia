/** Owns sleep mechanics; public API admission stays in promise.ts. */
import { PromiseOperation, PromiseDiagnosticPhase } from './promise-contract.ts'

import { collectOperationCleanup } from './promise-abort.ts'

import { UtilsAbortError } from '../error.ts'
import { type IScheduledTask, type IScheduler } from '../scheduler.ts'
import { reportUnhandledError as hostRethrowReporter } from '../host-report.ts'
import type { IAbortSignal } from './promise-contract.ts'
import { observeAbort, reportDiagnostic } from './promise-abort.ts'

/** Own one sleep settlement, cancellation and cleanup transaction. */
export class SleepOperation {
  /** The validated duration is scheduled once without another timer owner. */
  #delayMs: number
  /** The admitted scheduler remains the sole timer and clock owner. */
  #scheduler: IScheduler
  /** The original signal snapshot fixes listener admission and abort observation order. */
  #signals: readonly IAbortSignal[]
  /** The original ref policy is applied to the actual returned timer receipt. */
  #unref: boolean | undefined
  /** Terminal settlement prevents duplicate cleanup and callbacks. */
  #settled: boolean = false
  /** The original scheduler receipt owns timer cancellation and unref. */
  #timer: IScheduledTask | undefined
  /** Admitted listeners are removed in original reverse registration order. */
  #admitted: IAbortSignal[] = []
  /** Native settlement callbacks belong to the same Promise returned to the caller. */
  #resolve!: (value: void | PromiseLike<void>) => void
  /** Rejection preserves the original primary or cleanup reason. */
  #reject!: (reason?: unknown) => void
  /** The single result retains native Promise settlement and identity. */
  readonly promise: Promise<void>
  /** Capture admitted inputs before installing timers or abort listeners. */
  constructor(
    delayMs: number,
    scheduler: IScheduler,
    signals: readonly IAbortSignal[],
    unref: boolean | undefined
  ) {
    this.#delayMs = delayMs
    this.#scheduler = scheduler
    this.#signals = signals
    this.#unref = unref
    this.promise = new Promise<void>((resolve, reject) => {
      this.#resolve = resolve
      this.#reject = reject
      this.#run()
    })
  }
  /** Admit resources and start the original operation in its original order. */
  #run(): void {
    try {
      /** Observe external cancellation before admitting timers, listeners or user work. */
      const initial = observeAbort(this.#signals)
      if (initial.kind === 'failed') {
        this.#settled = true
        this.#cleanup(initial.error)
        return
      }
      if (initial.kind === 'aborted') return this.#onAbort()
      this.#timer = this.#scheduler.schedule(() => {
        if (this.#settled) return
        this.#settled = true
        if (this.#cleanup()) this.#resolve()
      }, this.#delayMs)
      if (this.#unref) this.#timer.unref?.()
      for (const candidate of this.#signals) {
        // Own rollback before registration, which may acquire a listener and then throw.
        this.#admitted.push(candidate)
        candidate.addEventListener('abort', this.#onAbort, { once: true })
      }
      /** Close the original post-registration cancellation race with the same observation order. */
      const after = observeAbort(this.#signals)
      if (after.kind === 'failed') {
        this.#settled = true
        this.#cleanup(after.error)
      } else if (after.kind === 'aborted') this.#onAbort()
    } catch (error) {
      if (!this.#settled) {
        this.#settled = true
        this.#cleanup(error)
      }
    }
  }
  /** Release the originally admitted resources before publishing settlement. */
  #cleanup(primaryError?: unknown): boolean {
    /** Release resources in their original order before publishing the public outcome. */
    const cleanupErrors = collectOperationCleanup(this.#admitted, this.#onAbort, this.#timer)
    if (cleanupErrors.length > 0) {
      for (const error of cleanupErrors)
        reportDiagnostic(hostRethrowReporter, error, {
          operation: PromiseOperation['sleep'],
          phase: PromiseDiagnosticPhase['cleanup']
        })
    }
    if (primaryError !== undefined) this.#reject(primaryError)
    return primaryError === undefined
  }
  /** Observe the original outside signal and settle its cancellation. */
  #onAbort = (): void => {
    if (this.#settled) return
    /** Observe cancellation in the original signal order before releasing owned resources. */
    const observation = observeAbort(this.#signals)
    this.#settled = true
    this.#cleanup(
      observation.kind === 'failed'
        ? observation.error
        : new UtilsAbortError(observation.kind === 'aborted' ? observation.reason : undefined)
    )
  }
}
