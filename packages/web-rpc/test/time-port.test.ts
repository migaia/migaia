import { describe, expect, it, vi } from 'vitest'
import { createEndpointTimePort } from '../src/internal/time-port.js'

describe('endpoint-local time port', () => {
  it('tracks timers and clears them on disposal without mutating the port', () => {
    vi.useFakeTimers()
    try {
      const port = createEndpointTimePort()
      const task = vi.fn()
      const timer = port.setTimeout(task, 10)
      expect(Object.isFrozen(port)).toBe(true)
      port.clearTimeout(timer)
      vi.advanceTimersByTime(10)
      expect(task).not.toHaveBeenCalled()

      const lateTask = vi.fn()
      port.setTimeout(lateTask, 10)
      port.dispose()
      vi.advanceTimersByTime(10)
      expect(lateTask).not.toHaveBeenCalled()
      port.dispose()
    } finally {
      vi.useRealTimers()
    }
  })
})
