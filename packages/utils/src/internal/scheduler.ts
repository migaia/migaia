/**
 * Public scheduler contracts and canonical host clock; native, shared and manual task resources
 * have separate owners.
 */

import type { IScheduler, IWallClock, IManualScheduler } from './scheduler-contract.ts'
export type {
  IScheduledTask,
  IScheduler,
  IManualScheduler,
  IWallClock
} from './scheduler-contract.ts'

import { UtilsErrorCode } from '../error-code.ts'
import { UtilsErrorText } from '../error-text.ts'
import { schedulerError, assertDelay } from './scheduler-validation.ts'
import { NativeTimerTask, type IHostSetTimeout, type IHostClearTimeout } from './native-timer.ts'
import { sharedScheduler } from './shared-scheduler.ts'
import { ManualScheduler } from './manual-scheduler.ts'

/**
 * Create a deterministic clock. Callbacks scheduled during advance may run in that same advance;
 * argument overflow and reentrant advances fail before clock/heap mutation. The canonical scheduler
 * module retains this constructor entry while the class owns virtual-clock resources.
 */
export function createManualScheduler(): IManualScheduler {
  return new ManualScheduler()
}

/** Structural view of the host globals the default scheduler needs; never exported. */
type ISchedulerHostGlobals = {
  readonly performance?: { readonly now?: unknown }
  readonly setTimeout?: unknown
  readonly clearTimeout?: unknown
  readonly queueMicrotask?: unknown
}

/** Reads the host globals fresh on every call so substituted hosts are honoured. */
function hostGlobals(): ISchedulerHostGlobals {
  return globalThis as unknown as ISchedulerHostGlobals
}

/**
 * Register one deferred job through its scheduler receiver. Older two-method schedulers use
 * schedule(callback, 0); default System jobs retain native microtask order. This does not await
 * callback results or create a cancellation owner. Registration failures propagate by identity.
 */
export function deferTask(scheduler: IScheduler, callback: () => void): void {
  if (typeof callback !== 'function')
    throw schedulerError(TypeError, UtilsErrorCode.invalidArgument, UtilsErrorText.deferredCallback)
  if ((typeof scheduler !== 'object' && typeof scheduler !== 'function') || scheduler === null)
    throw schedulerError(
      TypeError,
      UtilsErrorCode.invalidArgument,
      UtilsErrorText.deferredScheduler
    )
  /** Capture only the method required for this operation, retaining its original receiver. */
  let deferred: unknown
  /** Legacy schedulers need their ordinary zero-time registration only when no defer exists. */
  let scheduled: unknown
  try {
    deferred = scheduler.defer
    if (deferred === undefined) scheduled = scheduler.schedule
  } catch (cause) {
    throw schedulerError(
      TypeError,
      UtilsErrorCode.invalidArgument,
      UtilsErrorText.deferredAccessor,
      { cause }
    )
  }
  /** Both paths invoke exactly one captured method after admission. */
  const register = deferred === undefined ? scheduled : deferred
  if (typeof register !== 'function')
    throw schedulerError(
      TypeError,
      UtilsErrorCode.invalidArgument,
      UtilsErrorText.deferredScheduler
    )
  Reflect.apply(register, scheduler, deferred === undefined ? [callback, 0] : [callback])
}

/**
 * Default scheduler: `performance.now()` as the monotonic clock and host `setTimeout` /
 * `clearTimeout` for timers. Host capabilities are checked lazily on each call and a missing or
 * non-finite capability fails with `ENV_UNSUPPORTED` instead of silently degrading. The object is
 * deliberately a plain mutable object so tests can spy on its methods.
 */
export const systemScheduler: IScheduler = {
  now() {
    /** Host performance object whose `now` method must stay its own receiver. */
    const performanceHost = hostGlobals().performance
    if (typeof performanceHost?.now !== 'function')
      throw schedulerError(
        Error,
        UtilsErrorCode.envUnsupported,
        UtilsErrorText.envUnsupported(UtilsErrorText.schedulerCapability.monotonicClock)
      )
    /** Raw host clock reading; a throw from the host propagates unchanged. */
    const value: unknown = Reflect.apply(performanceHost.now, performanceHost, [])
    if (typeof value !== 'number')
      throw schedulerError(
        TypeError,
        UtilsErrorCode.envUnsupported,
        UtilsErrorText.envUnsupported(UtilsErrorText.schedulerCapability.finiteClock)
      )
    if (!Number.isFinite(value))
      throw schedulerError(
        RangeError,
        UtilsErrorCode.envUnsupported,
        UtilsErrorText.envUnsupported(UtilsErrorText.schedulerCapability.finiteClock)
      )
    return value
  },
  /** Default deferred work stays a native microtask, independently of timer/deadline strategy. */
  defer(callback) {
    /** Read the host on each call, matching the existing timer substitution contract. */
    const host = hostGlobals()
    /** Native microtask registration is a host capability, not another library queue. */
    const enqueue = host.queueMicrotask
    if (typeof enqueue !== 'function')
      throw schedulerError(
        Error,
        UtilsErrorCode.envUnsupported,
        UtilsErrorText.envUnsupported(UtilsErrorText.schedulerCapability.microtasks)
      )
    Reflect.apply(enqueue, host, [callback])
  },
  schedule(callback, delayMs) {
    if (
      this !== systemScheduler &&
      this !== undefined &&
      Object.getPrototypeOf(this) === systemScheduler
    )
      return sharedScheduler(this, systemScheduler).schedule(callback, delayMs)
    assertDelay(delayMs, 'delayMs')
    /** One host snapshot so the registering and cancelling functions always pair up. */
    const host = hostGlobals()
    /** Host timer registration captured once for every segment of this task. */
    const setCandidate = host.setTimeout
    /** Host timer cancellation paired with the registration function for this task. */
    const clearCandidate = host.clearTimeout
    if (typeof setCandidate !== 'function' || typeof clearCandidate !== 'function')
      throw schedulerError(
        Error,
        UtilsErrorCode.envUnsupported,
        UtilsErrorText.envUnsupported(UtilsErrorText.schedulerCapability.timers)
      )
    /** Admitted host registration function. */
    const set = setCandidate as IHostSetTimeout
    /** Admitted host cancellation function, always paired with `set`. */
    const clear = clearCandidate as IHostClearTimeout
    return new NativeTimerTask(callback, delayMs, set, clear).task
  }
}

/** Default wall clock: `Date.now()` epoch milliseconds, for diagnostic timestamps only. */
export const systemWallClock: IWallClock = {
  timestamp: () => Date.now()
}
