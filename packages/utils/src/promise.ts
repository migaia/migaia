/** Own Promise completion, retry and concurrency primitives together with their native cleanup. */
import { UtilsTimeoutScope } from './internal/error-primitives.ts'

import type {
  IAbortSignal,
  INativeAbortSignal,
  IAbortSignalAdmission,
  IDeferred,
  IAsyncControls,
  IRetryContext,
  IUtilsReporter,
  ITimeoutOperation,
  IDeadlineOnlyOperation,
  IAbortTimeoutSignalOptions,
  IAbortTimeoutSignal,
  IAbortOperation,
  IConcurrencyLimiter,
  IRetryOptions
} from './internal/promise-contract.ts'
export type {
  IAbortSignal,
  INativeAbortSignal,
  IAbortSignalRejection,
  IAbortSignalAdmission,
  IDeferred,
  IAsyncControls,
  IRetryContext,
  IRetryFailureContext,
  IUtilsReporter,
  ITimeoutOperation,
  IDeadlineOnlyOperation,
  IAbortTimeoutSignalOptions,
  IAbortTimeoutSignal,
  IAbortOperation,
  IConcurrencyLimiter,
  IRetryOptions
} from './internal/promise-contract.ts'

export { RetryAttemptStart } from './internal/promise-contract.ts'

import { ERROR_SOURCE, UtilsErrorCode } from './error-code.ts'
import { UtilsErrorText } from './error-text.ts'
import { attachErrorIdentity } from './error.ts'
import { systemScheduler } from './scheduler.ts'
import { reportUnhandledError } from './host-report.ts'

import { snapshotSignals } from './internal/promise-abort.ts'
import { AbortTimeoutSignal } from './internal/promise-abort-timeout.ts'
import { SleepOperation } from './internal/promise-sleep.ts'
import { TimeoutOperation } from './internal/promise-timeout.ts'
import { AbortRaceOperation } from './internal/promise-race.ts'
import { RetryRun, validateRetryOptions } from './internal/promise-retry.ts'
import { ConcurrencyLimiter } from './internal/promise-limiter.ts'

export { UtilsAbortError } from './error.ts'

/**
 * Admits an abort signal shape through one `aborted` read without probing `reason` or subscribing.
 * Getter and proxy failures remain data so the owning caller can apply its own error policy.
 */
export function admitAbortSignal(candidate: unknown): IAbortSignalAdmission {
  if (candidate === null || (typeof candidate !== 'object' && typeof candidate !== 'function'))
    return { kind: 'invalid', reason: 'not-object' }
  try {
    if (Array.isArray(candidate)) return { kind: 'invalid', reason: 'not-object' }
  } catch (cause) {
    return { kind: 'invalid', reason: 'not-object', cause }
  }
  /** Structural candidate is safe to type after its object-or-function and array admission checks. */
  const signal = candidate as IAbortSignal
  /** Captures the only `aborted` observation so mutable getters cannot be reread by this helper. */
  let aborted: unknown
  try {
    aborted = signal.aborted
  } catch (cause) {
    return { kind: 'invalid', reason: 'aborted-threw', cause }
  }
  if (typeof aborted !== 'boolean') return { kind: 'invalid', reason: 'aborted-not-boolean' }
  /** Listener methods are read together so either hostile accessor has one classified outcome. */
  let addEventListener: unknown
  /** Counterpart cleanup method must exist before callers can safely own an admitted signal. */
  let removeEventListener: unknown
  try {
    addEventListener = signal.addEventListener
    removeEventListener = signal.removeEventListener
  } catch (cause) {
    return { kind: 'invalid', reason: 'listener-not-function', cause }
  }
  if (typeof addEventListener !== 'function' || typeof removeEventListener !== 'function')
    return { kind: 'invalid', reason: 'listener-not-function' }
  return { kind: 'valid', signal, aborted }
}

/** Reports a diagnostic to the host without creating an unhandled rejected Promise. */
export const hostRethrowReporter: IUtilsReporter = reportUnhandledError

/** Creates the canonical merged signal used by adapters that need timeout plus external abort. */
export function createAbortTimeoutSignal(
  options: IAbortTimeoutSignalOptions = {}
): IAbortTimeoutSignal {
  /** Preserve boundary option read order, including the no-timeout fast path. */
  const timeoutMs = options.timeoutMs
  /** External cancellation may be returned directly when no timeout was requested. */
  const externalSignal = options.signal
  /** Cleanup diagnostics remain caller-owned. */
  const report = options.report ?? hostRethrowReporter
  if (timeoutMs === undefined) return { signal: externalSignal, dispose: () => undefined }
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0)
    throw attachErrorIdentity(
      new RangeError(
        UtilsErrorText.invalidArgument(
          'timeoutMs',
          UtilsErrorText.finiteNonNegativeNumberExpectation
        )
      ),
      { source: ERROR_SOURCE, code: UtilsErrorCode.invalidArgument }
    )
  return new AbortTimeoutSignal(timeoutMs, externalSignal, report, options)
}

/** Creates a native Promise deferred without exposing mutable settlement state. */
export function deferred<T>(): IDeferred<T> {
  /** Capture the native resolver that belongs to this one public Promise. */
  let resolve!: (value: T | PromiseLike<T>) => void
  /** Capture the native rejection path without replacing caller-supplied reasons. */
  let reject!: (reason?: unknown) => void
  /** The public receipt and its native settlement functions are created together. */
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, resolve, reject }
}

/**
 * Runs one synchronous computation immediately while normalizing its value or thrown reason to a
 * native Promise settlement.
 */
export function toPromise<T>(run: () => T): Promise<Awaited<T>> {
  try {
    return Promise.resolve(run())
  } catch (error) {
    return Promise.reject(error)
  }
}

/**
 * Waits `delayMs` on the scheduler. Rejects with `UtilsAbortError` when a given signal aborts while
 * waiting, and with `INVALID_ARGUMENT` for a negative or non-finite delay. Timer and listener
 * cleanup always runs; cleanup failures go to `hostRethrowReporter`.
 */
export function sleep(delayMs: number, options?: IAsyncControls): Promise<void> {
  /** Read the scheduler option before cancellation options to preserve entry getter order. */
  const schedulerOption = options?.scheduler
  /** Capture the original external cancellation capability before resource admission. */
  const signal = options?.signal
  /** Read the ordered external signal set once before taking ownership of its listeners. */
  const signalsOption = options?.signals
  /** Capture the caller liveness hint before any timer is acquired. */
  const unref = options?.unref
  /** The admitted clock and timer owner remains stable for the whole operation. */
  const scheduler = schedulerOption ?? systemScheduler
  if (!Number.isFinite(delayMs) || delayMs < 0)
    return Promise.reject(
      attachErrorIdentity(
        new RangeError(
          UtilsErrorText.invalidArgument(
            'delayMs',
            UtilsErrorText.finiteNonNegativeNumberExpectation
          )
        ),
        { source: ERROR_SOURCE, code: UtilsErrorCode.invalidArgument }
      )
    )
  if (signal && signalsOption)
    return Promise.reject(
      attachErrorIdentity(
        new TypeError(
          UtilsErrorText.invalidArgument('signal', 'signal and signals are mutually exclusive')
        ),
        { source: ERROR_SOURCE, code: UtilsErrorCode.invalidArgument }
      )
    )
  /** Snapshot external identities once so reentrancy cannot redirect cleanup ownership. */
  const signals = snapshotSignals(signalsOption, signal)
  return new SleepOperation(delayMs, scheduler, signals, unref).promise
}

type IWithTimeoutOptions = IAsyncControls & {
  readonly timeoutMs: number
  readonly report?: IUtilsReporter
  readonly zeroTimeoutBehavior?: 'skip' | 'start'
  /** Disables internal cancellation allocation for deadline-only operations. */
  readonly cooperativeCancellation?: boolean
}

/**
 * Runs a lazy operation with a deadline. With cooperative cancellation on (the default) the
 * operation receives the host `AbortSignal` of an internal controller; at the deadline that signal
 * aborts first and the call then rejects with `UtilsTimeoutError` (`DEADLINE_EXCEEDED`, scope
 * `operation`). An outside abort rejects with `UtilsAbortError`. When cooperative cancellation is
 * off, the operation receives a structural never-aborting signal instead.
 *
 * After settling, a late success is discarded and a late rejection goes to `report`, except a
 * rejection with the `reason` of the operation's own signal, which only acknowledges the
 * cancellation (as `fetch(url, { signal })` does). Cleanup failures reject the call, aggregated
 * with any primary error.
 */
export function withTimeout<T>(
  operation: ITimeoutOperation<T>,
  options: IWithTimeoutOptions & { readonly cooperativeCancellation?: true }
): Promise<T>

export function withTimeout<T>(
  operation: IDeadlineOnlyOperation<T>,
  options: IWithTimeoutOptions
): Promise<T>

export function withTimeout<T>(
  operation: ITimeoutOperation<T>,
  options: IWithTimeoutOptions
): Promise<T> {
  /** Read the deadline once before observing cancellation or starting cooperative work. */
  const timeoutMs = options.timeoutMs
  /** Capture the original external cancellation capability before resource admission. */
  const signal = options.signal
  /** Read the ordered external signal set once before taking ownership of its listeners. */
  const signalsOption = options.signals
  /** Capture the diagnostic destination in the original entry getter order. */
  const reportOption = options.report
  /** The zero-deadline policy decides whether the original callback is allowed to start. */
  const zeroTimeoutBehavior = options.zeroTimeoutBehavior
  /** The admitted cancellation policy controls whether a native controller is allocated. */
  const cooperativeCancellation = options.cooperativeCancellation ?? true
  /** The admitted clock and timer owner remains stable for the whole operation. */
  const scheduler = options.scheduler ?? systemScheduler
  /** Capture the caller liveness hint before any timer is acquired. */
  const unref = options.unref
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0)
    return Promise.reject(
      attachErrorIdentity(
        new RangeError(
          UtilsErrorText.invalidArgument(
            'timeoutMs',
            UtilsErrorText.finiteNonNegativeNumberExpectation
          )
        ),
        { source: ERROR_SOURCE, code: UtilsErrorCode.invalidArgument }
      )
    )
  if (signal && signalsOption)
    return Promise.reject(
      attachErrorIdentity(
        new TypeError(
          UtilsErrorText.invalidArgument('signal', 'signal and signals are mutually exclusive')
        ),
        { source: ERROR_SOURCE, code: UtilsErrorCode.invalidArgument }
      )
    )
  /** Snapshot external identities once so reentrancy cannot redirect cleanup ownership. */
  const signals = snapshotSignals(signalsOption, signal)
  /** The captured reporter owns secondary failures without changing the public settlement. */
  const report = reportOption ?? hostRethrowReporter
  /** This cancellation owner remains paired with the exact attempt or operation it started. */
  const controller = cooperativeCancellation ? new AbortController() : undefined
  /** The callback receives this stable admitted signal identity on its original invocation. */
  const operationSignal = controller?.signal
  return new TimeoutOperation<T>(
    operation,
    signals,
    report,
    controller,
    UtilsTimeoutScope.operation,
    operationSignal,
    timeoutMs,
    zeroTimeoutBehavior,
    scheduler,
    unref
  ).promise
}

/**
 * Races a lazy operation against one or more outside abort signals without creating a timer. An
 * abort rejects with `UtilsAbortError` and aborts the operation's own signal; late rejections other
 * than that signal's `reason` go to `report`.
 */
export function raceWithAbort<T>(
  operation: IAbortOperation<T>,
  options: Pick<IAsyncControls, 'signal' | 'signals'> & {
    readonly report?: IUtilsReporter
    readonly cleanupPolicy?: 'reject' | 'report'
  } = {}
): Promise<T> {
  /** Capture the original external cancellation capability before resource admission. */
  const signal = options.signal
  /** Read the ordered external signal set once before taking ownership of its listeners. */
  const signalsOption = options.signals
  /** Capture the diagnostic destination in the original entry getter order. */
  const reportOption = options.report
  /** The caller chooses whether secondary listener failures reject or are reported. */
  const cleanupPolicy = options.cleanupPolicy ?? 'reject'
  if (signal && signalsOption)
    return Promise.reject(
      attachErrorIdentity(
        new TypeError(
          UtilsErrorText.invalidArgument('signal', 'signal and signals are mutually exclusive')
        ),
        { source: ERROR_SOURCE, code: UtilsErrorCode.invalidArgument }
      )
    )
  /** Snapshot external identities once so reentrancy cannot redirect cleanup ownership. */
  const signals = snapshotSignals(signalsOption, signal)
  /** The captured reporter owns secondary failures without changing the public settlement. */
  const report = reportOption ?? hostRethrowReporter
  /** This cancellation owner remains paired with the exact attempt or operation it started. */
  const controller = new AbortController()
  /** The callback receives this stable admitted signal identity on its original invocation. */
  const operationSignal = controller.signal as unknown as INativeAbortSignal
  return new AbortRaceOperation<T>(
    operation,
    signals,
    report,
    cleanupPolicy,
    controller,
    operationSignal
  ).promise
}

/**
 * Retries an operation serially. Each failure asks `shouldRetry`; `false` or the last of
 * `maxAttempts` throws that original error unchanged. `delay` sets the wait between attempts,
 * `attemptTimeoutMs` limits each attempt and `totalTimeoutMs` limits the whole run, waits included
 * (`UtilsTimeoutError` with scope `attempt` / `total`). An outside abort ends the run with
 * `UtilsAbortError`. `beforeRetry` is awaited between an accepted failure and `delay`;
 * `attemptStart` chooses when each attempt starts (`RetryAttemptStart`). Each attempt's `signal` is
 * created only when read. Invalid options reject with `INVALID_ARGUMENT`; cleanup failures and late
 * rejections go to `report`.
 */
export function retry<T>(
  operation: (context: IRetryContext) => T | PromiseLike<T>,
  options: IRetryOptions
): Promise<T> {
  /** Read enumerable retry options once before validating or starting an attempt. */
  const snapshot = { ...options }
  /** Preserve the first rejected-option error before acquiring any attempt resources. */
  const invalid = validateRetryOptions(snapshot)
  if (invalid !== undefined) return Promise.reject(invalid)
  return new RetryRun(operation, snapshot).promise
}

/**
 * Creates a queue that runs at most `concurrency` tasks at once and starts the rest in submission
 * order. A queued task whose `run` signal aborts rejects with the abort reason and never starts; a
 * running task only sees the cancellation on its `context.signal`. Throws `INVALID_ARGUMENT`
 * (`RangeError`) when `concurrency` is not a positive safe integer.
 */
export function createConcurrencyLimiter(options: {
  readonly concurrency: number
  readonly report?: IUtilsReporter
}): IConcurrencyLimiter {
  return new ConcurrencyLimiter(options)
}
