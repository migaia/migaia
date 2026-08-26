import {
  resolveSchedulerOption,
  systemScheduler,
  validateSchedulerDelay,
  validateSchedulerTime,
  type ILifecycleScheduler
} from './scheduler.js'
import { withTimeout } from '@migaia/utils/promise'
import { UtilsTimeoutError } from '@migaia/utils/error'

/**
 * Waits for one awaitable until an existing absolute deadline, without cancelling it.
 *
 * Ported from `@migaia/logger`'s `bounded-wait.ts` (`LG-R5-1/2/3`), generalized off any
 * logger-specific naming. Behavior is unchanged: it never cancels the task, it always observes the
 * task even when the deadline has already passed, and it always clears its own timer. The deadline
 * clock and timer come from the injected scheduler (default `systemScheduler`), never raw host
 * globals.
 */
export const boundedWait = async (
  task: PromiseLike<unknown>,
  deadlineAt: number,
  options?: { scheduler?: ILifecycleScheduler }
): Promise<boolean> => {
  const scheduler = resolveSchedulerOption(options, systemScheduler)
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
  try {
    return await withTimeout(() => observedTask.then(() => true), {
      timeoutMs: delayMs,
      scheduler,
      zeroTimeoutBehavior: 'start',
      cooperativeCancellation: false
    })
  } catch (error) {
    if (error instanceof UtilsTimeoutError) return false
    throw error
  }
}
