import { reportEndpointTimePortEvent } from './test-observer.js'

/** Idempotently clearable timer owned by one endpoint-local time port. */
export type IEndpointTimer = {
  readonly clear: () => void
}

/** Immutable clock and timer capability shared by every attachment in one endpoint. */
export type IEndpointTimePort = {
  readonly now: () => number
  readonly setTimeout: (task: () => void, delayMs: number) => IEndpointTimer
  readonly clearTimeout: (timer: IEndpointTimer) => void
  readonly dispose: () => void
}

/** Creates one endpoint-local time port and tracks every timer until clear or disposal. */
export function createEndpointTimePort(): IEndpointTimePort {
  const timers = new Set<ReturnType<typeof setTimeout>>()
  const hostNow = Date.now
  const hostSetTimeout = setTimeout
  const hostClearTimeout = clearTimeout
  let disposed = false

  const port: IEndpointTimePort = {
    now: () => {
      const value = hostNow()
      reportEndpointTimePortEvent(port, { kind: 'now', value })
      return value
    },
    setTimeout: (task, delayMs) => {
      if (disposed) return { clear: () => undefined }
      let handle: ReturnType<typeof setTimeout> | undefined
      let cleared = false
      const clear = (): void => {
        if (cleared) return
        cleared = true
        if (handle !== undefined) {
          timers.delete(handle)
          hostClearTimeout(handle)
        }
      }
      handle = hostSetTimeout(() => {
        if (cleared) return
        cleared = true
        timers.delete(handle!)
        task()
      }, delayMs)
      ;(handle as ReturnType<typeof setTimeout> & { unref?: () => void }).unref?.()
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
      for (const handle of timers) hostClearTimeout(handle)
      timers.clear()
    }
  }
  return Object.freeze(port)
}
