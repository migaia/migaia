/** Owns timeout mechanics; public API admission stays in promise.ts. */
import { PromiseOperation, PromiseDiagnosticPhase } from './promise-contract.ts'

import { collectOperationCleanup, operationCleanupFailure } from './promise-abort.ts'

import { UtilsAbortError, UtilsTimeoutError } from '../error.ts'
import { type IScheduledTask, type IScheduler } from '../scheduler.ts'

import type {
  IAbortSignal,
  INativeAbortSignal,
  IUtilsReporter,
  ITimeoutOperation
} from './promise-contract.ts'
import {
  observeAbort,
  acknowledgesCancellation,
  reportDiagnostic,
  type IAbortControllerLike
} from './promise-abort.ts'

/** Stable inert signal used by deadline-only callers that must not allocate an AbortController. */
const inertTimeoutSignal: IAbortSignal = Object.freeze({
  aborted: false,
  addEventListener: (): void => undefined,
  removeEventListener: (): void => undefined
})

/** Own one withTimeout settlement, cancellation and cleanup transaction. */
export class TimeoutOperation<T> {
  /** The admitted user callback stays unchanged and is invoked without a receiver. */
  #operation: ITimeoutOperation<T>
  /** The original signal snapshot fixes listener admission and abort observation order. */
  #signals: readonly IAbortSignal[]
  /** Background and late failures keep the original diagnostic destination. */
  #report: IUtilsReporter
  /** The original cooperative cancellation controller owns the operation signal and reason. */
  #controller: IAbortControllerLike | undefined
  /** The original retry or operation owner determines the deadline error scope. */
  #timeoutScope: 'operation' | 'attempt' | 'total'
  /** The operation receives the same native or inert signal admitted before resource setup. */
  #operationSignal: IAbortSignal | undefined
  /** The validated deadline controls both scheduling and timeout classification. */
  #timeoutMs: number
  /** The original zero-deadline policy decides whether the user callback may start. */
  #zeroTimeoutBehavior: 'skip' | 'start' | undefined
  /** The admitted scheduler remains the sole timer and clock owner. */
  #scheduler: IScheduler
  /** The original ref policy is applied to the actual returned timer receipt. */
  #unref: boolean | undefined
  /** Terminal settlement prevents duplicate cleanup and callbacks. */
  #settled: boolean = false
  /** Deadline settlement suppresses a subsequent outside-abort path. */
  #timedOut: boolean = false
  /** The original scheduler receipt owns timer cancellation and unref. */
  #timer: IScheduledTask | undefined
  /** Admitted listeners are removed in original reverse registration order. */
  #admitted: IAbortSignal[] = []
  /** Native settlement callbacks belong to the same Promise returned to the caller. */
  #resolve!: (value: T | PromiseLike<T>) => void
  /** Rejection preserves the original primary or cleanup reason. */
  #reject!: (reason?: unknown) => void
  /** The single result retains native Promise settlement and identity. */
  readonly promise: Promise<T>
  /** Capture admitted inputs before installing timers or abort listeners. */
  constructor(
    operation: ITimeoutOperation<T>,
    signals: readonly IAbortSignal[],
    report: IUtilsReporter,
    controller: IAbortControllerLike | undefined,
    timeoutScope: 'operation' | 'attempt' | 'total',
    operationSignal: IAbortSignal | undefined,
    timeoutMs: number,
    zeroTimeoutBehavior: 'skip' | 'start' | undefined,
    scheduler: IScheduler,
    unref: boolean | undefined
  ) {
    this.#operation = operation
    this.#signals = signals
    this.#report = report
    this.#controller = controller
    this.#timeoutScope = timeoutScope
    this.#operationSignal = operationSignal
    this.#timeoutMs = timeoutMs
    this.#zeroTimeoutBehavior = zeroTimeoutBehavior
    this.#scheduler = scheduler
    this.#unref = unref
    this.promise = new Promise<T>((resolve, reject) => {
      this.#resolve = resolve
      this.#reject = reject
      this.#run()
    })
  }
  /** Admit resources and start the original operation in its original order. */
  #run(): void {
    /** Observe external cancellation before admitting timers, listeners or user work. */
    const initial = observeAbort(this.#signals)
    if (initial.kind === 'failed') return this.#finish(false, initial.error, initial.error)
    if (initial.kind === 'aborted') return this.#onAbort()
    if (this.#timeoutMs === 0 && this.#zeroTimeoutBehavior !== 'start') {
      /** This exact boundary failure becomes the public outcome after required cleanup. */
      const error = new UtilsTimeoutError(this.#timeoutScope, 0)
      return this.#finish(false, error, error)
    }
    this.#timer = this.#scheduler.schedule(this.#onTimeout, this.#timeoutMs)
    if (this.#settled) this.#timer.cancel()
    try {
      if (this.#unref) this.#timer.unref?.()
    } catch (error) {
      this.#finish(false, error, error)
      return
    }
    try {
      for (const candidate of this.#signals) {
        // A failed registration may still have installed the listener.
        this.#admitted.push(candidate)
        candidate.addEventListener('abort', this.#onAbort, { once: true })
        if (this.#settled) return
      }
    } catch (error) {
      this.#finish(false, error, error)
      return
    }
    /** Close the original post-registration cancellation race with the same observation order. */
    const after = observeAbort(this.#signals)
    if (after.kind === 'failed') return this.#finish(false, after.error, after.error)
    if (after.kind === 'aborted') return this.#onAbort()
    if (this.#settled) return
    try {
      Promise.resolve(
        Reflect.apply(this.#operation, undefined, [
          {
            // A controller signal is a host `AbortSignal`; the inert fallback is only reachable when
            // the overloads promise the operation a structural signal instead.
            signal: (this.#operationSignal ?? inertTimeoutSignal) as INativeAbortSignal
          }
        ])
      ).then(this.#onFulfilled, this.#onRejected)
    } catch (error) {
      this.#finish(false, error, error)
    }
  }
  /** Abort cooperative work with the deadline error before releasing resources and rejecting. */
  #onTimeout = (): void => {
    this.#timedOut = true
    /** The same deadline error first cancels cooperative work and then becomes the rejection. */
    const timeoutError = new UtilsTimeoutError(this.#timeoutScope, this.#timeoutMs)
    this.#controller?.abort(timeoutError)
    this.#finish(false, timeoutError, timeoutError)
  }
  /** Publish the original value only after the admitted timer and listeners have been released. */
  #onFulfilled = (value: T): void => {
    if (this.#settled) return
    this.#finish(true, value)
  }
  /** Keep late failure reporting separate from the original cleanup-before-rejection transaction. */
  #onRejected = (error: unknown): void => {
    if (this.#settled) {
      if (!acknowledgesCancellation(error, this.#controller?.signal))
        reportDiagnostic(this.#report, error, {
          operation: PromiseOperation['withTimeout'],
          phase: PromiseDiagnosticPhase['late-rejection']
        })
      return
    }
    this.#finish(false, error, error)
  }
  /** Release the originally admitted resources before publishing settlement. */
  #finish(fulfilled: boolean, value: unknown, primaryError?: unknown): void {
    if (this.#settled) return
    this.#settled = true
    /** Release resources in their original order before publishing the public outcome. */
    const cleanupErrors = collectOperationCleanup(this.#admitted, this.#onAbort, this.#timer)
    if (cleanupErrors.length > 0) {
      this.#reject(operationCleanupFailure(primaryError, cleanupErrors))
      return
    }
    if (fulfilled) this.#resolve(value as T)
    else this.#reject(value)
  }
  /** Observe the original outside signal and settle its cancellation. */
  #onAbort = (): void => {
    if (!this.#timedOut) {
      /** Observe cancellation in the original signal order before releasing owned resources. */
      const observation = observeAbort(this.#signals)
      if (observation.kind === 'failed') {
        this.#finish(false, observation.error, observation.error)
        return
      }
      /** Forward the first observed cancellation reason without rebuilding or replacing it. */
      const reason = observation.kind === 'aborted' ? observation.reason : undefined
      this.#controller?.abort(reason)
      /** This exact boundary failure becomes the public outcome after required cleanup. */
      const error = new UtilsAbortError(reason)
      this.#finish(false, error, error)
    }
  }
}
