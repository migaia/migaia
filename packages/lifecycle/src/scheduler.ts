/**
 * Lifecycle scheduler admission layer。
 *
 * The scheduler contract, the default host implementation and the manual implementation live in
 * `@migaia/utils/scheduler`. This module only admits caller-injected schedulers at lifecycle
 * boundaries: it snapshots accessors once, validates times and delays, and reports failures with
 * lifecycle identity (`INVALID_OPTION`) so every lifecycle factory keeps its public error
 * contract.
 */
import { systemScheduler, type IScheduledTask, type IScheduler } from '@migaia/utils/scheduler'
import { attachSecondaryErrors, attachErrorIdentity } from '@migaia/utils/error'
import { createLifecycleFailure, LIFECYCLE_SOURCE, lifecycleIdentity } from './errors.ts'
import { LifecycleErrorCode } from './error-code.ts'
import { LifecycleErrorText } from './error-text.ts'

/** Invokes one captured host method, retaining native failures with lifecycle scheduler identity. */
function invokeSchedulerMethod<T>(
  method: (...args: never[]) => T,
  receiver: object,
  args: readonly unknown[]
): T {
  try {
    return Reflect.apply(method, receiver, args)
  } catch (error) {
    throw createLifecycleFailure(
      LifecycleErrorCode.invalidOption,
      LifecycleErrorText.schedulerAccessorFailed,
      error
    )
  }
}

/** Canonical runtime check for scheduler-produced and scheduler-consumed numeric values. */
export function validateSchedulerTime(value: unknown, label: string): number {
  if (typeof value !== 'number') {
    throw attachErrorIdentity(
      new TypeError(LifecycleErrorText.schedulerNumberType),
      {
        source: LIFECYCLE_SOURCE,
        code: LifecycleErrorCode.invalidOption,
        detail: { field: label }
      },
      lifecycleIdentity
    )
  }
  if (!Number.isFinite(value)) {
    throw attachErrorIdentity(
      new RangeError(LifecycleErrorText.schedulerNumberRange),
      {
        source: LIFECYCLE_SOURCE,
        code: LifecycleErrorCode.invalidOption,
        detail: { field: label }
      },
      lifecycleIdentity
    )
  }
  return value
}

/** Canonical runtime check for finite, non-negative scheduler delays. */
export function validateSchedulerDelay(value: unknown, label = 'delayMs'): number {
  const number = validateSchedulerTime(value, label)
  if (number < 0) {
    throw attachErrorIdentity(
      new RangeError(LifecycleErrorText.schedulerDelayRange),
      {
        source: LIFECYCLE_SOURCE,
        code: LifecycleErrorCode.invalidOption,
        detail: { field: label }
      },
      lifecycleIdentity
    )
  }
  return number
}

/** Rejects a scheduler time target when finite operands overflow during addition. */
export function addSchedulerTime(base: number, delta: number, label: string): number {
  /** Candidate absolute scheduler time produced by adding the validated increment. */
  const target = base + delta
  if (!Number.isFinite(target)) {
    throw attachErrorIdentity(
      new RangeError(LifecycleErrorText.schedulerTimeOverflow),
      {
        source: LIFECYCLE_SOURCE,
        code: LifecycleErrorCode.invalidOption,
        detail: { field: label, base, delta }
      },
      lifecycleIdentity
    )
  }
  return target
}

/**
 * Reads one injected task's accessors once, in a fixed order (`cancel`, then `unref`), and returns
 * a snapshot that keeps the original receiver. A missing or non-function `cancel` is rejected as
 * before. Once `cancel` is valid, a function `unref` is forwarded, an absent `unref` is omitted,
 * and a throwing or non-function `unref` is rejected after cancelling the already-started injected
 * timer; a failing rollback is attached to the primary error's `errors` instead of replacing it.
 */
function snapshotScheduledTask(value: unknown): IScheduledTask {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) {
    throw attachErrorIdentity(
      new Error(LifecycleErrorText.schedulerTaskInvalid),
      { source: LIFECYCLE_SOURCE, code: LifecycleErrorCode.invalidOption },
      lifecycleIdentity
    )
  }
  /** Injected task object; the receiver of every forwarded method. */
  const receiver = value
  /** The single observation of the task's `cancel` accessor. */
  let cancel: unknown
  try {
    cancel = (value as { cancel?: unknown }).cancel
  } catch (error) {
    throw attachErrorIdentity(
      new TypeError(LifecycleErrorText.schedulerTaskCancelGetterFailed, { cause: error }),
      { source: LIFECYCLE_SOURCE, code: LifecycleErrorCode.invalidOption },
      lifecycleIdentity
    )
  }
  if (typeof cancel !== 'function') {
    throw attachErrorIdentity(
      new Error(LifecycleErrorText.schedulerTaskInvalid),
      { source: LIFECYCLE_SOURCE, code: LifecycleErrorCode.invalidOption },
      lifecycleIdentity
    )
  }
  /** Cancels the injected timer with its original receiver. */
  const cancelTask = (): void => {
    invokeSchedulerMethod(cancel as () => void, receiver, [])
  }
  /** Rejects the task after rolling back its started timer; rollback failures stay secondary. */
  const reject = (primary: Error): never => {
    try {
      cancelTask()
    } catch (rollbackError) {
      throw attachSecondaryErrors(primary, [rollbackError])
    }
    throw primary
  }
  /** The single observation of the task's optional `unref` accessor. */
  let unref: unknown
  try {
    unref = (value as { unref?: unknown }).unref
  } catch (error) {
    return reject(
      attachErrorIdentity(
        new TypeError(LifecycleErrorText.schedulerAccessorFailed, { cause: error }),
        {
          source: LIFECYCLE_SOURCE,
          code: LifecycleErrorCode.invalidOption,
          detail: { field: 'unref' }
        },
        lifecycleIdentity
      )
    )
  }
  if (unref === undefined) return { cancel: cancelTask }
  if (typeof unref !== 'function') {
    return reject(
      attachErrorIdentity(
        new Error(LifecycleErrorText.schedulerTaskInvalid),
        {
          source: LIFECYCLE_SOURCE,
          code: LifecycleErrorCode.invalidOption,
          detail: { field: 'unref' }
        },
        lifecycleIdentity
      )
    )
  }
  return {
    cancel: cancelTask,
    unref: () => {
      invokeSchedulerMethod(unref as () => void, receiver, [])
    }
  }
}

/** Read scheduler accessors once while preserving their original receiver. */
export function snapshotScheduler(value: unknown): IScheduler | undefined {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) {
    return undefined
  }
  const receiver = value
  let now: unknown
  let schedule: unknown
  /** Optional deferred method is captured with the same receiver as clock and timers. */
  let deferred: unknown
  try {
    now = (value as { now?: unknown }).now
    schedule = (value as { schedule?: unknown }).schedule
    deferred = (value as { defer?: unknown }).defer
  } catch (error) {
    throw attachErrorIdentity(
      new TypeError(LifecycleErrorText.schedulerAccessorFailed, { cause: error }),
      { source: LIFECYCLE_SOURCE, code: LifecycleErrorCode.invalidOption },
      lifecycleIdentity
    )
  }
  if (typeof now !== 'function' || typeof schedule !== 'function') return undefined
  if (deferred !== undefined && typeof deferred !== 'function')
    throw attachErrorIdentity(
      new TypeError(LifecycleErrorText.schedulerDeferInvalid),
      { source: LIFECYCLE_SOURCE, code: LifecycleErrorCode.invalidOption },
      lifecycleIdentity
    )
  return {
    now: () =>
      validateSchedulerTime(invokeSchedulerMethod(now as () => unknown, receiver, []), 'now()'),
    ...(typeof deferred === 'function'
      ? {
          defer: (callback: () => void) => {
            invokeSchedulerMethod(deferred as (...args: never[]) => void, receiver, [callback])
          }
        }
      : {}),
    schedule: (callback, delayMs) => {
      const validDelay = validateSchedulerDelay(delayMs)
      return snapshotScheduledTask(
        invokeSchedulerMethod(schedule as (...args: never[]) => unknown, receiver, [
          callback,
          validDelay
        ])
      )
    }
  }
}

/**
 * Reads one public scheduler option and snapshots its scheduler methods before a lifecycle object
 * is created. A getter failure is an invalid-option boundary failure; the native `TypeError`
 * preserves the exact thrown value through `cause` and prevents scheduler work from starting.
 */
export function resolveSchedulerOption(
  options: { readonly scheduler?: unknown } | null | undefined,
  fallback: IScheduler
): IScheduler

/** Reads one optional public scheduler option without inventing a default scheduler. */
export function resolveSchedulerOption(
  options: { readonly scheduler?: unknown } | null | undefined
): IScheduler | undefined

export function resolveSchedulerOption(
  options: { readonly scheduler?: unknown } | null | undefined,
  fallback?: IScheduler
): IScheduler | undefined {
  /** The single scheduler option value admitted from the caller-owned options object. */
  let schedulerOption: unknown
  try {
    schedulerOption = options?.scheduler
  } catch (error) {
    throw attachErrorIdentity(
      new TypeError(LifecycleErrorText.schedulerAccessorFailed, { cause: error }),
      {
        source: LIFECYCLE_SOURCE,
        code: LifecycleErrorCode.invalidOption,
        detail: { field: 'scheduler' }
      },
      lifecycleIdentity
    )
  }
  if (schedulerOption === undefined) return fallback
  return resolveScheduler(schedulerOption)
}

/** Resolve an injected scheduler at its factory boundary, retaining lifecycle error identity. */
export function resolveScheduler(value: unknown): IScheduler {
  const snapshot = snapshotScheduler(value)
  if (snapshot === undefined) {
    throw attachErrorIdentity(
      new Error(LifecycleErrorText.schedulerInvalid),
      { source: LIFECYCLE_SOURCE, code: LifecycleErrorCode.invalidOption },
      lifecycleIdentity
    )
  }
  return snapshot
}

/**
 * The package default scheduler: the utils system scheduler admitted once at module load, not
 * re-snapshotted on every `boundedWait`, graceful race, generation controller and mutation queue.
 * Admission and per-call validation stay identical to an injected scheduler, so delay and time
 * errors keep their lifecycle `INVALID_OPTION` identity. Internal to the package.
 */
export const defaultLifecycleScheduler: IScheduler = resolveScheduler(systemScheduler)
