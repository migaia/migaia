import { systemScheduler, type ILifecycleScheduler, type IScheduledTask } from './scheduler.js';

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
  // Observe `task` unconditionally, before the deadline check below can return early. If the
  // deadline has already elapsed by the time this is called, returning `false` without ever
  // touching `task` would let a `task` that later rejects surface as a genuine unhandled rejection
  // instead of being contained here. This extra handler only marks the promise as handled; it never
  // swallows the rejection seen by the real race below (`LG-R5-3`).
  const observedTask = Promise.resolve(task);
  void observedTask.catch(() => undefined);

  const scheduler = options?.scheduler ?? systemScheduler;
  const remainingMs = deadlineAt - scheduler.now();
  if (remainingMs <= 0) return false;
  let timer: IScheduledTask | undefined;
  const timeout = new Promise<false>((resolve) => {
    timer = scheduler.schedule(() => resolve(false), remainingMs);
  });
  try {
    return await Promise.race([observedTask.then(() => true), timeout]);
  } finally {
    // The deadline timer must be cleared whenever the tracked task wins the race — otherwise it
    // keeps a timer slot alive for up to the full remaining budget on every successful bounded
    // wait, accumulating dangling timers on any code path that calls this at high frequency
    // (`LG-R5-2`).
    timer?.cancel();
  }
};
