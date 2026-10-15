import { defaultLifecycleScheduler } from './default-scheduler.js'
import { captureCleanupReporter } from './abortable-delay.js'
import { safeReport } from './report-boundary.js'
import { tryReadProperty } from '@migaia/utils/error'
import { createLifecycleTypeError } from './errors.js'
import { LifecycleErrorCode } from './error-code.js'
import { LifecycleErrorText } from './error-text.js'
import type { IScheduler } from '@migaia/utils/scheduler'
import {
  resolveSchedulerOption,
  validateSchedulerDelay,
  validateSchedulerTime
} from './scheduler.js'

/**
 * Waits for one awaitable until an existing absolute deadline, without cancelling it.
 *
 * Ported from `@migaia/logger`'s `bounded-wait.ts` (`LG-R5-1/2/3`), generalized off any
 * logger-specific naming. Default behavior is unchanged: it never cancels the task, it always
 * observes the task even when the deadline has already passed, and it always clears its own timer.
 * The deadline clock and timer come from the injected scheduler (default `systemScheduler`), never
 * raw host globals. Cleanup failures reject by default; reportCleanup keeps them diagnostic without
 * replacing the task/deadline winner.
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
  // swallows the rejection seen by the real race below (`LG-R5-3`).
  const observedTask = Promise.resolve(task)
  void observedTask.catch(() => undefined)
  const remainingMs = deadlineAt - scheduler.now()
  if (remainingMs < 0) return false
  const delayMs = validateSchedulerDelay(Math.max(0, remainingMs), 'deadline delay')
  return new Promise<boolean>((resolve, reject) => {
    let settled = false
    let timer: { cancel(): void } | undefined
    const settle = (outcome: () => void): void => {
      if (settled) return
      settled = true
      try {
        timer?.cancel()
      } catch (error) {
        if (reportCleanup) safeReport(reportCleanup, error)
        else {
          reject(error)
          return
        }
      }
      outcome()
    }
    try {
      timer = scheduler.schedule(() => settle(() => resolve(false)), delayMs)
    } catch (error) {
      reject(error)
      return
    }
    if (settled) {
      try {
        timer.cancel()
      } catch (error) {
        if (reportCleanup) safeReport(reportCleanup, error)
        else reject(error)
      }
    }
    void observedTask.then(
      () => settle(() => resolve(true)),
      (error: unknown) => {
        // A rejection after the timeout is deliberately consumed by this handler. Before the
        // timeout it remains the caller's primary failure, without relying on an error class from
        // another package or bundle to identify the timer winner.
        settle(() => reject(error))
      }
    )
  })
}
