/** Owns race mechanics; public API admission stays in promise.ts. */
import { PromiseOperation, PromiseDiagnosticPhase } from './promise-contract.ts'

import { collectOperationCleanup, operationCleanupFailure } from './promise-abort.ts'

import { ERROR_SOURCE, UtilsErrorCode } from '../error-code.ts'
import { UtilsErrorText } from '../error-text.ts'
import { attachErrorIdentity, UtilsAbortError } from '../error.ts'

import type {
  IAbortSignal,
  INativeAbortSignal,
  IUtilsReporter,
  IAbortOperation
} from './promise-contract.ts'
import { observeAbort, acknowledgesCancellation, reportDiagnostic } from './promise-abort.ts'

/** Own one raceWithAbort settlement, cancellation and cleanup transaction. */
export class AbortRaceOperation<T> {
  /** The admitted user callback stays unchanged and is invoked without a receiver. */
  #operation: IAbortOperation<T>
  /** The original signal snapshot fixes listener admission and abort observation order. */
  #signals: readonly IAbortSignal[]
  /** Background and late failures keep the original diagnostic destination. */
  #report: IUtilsReporter
  /** The caller retains its existing cleanup rejection or reporting policy. */
  #cleanupPolicy: 'reject' | 'report'
  /** The original cooperative cancellation controller owns the operation signal and reason. */
  #controller: AbortController
  /** The operation receives the same native or inert signal admitted before resource setup. */
  #operationSignal: INativeAbortSignal
  /** Terminal settlement prevents duplicate cleanup and callbacks. */
  #settled: boolean = false
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
    operation: IAbortOperation<T>,
    signals: readonly IAbortSignal[],
    report: IUtilsReporter,
    cleanupPolicy: 'reject' | 'report',
    controller: AbortController,
    operationSignal: INativeAbortSignal
  ) {
    this.#operation = operation
    this.#signals = signals
    this.#report = report
    this.#cleanupPolicy = cleanupPolicy
    this.#controller = controller
    this.#operationSignal = operationSignal
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
    try {
      for (const candidate of this.#signals) {
        // A failed registration may still have installed the listener.
        this.#admitted.push(candidate)
        candidate.addEventListener('abort', this.#onAbort, { once: true })
        if (this.#settled) return
      }
    } catch (error) {
      /** Keep the native registration failure reachable while classifying this boundary rejection. */
      const admissionError = attachErrorIdentity(
        new TypeError(UtilsErrorText.invalidArgument('signal', 'abort listener admission failed'), {
          cause: error
        }),
        { source: ERROR_SOURCE, code: UtilsErrorCode.invalidArgument }
      )
      this.#finish(false, admissionError, admissionError)
      return
    }
    /** Close the original post-registration cancellation race with the same observation order. */
    const after = observeAbort(this.#signals)
    if (after.kind === 'failed') return this.#finish(false, after.error, after.error)
    if (after.kind === 'aborted') return this.#onAbort()
    try {
      Promise.resolve(
        Reflect.apply(this.#operation, undefined, [{ signal: this.#operationSignal }])
      ).then(this.#onFulfilled, this.#onRejected)
    } catch (error) {
      this.#finish(false, error, error)
    }
  }
  /** Publish the original value after listener cleanup, retaining the configured cleanup policy. */
  #onFulfilled = (value: T): void => {
    if (!this.#settled) this.#finish(true, value)
  }
  /** Report late failures once without replacing the first rejection or its original cause. */
  #onRejected = (error: unknown): void => {
    if (this.#settled) {
      if (!acknowledgesCancellation(error, this.#controller.signal))
        reportDiagnostic(this.#report, error, {
          operation: PromiseOperation['raceWithAbort'],
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
    const cleanupErrors = collectOperationCleanup(this.#admitted, this.#onAbort)
    if (cleanupErrors.length > 0) {
      if (this.#cleanupPolicy === 'report') {
        for (const error of cleanupErrors)
          reportDiagnostic(this.#report, error, {
            operation: PromiseOperation['raceWithAbort'],
            phase: PromiseDiagnosticPhase['cleanup']
          })
        if (fulfilled) this.#resolve(value as T)
        else this.#reject(value)
        return
      }
      this.#reject(operationCleanupFailure(primaryError, cleanupErrors))
      return
    }
    if (fulfilled) this.#resolve(value as T)
    else this.#reject(value)
  }
  /** Observe the original outside signal and settle its cancellation. */
  #onAbort = (): void => {
    /** Observe cancellation in the original signal order before releasing owned resources. */
    const observation = observeAbort(this.#signals)
    if (observation.kind === 'failed') {
      this.#finish(false, observation.error, observation.error)
      return
    }
    /** Forward the first observed cancellation reason without rebuilding or replacing it. */
    const reason = observation.kind === 'aborted' ? observation.reason : undefined
    this.#controller.abort(reason)
    /** This exact boundary failure becomes the public outcome after required cleanup. */
    const error = new UtilsAbortError(reason)
    this.#finish(false, error, error)
  }
}
