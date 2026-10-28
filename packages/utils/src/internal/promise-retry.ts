/** Owns retry mechanics; public API admission stays in promise.ts. */
import { UtilsTimeoutScope } from './error-primitives.ts'
import { PromiseOperation, PromiseDiagnosticPhase } from './promise-contract.ts'

import { ERROR_SOURCE, UtilsErrorCode } from '../error-code.ts'
import { UtilsErrorText } from '../error-text.ts'
import { attachErrorIdentity, UtilsAbortError, UtilsTimeoutError } from '../error.ts'
import { systemScheduler, type IScheduledTask, type IScheduler } from '../scheduler.ts'
import { reportUnhandledError as hostRethrowReporter } from '../host-report.ts'
import type {
  IAbortSignal,
  IUtilsReporter,
  IRetryOptions,
  IRetryContext,
  IRetryFailureContext
} from './promise-contract.ts'
import { observeAbort, reportDiagnostic } from './promise-abort.ts'
import {
  LazyAbortController,
  RetryAttemptContext,
  RetryFailureContext
} from './promise-retry-context.ts'
import { RetryAttemptStart } from './promise-contract.ts'

/** Policy hook a failure is currently waiting on. */
export type IRetryPolicyStep = 'shouldRetry' | 'beforeRetry'

/** Builds the INVALID_ARGUMENT error for one rejected retry option. */
export function invalidRetryOption(
  ErrorType: typeof RangeError | typeof TypeError,
  name: string,
  expected: string
): Error {
  return attachErrorIdentity(new ErrorType(UtilsErrorText.invalidArgument(name, expected)), {
    source: ERROR_SOURCE,
    code: UtilsErrorCode.invalidArgument
  })
}

/** Whether an optional retry duration is absent or a finite non-negative number. */
export function isRetryDuration(value: number | undefined): boolean {
  return value === undefined || (Number.isFinite(value) && value >= 0)
}

/** Listener options of the run-long outside abort listener; shared to avoid one object per run. */
const retryAbortListenerOptions = { once: true } as const

/** Empty signal list of a run without outside signals. */
const noRetrySignals: readonly IAbortSignal[] = Object.freeze([])

/** Copies the outside signals of a retry snapshot; the copy fixes cleanup ownership. */
export function copyRetrySignals(options: IRetryOptions): readonly IAbortSignal[] {
  if (options.signals !== undefined) return [...options.signals]
  return options.signal === undefined ? noRetrySignals : [options.signal]
}

/** Returns the first invalid-option error of a retry snapshot, or undefined when it is valid. */
export function validateRetryOptions(options: IRetryOptions): Error | undefined {
  if (options.signal && options.signals)
    return invalidRetryOption(TypeError, 'signal', 'signal and signals are mutually exclusive')
  if (!Number.isSafeInteger(options.maxAttempts) || options.maxAttempts < 1)
    return invalidRetryOption(
      RangeError,
      'maxAttempts',
      UtilsErrorText.positiveSafeIntegerExpectation
    )
  if (!isRetryDuration(options.totalTimeoutMs))
    return invalidRetryOption(
      RangeError,
      'totalTimeoutMs',
      UtilsErrorText.finiteNonNegativeNumberExpectation
    )
  if (!isRetryDuration(options.attemptTimeoutMs))
    return invalidRetryOption(
      RangeError,
      'attemptTimeoutMs',
      UtilsErrorText.finiteNonNegativeNumberExpectation
    )
  if (options.attemptStart !== undefined && !Object.hasOwn(RetryAttemptStart, options.attemptStart))
    return invalidRetryOption(TypeError, 'attemptStart', 'one of sync, microtask, macrotask')
  return undefined
}

/**
 * One `retry` run: a state machine that owns every resource of the run. The outside signals are
 * listened to once for the whole run, the total deadline is one timer, and each attempt adds only
 * its lazy cancellation owner (plus a timer when `attemptTimeoutMs` is set). Each step runs from
 * the callback of the previous one, so no async function or nested deadline wrapper is involved.
 *
 * Default timing matches the earlier composition: an attempt starts synchronously, except that it
 * waits one microtask when outside signals are attached and no deadline is configured; policy hooks
 * are deferred one microtask when an outside signal or the total deadline is present.
 */
export class RetryRun<T> {
  /** The caller's operation, invoked without a receiver. */
  readonly #operation: (context: IRetryContext) => T | PromiseLike<T>
  /** Options read once at entry. */
  readonly #options: IRetryOptions
  /** Frozen outside signals; listened to for the whole run. */
  readonly #signals: readonly IAbortSignal[]
  /** Destination of late rejections and cleanup failures. */
  readonly #report: IUtilsReporter
  /** Clock and timer owner of every wait of the run. */
  readonly #scheduler: IScheduler
  /** Clock reading at entry when a total budget exists; the budget counts from here. */
  readonly #startedAt: number
  /** True when attempts start one microtask late by default (signals, no deadline). */
  readonly #deferStart: boolean
  /** True when policy hooks start one microtask late (signals or total deadline). */
  readonly #deferPolicy: boolean
  /** Reporter operation of a late attempt rejection: deadline-limited runs keep `withTimeout`. */
  readonly #lateOperation: 'retry' | 'withTimeout'
  /** Signals whose abort listener was installed, removed in reverse order at the end. */
  readonly #admitted: IAbortSignal[] = []
  /** Pending total-deadline timer. */
  #totalTimer: IScheduledTask | undefined
  /** Pending timer of the current attempt deadline, start deferral or backoff. */
  #stepTimer: IScheduledTask | undefined
  /** 1-based number of the current or last attempt. */
  #attempt = 0
  /** Cancellation owner of the current attempt; also the token that identifies it. */
  #controller: LazyAbortController | undefined
  /** True while the current attempt's result is still awaited. */
  #attemptOpen = false
  /** Failure being decided by the policy hooks. */
  #error: unknown
  /** Context shared by the policy hooks of the failure being decided. */
  #failureContext: IRetryFailureContext | undefined
  /** Set once; every later callback becomes inert. */
  #settled = false
  /** Settles the public Promise with a value. */
  #resolve!: (value: T) => void
  /** Settles the public Promise with a failure. */
  #reject!: (reason: unknown) => void
  /** Public Promise of the run. */
  readonly promise: Promise<T>

  /** Captures a validated snapshot and starts the run synchronously. */
  constructor(operation: (context: IRetryContext) => T | PromiseLike<T>, options: IRetryOptions) {
    this.#operation = operation
    this.#options = options
    this.#signals = copyRetrySignals(options)
    this.#report = options.report ?? hostRethrowReporter
    this.#scheduler = options.scheduler ?? systemScheduler
    this.#startedAt = options.totalTimeoutMs === undefined ? 0 : this.#scheduler.now()
    /** Either deadline retains the existing synchronous default attempt-start policy. */
    const deadline = options.totalTimeoutMs !== undefined || options.attemptTimeoutMs !== undefined
    this.#deferStart = this.#signals.length > 0 && !deadline
    this.#deferPolicy = this.#signals.length > 0 || options.totalTimeoutMs !== undefined
    this.#lateOperation = deadline ? PromiseOperation['withTimeout'] : PromiseOperation['retry']
    this.promise = new Promise<T>((resolve, reject) => {
      this.#resolve = resolve
      this.#reject = reject
    })
    this.#start()
  }

  /** Checks the outside signals, admits listeners, arms the total deadline and starts attempt 1. */
  #start(): void {
    /** Observe external cancellation before admitting timers, listeners or user work. */
    const initial = observeAbort(this.#signals)
    if (initial.kind === 'failed') return this.#fail(initial.error)
    if (initial.kind === 'aborted') return this.#fail(new UtilsAbortError(initial.reason))
    /** The total budget is read from the already admitted entry snapshot for this transition. */
    const total = this.#options.totalTimeoutMs
    if (total === 0) return this.#fail(new UtilsTimeoutError(UtilsTimeoutScope.total, 0))
    try {
      for (const signal of this.#signals) {
        // A failed registration may still have installed the listener.
        this.#admitted.push(signal)
        signal.addEventListener('abort', this.#onAbort, retryAbortListenerOptions)
        if (signal.aborted) return this.#onAbort()
      }
      if (total !== undefined) this.#totalTimer = this.#schedule(this.#onTotalTimeout, total)
    } catch (error) {
      return this.#fail(error)
    }
    this.#beginAttempt()
  }

  /** Ends the run when an outside signal is aborted or unreadable; true when it did. */
  #abortedNow(): boolean {
    if (observeAbort(this.#signals).kind === 'none') return false
    this.#onAbort()
    return true
  }

  /** Schedules one timer of this run, applying the unref policy. */
  #schedule(callback: () => void, delayMs: number): IScheduledTask {
    /** This timer receipt receives the caller liveness hint and remains owned by the current run. */
    const task = this.#scheduler.schedule(callback, delayMs)
    if (this.#options.unref) task.unref?.()
    return task
  }

  /** Starts the next attempt at the configured start point. */
  #beginAttempt(): void {
    this.#attempt += 1
    /** The admitted attempt-start policy selects the exact continuation queue for this transition. */
    const start =
      this.#options.attemptStart ??
      (this.#deferStart ? RetryAttemptStart.microtask : RetryAttemptStart.sync)
    if (start === RetryAttemptStart.sync) return this.#runAttempt()
    if (start === RetryAttemptStart.microtask) {
      void Promise.resolve().then(this.#onDeferredStart)
      return
    }
    try {
      this.#stepTimer = this.#schedule(this.#onDeferredStart, 0)
    } catch (error) {
      this.#fail(error)
    }
  }

  /** Runs a deferred attempt unless the run ended or an outside abort landed meanwhile. */
  readonly #onDeferredStart = (): void => {
    this.#stepTimer = undefined
    if (this.#settled || this.#abortedNow()) return
    this.#runAttempt()
  }

  /** Invokes the operation once with a fresh lazy cancellation owner. */
  #runAttempt(): void {
    /** The total budget is read from the already admitted entry snapshot for this transition. */
    const total = this.#options.totalTimeoutMs
    /** Compute the remaining total budget before admitting another attempt. */
    const remainingMs =
      total === undefined ? undefined : total - (this.#scheduler.now() - this.#startedAt)
    if (remainingMs !== undefined && remainingMs <= 0)
      return this.#fail(new UtilsTimeoutError(UtilsTimeoutScope.total, total!))
    /** This cancellation owner remains paired with the exact attempt or operation it started. */
    const controller = new LazyAbortController()
    this.#controller = controller
    this.#attemptOpen = true
    /** One attempt deadline is read from the stable option snapshot before invocation. */
    const attemptTimeoutMs = this.#options.attemptTimeoutMs
    if (attemptTimeoutMs !== undefined) {
      if (attemptTimeoutMs === 0 && this.#options.zeroTimeoutBehavior !== 'start') {
        this.#attemptOpen = false
        return this.#onFailure(new UtilsTimeoutError(UtilsTimeoutScope.attempt, 0))
      }
      try {
        this.#stepTimer = this.#schedule(this.#onAttemptTimeout, attemptTimeoutMs)
      } catch (error) {
        return this.#fail(error)
      }
    }
    /** Adopt this original callback result at the existing continuation boundary. */
    let result: T | PromiseLike<T>
    try {
      result = Reflect.apply(this.#operation, undefined, [
        new RetryAttemptContext(controller, this.#attempt, remainingMs)
      ])
    } catch (error) {
      return this.#onAttemptRejected(controller, error)
    }
    Promise.resolve(result).then(
      (value) => this.#onAttemptFulfilled(controller, value),
      (error: unknown) => this.#onAttemptRejected(controller, error)
    )
  }

  /** Whether `controller` belongs to the attempt whose result is still awaited. */
  #isOpen(controller: LazyAbortController): boolean {
    return !this.#settled && this.#attemptOpen && controller === this.#controller
  }

  /** Ends the current attempt: cancels its deadline timer. */
  #closeAttempt(): void {
    this.#attemptOpen = false
    this.#cancelStepTimer()
  }

  /** Publishes the value of the current attempt; a late value is discarded. */
  #onAttemptFulfilled(controller: LazyAbortController, value: T): void {
    if (!this.#isOpen(controller)) return
    this.#closeAttempt()
    this.#settle()
    this.#resolve(value)
  }

  /** Hands the failure of the current attempt to the policy, or reports a late one. */
  #onAttemptRejected(controller: LazyAbortController, error: unknown): void {
    if (!this.#isOpen(controller)) {
      if (!controller.acknowledges(error))
        reportDiagnostic(this.#report, error, {
          operation: this.#lateOperation,
          phase: PromiseDiagnosticPhase['late-rejection']
        })
      return
    }
    this.#closeAttempt()
    this.#onFailure(error)
  }

  /** Fails the current attempt at its own deadline, cancelling its signal first. */
  readonly #onAttemptTimeout = (): void => {
    this.#stepTimer = undefined
    if (this.#settled || !this.#attemptOpen) return
    this.#attemptOpen = false
    /** This exact boundary failure becomes the public outcome after required cleanup. */
    const error = new UtilsTimeoutError(UtilsTimeoutScope.attempt, this.#options.attemptTimeoutMs!)
    this.#controller!.abort(error)
    this.#onFailure(error)
  }

  /** Ends the run on the last attempt or a total deadline; otherwise asks `shouldRetry`. */
  #onFailure(error: unknown): void {
    if (this.#abortedNow()) return
    if (
      this.#attempt >= this.#options.maxAttempts ||
      (error instanceof UtilsTimeoutError && error.scope === UtilsTimeoutScope.total)
    )
      return this.#fail(error)
    this.#error = error
    this.#failureContext = new RetryFailureContext(
      this.#controller!,
      this.#attempt,
      this.#options.maxAttempts
    )
    this.#runPolicy('shouldRetry')
  }

  /** Calls one policy hook with the current failure. */
  #callPolicy(step: IRetryPolicyStep): unknown {
    return step === 'shouldRetry'
      ? Reflect.apply(this.#options.shouldRetry, undefined, [this.#error, this.#failureContext])
      : Reflect.apply(this.#options.beforeRetry!, undefined, [this.#error, this.#failureContext])
  }

  /** Runs a policy hook now or one microtask later, then continues with its result. */
  #runPolicy(step: IRetryPolicyStep): void {
    /** This cancellation owner remains paired with the exact attempt or operation it started. */
    const controller = this.#controller!
    if (this.#deferPolicy) {
      Promise.resolve()
        .then(() => (this.#settled || this.#abortedNow() ? undefined : this.#callPolicy(step)))
        .then(
          (value) => this.#onPolicyResult(controller, step, value),
          (error: unknown) => this.#onPolicyError(controller, error)
        )
      return
    }
    /** Adopt this original callback result at the existing continuation boundary. */
    let result: unknown
    try {
      result = this.#callPolicy(step)
    } catch (error) {
      return this.#onPolicyError(controller, error)
    }
    Promise.resolve(result).then(
      (value) => this.#onPolicyResult(controller, step, value),
      (error: unknown) => this.#onPolicyError(controller, error)
    )
  }

  /** Ends the run with a policy failure, or reports one that arrives after the run ended. */
  #onPolicyError(controller: LazyAbortController, error: unknown): void {
    if (this.#settled) {
      if (!controller.acknowledges(error))
        reportDiagnostic(this.#report, error, {
          operation: PromiseOperation['retry'],
          phase: PromiseDiagnosticPhase['late-rejection']
        })
      return
    }
    this.#fail(error)
  }

  /** Continues after `shouldRetry` or `beforeRetry` resolved. */
  #onPolicyResult(controller: LazyAbortController, step: IRetryPolicyStep, value: unknown): void {
    if (this.#settled || controller !== this.#controller) return
    if (step === 'shouldRetry') {
      if (!value) return this.#fail(this.#error)
      if (this.#options.beforeRetry !== undefined) return this.#runPolicy('beforeRetry')
    }
    this.#scheduleNext()
  }

  /** Waits for the backoff, if any, then starts the next attempt. */
  #scheduleNext(): void {
    /** The retry delay remains either the admitted scalar or the caller policy function. */
    const option = this.#options.delay
    /** The next wait is admitted only after the policy accepts the current failed attempt. */
    let delay: number
    try {
      delay =
        typeof option === 'function'
          ? Reflect.apply(option, undefined, [this.#error, this.#failureContext])
          : (option ?? 0)
    } catch (error) {
      return this.#fail(error)
    }
    if (!Number.isFinite(delay) || delay < 0)
      return this.#fail(
        invalidRetryOption(RangeError, 'delay', UtilsErrorText.finiteNonNegativeNumberExpectation)
      )
    /** The total budget is read from the already admitted entry snapshot for this transition. */
    const total = this.#options.totalTimeoutMs
    if (total !== undefined && this.#scheduler.now() - this.#startedAt + delay >= total)
      return this.#fail(new UtilsTimeoutError(UtilsTimeoutScope.total, total))
    this.#error = undefined
    this.#failureContext = undefined
    if (delay === 0) return this.#beginAttempt()
    try {
      this.#stepTimer = this.#schedule(this.#onDelayDone, delay)
    } catch (error) {
      this.#fail(error)
    }
  }

  /** Starts the next attempt once the backoff elapsed. */
  readonly #onDelayDone = (): void => {
    this.#stepTimer = undefined
    if (!this.#settled) this.#beginAttempt()
  }

  /** Ends the run at the total deadline, cancelling the current attempt first. */
  readonly #onTotalTimeout = (): void => {
    this.#totalTimer = undefined
    if (this.#settled) return
    /** This exact boundary failure becomes the public outcome after required cleanup. */
    const error = new UtilsTimeoutError(UtilsTimeoutScope.total, this.#options.totalTimeoutMs!)
    this.#controller?.abort(error)
    this.#fail(error)
  }

  /** Ends the run on an outside abort, cancelling the current attempt with the same reason. */
  readonly #onAbort = (): void => {
    if (this.#settled) return
    /** Observe cancellation in the original signal order before releasing owned resources. */
    const observation = observeAbort(this.#signals)
    if (observation.kind === 'failed') return this.#fail(observation.error)
    /** Forward the first observed cancellation reason without rebuilding or replacing it. */
    const reason = observation.kind === 'aborted' ? observation.reason : undefined
    this.#controller?.abort(reason)
    this.#fail(new UtilsAbortError(reason))
  }

  /** Rejects the run after releasing its resources. */
  #fail(error: unknown): void {
    if (this.#settled) return
    this.#settle()
    this.#reject(error)
  }

  /** Cancels the pending step timer, reporting a failing cancel. */
  #cancelStepTimer(): void {
    /** Detach the timer receipt before its cancellation can report or reenter. */
    const timer = this.#stepTimer
    this.#stepTimer = undefined
    try {
      timer?.cancel()
    } catch (error) {
      reportDiagnostic(this.#report, error, {
        operation: PromiseOperation['retry'],
        phase: PromiseDiagnosticPhase['cleanup']
      })
    }
  }

  /** Marks the run settled and releases timers and listeners; failures are reported. */
  #settle(): void {
    this.#settled = true
    this.#cancelStepTimer()
    /** Detach the total timer receipt before its cancellation can reenter. */
    const total = this.#totalTimer
    this.#totalTimer = undefined
    try {
      total?.cancel()
    } catch (error) {
      reportDiagnostic(this.#report, error, {
        operation: PromiseOperation['retry'],
        phase: PromiseDiagnosticPhase['cleanup']
      })
    }
    for (const signal of this.#admitted.reverse())
      try {
        signal.removeEventListener('abort', this.#onAbort)
      } catch (error) {
        reportDiagnostic(this.#report, error, {
          operation: PromiseOperation['retry'],
          phase: PromiseDiagnosticPhase['cleanup']
        })
      }
    this.#admitted.length = 0
    this.#error = undefined
    this.#failureContext = undefined
  }
}
