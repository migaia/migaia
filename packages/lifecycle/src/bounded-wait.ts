import { defaultLifecycleScheduler } from './scheduler.js'
import { captureCleanupReporter } from './abortable-delay.js'
import { safeReport } from './errors.js'
import { tryReadProperty } from '@migaia/utils/error'
import { createLifecycleTypeError } from './errors.js'
import { LifecycleErrorCode } from './error-code.js'
import { LifecycleErrorText } from './error-text.js'
import { attachLifecycleSecondaryErrors } from './error-boundary.js'
import type { IScheduler } from '@migaia/utils/scheduler'
import {
  resolveSchedulerOption,
  validateSchedulerDelay,
  validateSchedulerTime
} from './scheduler.js'

/**
 * Waits for one awaitable until an absolute deadline, without cancelling it; typically used so a
 * shutdown step waits for work in flight but never hangs on it.
 *
 * Resolves `true` when the task settles first and `false` when the deadline comes first (the task
 * keeps running). `deadlineAt` is a time on the scheduler's clock (`performance.now()` for the
 * default `systemScheduler`), not `Date.now()`. The task is always observed, even when the deadline
 * has already passed, so a later rejection is never unhandled, and the timer is always cleared.
 * Cleanup failures reject by default; `reportCleanup` keeps them diagnostic without replacing the
 * task/deadline winner.
 */
export const boundedWait = async (
  task: PromiseLike<unknown>,
  deadlineAt: number,
  options?: { scheduler?: IScheduler; reportCleanup?: (error: unknown) => void }
): Promise<boolean> => {
  const scheduler = resolveSchedulerOption(options, defaultLifecycleScheduler)
  /** Capture the optional callback once without allowing its getter failure to escape uncoded. */
  const reportRead = options === undefined ? undefined : tryReadProperty(options, 'reportCleanup')
  if (reportRead?.threw)
    throw createLifecycleTypeError(
      LifecycleErrorCode.invalidOption,
      LifecycleErrorText.waitCleanupReporterInvalid,
      { cause: reportRead.error }
    )
  /** An owner may observe cleanup without replacing the task/deadline winner. */
  const reportCleanup = captureCleanupReporter(reportRead?.value)
  validateSchedulerTime(deadlineAt, 'deadlineAt')
  // Observe `task` unconditionally, before the deadline check below can return early. If the
  // deadline has already elapsed by the time this is called, returning `false` without ever
  // touching `task` would let a `task` that later rejects surface as a genuine unhandled rejection
  // instead of being contained here. This extra handler only marks the promise as handled; it never
  // swallows the rejection seen by the real race below.
  const observedTask = Promise.resolve(task)
  void observedTask.catch(() => undefined)
  const remainingMs = deadlineAt - scheduler.now()
  if (remainingMs < 0) return false
  const delayMs = validateSchedulerDelay(Math.max(0, remainingMs), 'deadline delay')
  return new Promise<boolean>((resolve, reject) => {
    let settled = false
    let timer: { cancel(): void } | undefined
    /** Scheduling can synchronously request completion before returning its cleanup handle. */
    let admitted = false
    /** The first timer/task outcome waits until all owned cleanup handles are visible. */
    let outcome: (() => void) | undefined
    /** Task rejection presence is separate from its payload, which may be undefined. */
    let taskFailed = false
    /** Preserve the task primary independently from any cancellation failure. */
    let primaryError: unknown
    /** Finalize the selected outcome after schedule admission, cancelling the timer exactly once. */
    const finish = (): void => {
      if (settled || !admitted || outcome === undefined) return
      settled = true
      try {
        timer?.cancel()
      } catch (error) {
        if (reportCleanup) safeReport(reportCleanup, error)
        else {
          reject(
            taskFailed
              ? attachLifecycleSecondaryErrors(
                  primaryError,
                  [error],
                  LifecycleErrorText.delayFailed
                )
              : error
          )
          return
        }
      }
      outcome()
    }
    /** Select one winner while retaining task failure identity for secondary cleanup attachment. */
    const settle = (next: () => void, failed = false, error?: unknown): void => {
      if (settled || outcome !== undefined) return
      outcome = next
      taskFailed = failed
      primaryError = error
      finish()
    }
    try {
      timer = scheduler.schedule(() => settle(() => resolve(false)), delayMs)
    } catch (error) {
      reject(error)
      return
    }
    admitted = true
    finish()
    void observedTask.then(
      () => settle(() => resolve(true)),
      (error: unknown) => {
        // A rejection after the timeout is deliberately consumed by this handler. Before the
        // timeout it remains the caller's primary failure, without relying on an error class from
        // another package or bundle to identify the timer winner.
        settle(() => reject(error), true, error)
      }
    )
  })
}
