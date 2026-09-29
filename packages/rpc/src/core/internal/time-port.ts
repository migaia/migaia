import { reportEndpointTimePortEvent } from './test-observer.js'
import {
  systemWallClock,
  type IScheduledTask,
  type IScheduler,
  type IWallClock
} from '@migaia/utils/scheduler'

/** Idempotently clearable timer owned by one endpoint-local time port. */
export type IEndpointTimer = {
  readonly clear: () => void
}

/** Immutable clock and timer capability shared by every attachment in one endpoint. */
export type IEndpointTimePort = {
  readonly scheduler: IScheduler
  /** Monotonic endpoint time for deadlines, TTLs, expiry and replay windows. */
  readonly now: () => number
  /** Epoch milliseconds from the endpoint wall clock; only for wire `sentAt` and hook event `at`. */
  readonly timestamp: () => number
  readonly setTimeout: (task: () => void, delayMs: number) => IEndpointTimer
  readonly clearTimeout: (timer: IEndpointTimer) => void
  readonly dispose: () => void
}

/**
 * Creates one endpoint-local time port and tracks every timer until clear or disposal. `scheduler`
 * drives every duration and timer; `wallClock` only produces diagnostic timestamps and defaults to
 * the host wall clock.
 */
export function createEndpointTimePort(
  scheduler: IScheduler,
  wallClock: IWallClock = systemWallClock
): IEndpointTimePort {
  const timers = new Set<IScheduledTask>()
  let disposed = false

  const port: IEndpointTimePort = {
    scheduler,
    now: () => {
      const value = scheduler.now()
      reportEndpointTimePortEvent(port, { kind: 'now', value })
      return value
    },
    timestamp: () => wallClock.timestamp(),
    setTimeout: (task, delayMs) => {
      if (disposed) return { clear: () => undefined }
      let handle: IScheduledTask | undefined
      let cleared = false
      const clear = (): void => {
        if (cleared) return
        cleared = true
        if (handle !== undefined) {
          timers.delete(handle)
          handle.cancel()
        }
      }
      handle = scheduler.schedule(() => {
        if (cleared) return
        cleared = true
        timers.delete(handle!)
        task()
      }, delayMs)
      handle.unref?.()
      timers.add(handle)
      const timer = { clear }
      reportEndpointTimePortEvent(port, { kind: 'setTimeout', delayMs, timer })
      return timer
    },
    clearTimeout: (timer) => {
      reportEndpointTimePortEvent(port, { kind: 'clearTimeout', timer })
      timer.clear()
    },
    dispose: () => {
      if (disposed) return
      disposed = true
      for (const handle of timers) handle.cancel()
      timers.clear()
    }
  }
  return Object.freeze(port)
}
