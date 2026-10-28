/** Owns abort timeout mechanics; public API admission stays in promise.ts. */
import { PromiseOperation, PromiseDiagnosticPhase } from './promise-contract.ts'

import { systemScheduler, type IScheduledTask } from '../scheduler.ts'

import type {
  IAbortSignal,
  IAbortTimeoutSignal,
  IAbortTimeoutSignalOptions
} from './promise-contract.ts'
import {
  observeAbort,
  observeAbortReason,
  snapshotSignals,
  reportDiagnostic
} from './promise-abort.ts'

/** One merged signal owns its timer and external subscription cleanup. */
export class AbortTimeoutSignal implements IAbortTimeoutSignal {
  /** The native controller is the sole authority for the merged signal. */
  #controller = new AbortController()
  /** External cancellation retains its original reason and receiver. */
  #externalSignal: IAbortSignal | undefined
  /** Cleanup must attempt every originally admitted subscription. */
  #signals: readonly IAbortSignal[]
  /** Cleanup failures follow the caller's existing diagnostic reporter. */
  #report: IAbortTimeoutSignalOptions['report'] & {}
  /** The caller's reason factory runs only when the timeout actually fires. */
  #timeoutReason: IAbortTimeoutSignalOptions['timeoutReason']
  /** One optional scheduler task is cancelled once by disposal. */
  #timer: IScheduledTask | undefined
  /** Disposal fences repeated timer/subscription cleanup. */
  #disposed = false
  /** Stable signal identity is shared by all observers. */
  readonly signal: IAbortSignal

  /** Preserve timer admission, pre-abort observation and post-subscription race checks. */
  constructor(
    timeoutMs: number,
    externalSignal: IAbortSignal | undefined,
    report: IAbortTimeoutSignalOptions['report'] & {},
    options: IAbortTimeoutSignalOptions
  ) {
    /** Scheduler is captured only for timeout-bearing calls. */
    const scheduler = options.scheduler ?? systemScheduler
    this.#timeoutReason = options.timeoutReason
    this.#signals = snapshotSignals(undefined, externalSignal)
    this.#externalSignal = externalSignal
    this.#report = report
    this.signal = this.#controller.signal as unknown as IAbortSignal
    /** Pre-abort observation precedes native registration. */
    const initial = observeAbort(this.#signals)
    if (initial.kind === 'failed') throw initial.error
    if (initial.kind === 'aborted') this.#controller.abort(initial.reason)
    else if (timeoutMs === 0) this.#controller.abort(this.#createTimeoutReason())
    else
      this.#timer = scheduler.schedule(
        () => this.#controller.abort(this.#createTimeoutReason()),
        timeoutMs
      )
    if (initial.kind === 'none' && this.#externalSignal !== undefined && timeoutMs !== 0) {
      try {
        this.#externalSignal.addEventListener('abort', this.#onExternalAbort, { once: true })
        /** The original race check observes cancellation during listener installation. */
        const afterSubscription = observeAbort(this.#signals)
        if (afterSubscription.kind === 'failed') {
          this.dispose()
          throw afterSubscription.error
        }
        if (afterSubscription.kind === 'aborted') this.#controller.abort(afterSubscription.reason)
      } catch (error) {
        this.dispose()
        throw error
      }
    }
  }

  /** Cancel the timer and release all admitted external subscriptions exactly once. */
  dispose = (): void => {
    if (this.#disposed) return
    this.#disposed = true
    try {
      this.#timer?.cancel()
    } catch (error) {
      reportDiagnostic(this.#report, error, {
        operation: PromiseOperation['abort-timeout-signal'],
        phase: PromiseDiagnosticPhase['cleanup']
      })
    }
    // Removal is intentionally attempted even when admission failed or pre-abort skipped add:
    // an event target may register before throwing, and storage's migrated cleanup trace requires it.
    for (const signal of this.#signals)
      try {
        signal.removeEventListener('abort', this.#onExternalAbort)
      } catch (error) {
        reportDiagnostic(this.#report, error, {
          operation: PromiseOperation['abort-timeout-signal'],
          phase: PromiseDiagnosticPhase['cleanup']
        })
      }
  }
  /** External cancellation forwards the original reason without cancelling independent resources. */
  #onExternalAbort = (): void => {
    if (this.#externalSignal !== undefined)
      this.#controller.abort(observeAbortReason(this.#externalSignal))
  }
  /** Contains a hostile timeout reason factory inside the signal's existing reason channel. */
  #createTimeoutReason = (): unknown => {
    try {
      /** Reason factories remain plain calls with no new receiver. */
      const factory = this.#timeoutReason
      return factory?.()
    } catch (error) {
      return error
    }
  }
}
