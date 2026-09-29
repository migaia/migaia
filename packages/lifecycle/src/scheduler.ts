/**
 * Lifecycle scheduler admission layer（`docs/lifecycle/lifecycle-scheduler-convergence.sdd.md` LD3）。
 *
 * The scheduler contract, the default host implementation and the manual implementation live in
 * `@migaia/utils/scheduler`. This module only admits caller-injected schedulers at lifecycle
 * boundaries: it snapshots accessors once, validates times and delays, and reports failures with
 * lifecycle identity (`INVALID_OPTION`) so every lifecycle factory keeps its public error
 * contract.
 */
import type { IScheduledTask, IScheduler } from '@migaia/utils/scheduler'
import { attachSecondaryErrors } from '@migaia/utils/error'
import {
  createLifecycleError,
  createLifecycleRangeError,
  createLifecycleTypeError
} from './errors.js'
import { LifecycleErrorCode } from './error-code.js'
import { LifecycleErrorText } from './error-text.js'

/** Canonical runtime check for scheduler-produced and scheduler-consumed numeric values. */
export function validateSchedulerTime(value: unknown, label: string): number {
  if (typeof value !== 'number') {
    throw createLifecycleTypeError(
      LifecycleErrorCode.invalidOption,
      LifecycleErrorText.schedulerNumberType,
      {
        detail: { field: label }
      }
    )
  }
  if (!Number.isFinite(value)) {
    throw createLifecycleRangeError(
      LifecycleErrorCode.invalidOption,
      LifecycleErrorText.schedulerNumberRange,
      {
        detail: { field: label }
      }
    )
  }
  return value
}

/** Canonical runtime check for finite, non-negative scheduler delays. */
export function validateSchedulerDelay(value: unknown, label = 'delayMs'): number {
  const number = validateSchedulerTime(value, label)
  if (number < 0) {
    throw createLifecycleRangeError(
      LifecycleErrorCode.invalidOption,
      LifecycleErrorText.schedulerDelayRange,
      {
        detail: { field: label }
      }
    )
  }
  return number
}

/** Rejects a scheduler time target when finite operands overflow during addition. */
export function addSchedulerTime(base: number, delta: number, label: string): number {
  /** Candidate absolute scheduler time produced by adding the validated increment. */
  const target = base + delta
  if (!Number.isFinite(target)) {
    throw createLifecycleRangeError(
      LifecycleErrorCode.invalidOption,
      LifecycleErrorText.schedulerTimeOverflow,
      {
        detail: { field: label, base, delta }
      }
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
    throw createLifecycleError(
      LifecycleErrorCode.invalidOption,
      LifecycleErrorText.schedulerTaskInvalid
    )
  }
  /** Injected task object; the receiver of every forwarded method. */
  const receiver = value
  /** The single observation of the task's `cancel` accessor. */
  let cancel: unknown
  try {
    cancel = (value as { cancel?: unknown }).cancel
  } catch (error) {
    throw createLifecycleTypeError(
      LifecycleErrorCode.invalidOption,
      LifecycleErrorText.schedulerTaskCancelGetterFailed,
      { cause: error }
    )
  }
  if (typeof cancel !== 'function') {
    throw createLifecycleError(
      LifecycleErrorCode.invalidOption,
      LifecycleErrorText.schedulerTaskInvalid
    )
  }
  /** Cancels the injected timer with its original receiver. */
  const cancelTask = (): void => {
    Reflect.apply(cancel as () => void, receiver, [])
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
      createLifecycleTypeError(
        LifecycleErrorCode.invalidOption,
        LifecycleErrorText.schedulerAccessorFailed,
        { cause: error, detail: { field: 'unref' } }
      )
    )
  }
  if (unref === undefined) return { cancel: cancelTask }
  if (typeof unref !== 'function') {
    return reject(
      createLifecycleError(
        LifecycleErrorCode.invalidOption,
        LifecycleErrorText.schedulerTaskInvalid,
        { detail: { field: 'unref' } }
      )
    )
  }
  return {
    cancel: cancelTask,
    unref: () => {
      Reflect.apply(unref as () => void, receiver, [])
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
  try {
    now = (value as { now?: unknown }).now
    schedule = (value as { schedule?: unknown }).schedule
  } catch (error) {
    throw createLifecycleTypeError(
      LifecycleErrorCode.invalidOption,
      LifecycleErrorText.schedulerAccessorFailed,
      { cause: error }
    )
  }
  if (typeof now !== 'function' || typeof schedule !== 'function') return undefined
  return {
    now: () => validateSchedulerTime(Reflect.apply(now, receiver, []), 'now()'),
    schedule: (callback, delayMs) => {
      const validDelay = validateSchedulerDelay(delayMs)
      return snapshotScheduledTask(Reflect.apply(schedule, receiver, [callback, validDelay]))
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
    throw createLifecycleTypeError(
      LifecycleErrorCode.invalidOption,
      LifecycleErrorText.schedulerAccessorFailed,
      { cause: error, detail: { field: 'scheduler' } }
    )
  }
  if (schedulerOption === undefined) return fallback
  return resolveScheduler(schedulerOption)
}

/** Resolve an injected scheduler at its factory boundary, retaining lifecycle error identity. */
export function resolveScheduler(value: unknown): IScheduler {
  const snapshot = snapshotScheduler(value)
  if (snapshot === undefined) {
    throw createLifecycleError(
      LifecycleErrorCode.invalidOption,
      LifecycleErrorText.schedulerInvalid
    )
  }
  return snapshot
}
