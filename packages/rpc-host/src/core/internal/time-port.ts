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

/** Endpoint-local enablement owns only the private scheduler receiver, never caller configuration. */
const fastSchedulers = new WeakMap<IEndpointTimePort, () => void>()

/** Turns on canonical aggregation only after bootstrap's exact private proof has succeeded. */
export function enableFastTimePort(port: IEndpointTimePort): void {
  fastSchedulers.get(port)?.()
}

/** Own one logical timer receipt until its first clear or scheduler callback. */
class EndpointTimer {
  /** The port's exact logical handle collection remains the only timer membership owner. */
  #timers: Set<IScheduledTask>
  /** The original callback is invoked once without binding a wrapper receiver. */
  #task: () => void
  /** Native registration may synchronously fire before returning its cancellation receipt. */
  #handle: IScheduledTask | undefined
  /** First clear or callback wins and preserves idempotent cancellation. */
  #cleared = false
  /** The original mutable one-property receipt remains detached-call safe. */
  readonly value: IEndpointTimer

  /** Schedule once, then retain the original unref and membership publication order. */
  constructor(
    scheduler: IScheduler,
    timers: Set<IScheduledTask>,
    task: () => void,
    delayMs: number
  ) {
    this.#timers = timers
    this.#task = task
    this.#handle = scheduler.schedule(this.#fire, delayMs)
    this.#handle.unref?.()
    timers.add(this.#handle)
    this.value = { clear: this.#clear }
  }
  /** A clear removes this original registration before invoking native cancellation. */
  #clear = (): void => {
    if (this.#cleared) return
    this.#cleared = true
    if (this.#handle !== undefined) {
      this.#timers.delete(this.#handle)
      this.#handle.cancel()
    }
  }
  /** Native firing retires membership before allowing reentrant application work. */
  #fire = (): void => {
    if (this.#cleared) return
    this.#cleared = true
    this.#timers.delete(this.#handle!)
    /** User callbacks retain their original plain invocation receiver. */
    const task = this.#task
    task()
  }
}

/** Own one endpoint's scheduler strategy, timer membership and terminal transition. */
class EndpointTimePort {
  /** The original scheduler remains publicly observable after private strategy enablement. */
  #scheduler: IScheduler
  /** Only this private scheduler receiver can change after canonical bootstrap proof. */
  #runtimeScheduler: IScheduler
  /** The original wall clock supplies only epoch timestamps. */
  #wallClock: IWallClock
  /** Private enablement is available only for the original canonical scheduler contract. */
  #canonicalScheduler: boolean
  /** Every live logical registration belongs to this one endpoint. */
  #timers = new Set<IScheduledTask>()
  /** Disposal rejects later timer admission without changing the public capability shape. */
  #disposed = false
  /** Public operations preserve the original frozen own-property surface and detached calls. */
  readonly value: IEndpointTimePort

  /** Capture original clocks before publishing the endpoint-local time capability. */
  constructor(scheduler: IScheduler, wallClock: IWallClock, canonicalScheduler: boolean) {
    this.#scheduler = scheduler
    this.#runtimeScheduler = scheduler
    this.#wallClock = wallClock
    this.#canonicalScheduler = canonicalScheduler
    /** The same facade identity is the private enablement and observation key. */
    const port: IEndpointTimePort = {
      scheduler,
      now: this.#now,
      timestamp: () => this.#wallClock.timestamp(),
      setTimeout: this.#setTimeout,
      clearTimeout: this.#clearTimeout,
      dispose: this.#dispose
    }
    this.value = port
    fastSchedulers.set(port, this.#enableFast)
    Object.freeze(port)
  }
  /** Monotonic reads retain the original scheduler receiver and observation event. */
  #now = (): number => {
    /** Read once before notifying the existing private observer. */
    const value = this.#scheduler.now()
    reportEndpointTimePortEvent(this.value, { kind: 'now', value })
    return value
  }
  /** Admit one timer through its actual scheduler owner and original event ordering. */
  #setTimeout = (task: () => void, delayMs: number): IEndpointTimer => {
    if (this.#disposed) return { clear: () => undefined }
    /** This receipt owns only this logical registration, without a second scheduling queue. */
    const timer = new EndpointTimer(this.#runtimeScheduler, this.#timers, task, delayMs).value
    reportEndpointTimePortEvent(this.value, { kind: 'setTimeout', delayMs, timer })
    return timer
  }
  /** Explicit clear observations precede the exact timer's original idempotent clear operation. */
  #clearTimeout = (timer: IEndpointTimer): void => {
    reportEndpointTimePortEvent(this.value, { kind: 'clearTimeout', timer })
    timer.clear()
  }
  /** Terminal cleanup preserves original iteration and first cancellation-failure behavior. */
  #dispose = (): void => {
    if (this.#disposed) return
    this.#disposed = true
    for (const handle of this.#timers) handle.cancel()
    this.#timers.clear()
    fastSchedulers.delete(this.value)
  }
  /** Canonical bootstrap can change only the private receiver, once and before terminal disposal. */
  #enableFast = (): void => {
    if (this.#canonicalScheduler && this.#runtimeScheduler === this.#scheduler && !this.#disposed)
      this.#runtimeScheduler = Object.create(this.#scheduler) as IScheduler
  }
}

/**
 * Create one endpoint-local time owner. The scheduler drives durations while wallClock supplies
 * diagnostic timestamps; all timers remain owned until their first clear or endpoint disposal.
 */
export function createEndpointTimePort(
  scheduler: IScheduler,
  wallClock: IWallClock = systemWallClock,
  canonicalScheduler = false
): IEndpointTimePort {
  return new EndpointTimePort(scheduler, wallClock, canonicalScheduler).value
}
