/** Original timer callback non-execution follows the canonical scheduler and timeout owner. */
import { systemScheduler } from '@migaia/utils/scheduler'
import { createAbortTimeoutSignal } from '@migaia/utils/promise'
import { describe, expect, it, vi } from 'vitest'

describe('canonical endpoint timer resources', () => {
  it('tracks timers and clears them on disposal without mutating the port', () => {
    vi.useFakeTimers()
    try {
      /** Explicit cancellation belongs to the actual shared scheduler's original task receipt. */
      const task = vi.fn()
      /** The former endpoint port delegated this exact deadline callback to this scheduler. */
      const timer = systemScheduler.schedule(task, 10)
      timer.cancel()
      vi.advanceTimersByTime(10)
      expect(task).not.toHaveBeenCalled()

      /** Deadline reason creation is the actual timeout owner's callback at physical expiry. */
      const lateTask = vi.fn()
      /** TimeoutAttempt now borrows this canonical one-timer owner instead of endpoint-local ports. */
      const port = createAbortTimeoutSignal({
        timeoutMs: 10,
        timeoutReason: lateTask,
        scheduler: systemScheduler
      })
      port.dispose()
      vi.advanceTimersByTime(10)
      expect(lateTask).not.toHaveBeenCalled()
      port.dispose()
    } finally {
      vi.useRealTimers()
    }
  })
})
