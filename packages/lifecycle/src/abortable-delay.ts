import type { IAbortSignal } from '@migaia/utils/promise'
import type { IScheduledTask, IScheduler } from '@migaia/utils/scheduler'
import { attachLifecycleSecondaryErrors } from './error-boundary.ts'
import { LifecycleErrorCode } from './error-code.ts'
import { LifecycleErrorText } from './error-text.ts'
import { createLifecycleFailure, createLifecycleTypeError } from './errors.ts'
import {
  observeAbortSubscription,
  type IObservedAbortSubscription
} from './observed-subscription.ts'
import { safeReport } from './errors.ts'
import { validateSchedulerDelay } from './scheduler.ts'

/** Package-private callback admission shared by duration and deadline waits. */
export function captureCleanupReporter(value: unknown): ((error: unknown) => void) | undefined {
  if (value === undefined || typeof value === 'function')
    return value as ((error: unknown) => void) | undefined
  throw createLifecycleTypeError(
    LifecycleErrorCode.invalidOption,
    LifecycleErrorText.waitCleanupReporterInvalid
  )
}

/**
 * Resolves true when the duration elapses and false when an abort event wins, even if the host
 * updates signal.aborted later. Invalid arguments fail before admission. The owner keeps its domain
 * cancellation policy. Registration/scheduling must finish before a synchronous host callback can
 * settle, so an admission throw remains primary. The returned task is cancelled at most once.
 * Cleanup failures reject unless reportCleanup observes them; a primary admission failure still
 * rejects with cleanup failures attached and the original error reachable.
 */
export function abortableDelay(
  scheduler: IScheduler,
  ms: number,
  signal: IAbortSignal | undefined,
  reportCleanup?: (error: unknown) => void
): Promise<boolean> {
  validateSchedulerDelay(ms, 'delayMs')
  /** Reporter admission is shared with the deadline wait instead of duplicated at each caller. */
  const cleanupReporter = captureCleanupReporter(reportCleanup)
  return new Promise<boolean>((resolve, reject) => {
    /** Task admitted by the scheduler, including one returned after a synchronous callback. */
    let task: IScheduledTask | undefined
    /** Canonical abort registration owns listener cleanup and partial-registration recovery. */
    let subscription: IObservedAbortSubscription | undefined
    /** Settlement waits for both host registration and schedule() to finish. */
    let admissionComplete = false
    /** Timer or abort requested completion before or after admission finished. */
    let completionRequested = false
    /** Abort event delivery is authoritative even when a structural signal updates its flag late. */
    let aborted = false
    /** Prevents callbacks and cleanup from settling the same wait twice. */
    let settled = false
    /** Distinguishes a thrown undefined from the absence of an admission failure. */
    let hasPrimary = false
    /** Original registration or scheduling failure, retained independently of cleanup. */
    let primary: unknown
    /** Ensures a synchronous callback cannot trigger two cancellations of a returned task. */
    let cancelAttempted = false
    /** Raw cleanup failures remain ordered and keep their original identities. */
    const cleanupErrors: unknown[] = []

    /** Settles only after all owned handles are visible and cleaned up. */
    const finish = (): void => {
      if (settled || !admissionComplete || (!completionRequested && !hasPrimary)) return
      settled = true
      if (task && !cancelAttempted) {
        cancelAttempted = true
        try {
          task.cancel()
        } catch (error) {
          cleanupErrors.push(error)
        }
      }
      subscription?.unsubscribe()
      if (cleanupReporter) {
        for (const error of cleanupErrors)
          safeReport(
            cleanupReporter,
            createLifecycleFailure(
              LifecycleErrorCode.delayFailed,
              LifecycleErrorText.delayFailed,
              error
            )
          )
      }
      if (hasPrimary || (!cleanupReporter && cleanupErrors.length > 0)) {
        /** The admission error wins; otherwise the first cleanup error becomes primary. */
        const failure = createLifecycleFailure(
          LifecycleErrorCode.delayFailed,
          LifecycleErrorText.delayFailed,
          hasPrimary ? primary : cleanupErrors[0]
        )
        reject(
          attachLifecycleSecondaryErrors(
            failure,
            hasPrimary ? cleanupErrors : cleanupErrors.slice(1),
            LifecycleErrorText.delayFailed,
            LifecycleErrorCode.delayFailed
          )
        )
        return
      }
      resolve(!aborted)
    }

    /** Marks timer/abort completion without losing a subsequent admission failure. */
    const complete = (): void => {
      completionRequested = true
      finish()
    }

    try {
      if (signal?.aborted) aborted = completionRequested = true
      else if (signal) {
        subscription = observeAbortSubscription(
          signal,
          () => {
            if (settled) return
            aborted = true
            complete()
          },
          (error) => cleanupErrors.push(error)
        )
        subscription.retryRegistrationCleanup()
      }
      if (!completionRequested) task = scheduler.schedule(complete, ms)
      if (signal?.aborted) aborted = completionRequested = true
    } catch (error) {
      hasPrimary = true
      primary = error
    }
    admissionComplete = true
    finish()
  })
}
