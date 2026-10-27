import { snapshotScheduler } from '@migaia/lifecycle'
import type { IScheduler } from '@migaia/utils/scheduler'
import ERROR_TEXT, {
  createPluginHostTypeError,
  PluginHostInternalText,
  tagPluginHostError
} from './error-text.js'
import { PluginHostErrorCode } from './error-code.js'

/**
 * Option validation for the host's timeout budgets.
 *
 * These read the caller's options and nothing else — no host state, no runtime — so they sit beside
 * the host rather than inside it. Every budget is either a finite non-negative number of
 * milliseconds or `false`, which means "wait without a deadline"; `undefined` means the caller left
 * it to the default.
 */

/** Validates a configurable timeout: `undefined`/`false` are legal, a number must be finite ≥ 0. */
export const assertTimeoutOption = (value: number | false | undefined, label: string): void => {
  if (value === undefined || value === false) return
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0)
    throw createPluginHostTypeError(PluginHostInternalText.TIMEOUT_OPTION(label))
}

/**
 * Reads the optional scheduler option once and returns its admitted snapshot, or undefined when the
 * caller left it to the default. A scheduler without `now()` and `schedule()` functions is
 * rejected; an accessor failure keeps the caller's original error as the INVALID_OPTION cause.
 */
export const admitHostScheduler = (option: unknown): IScheduler | undefined => {
  if (option === undefined) return undefined
  /** Validated snapshot; undefined means the structure lacks the required functions. */
  let snapshot: IScheduler | undefined
  try {
    snapshot = snapshotScheduler(option)
  } catch (error) {
    /** Lifecycle wraps accessor failures; the caller's own error is the meaningful cause. */
    const lifecycleCause =
      error && typeof error === 'object' && 'cause' in error
        ? (error as { readonly cause?: unknown }).cause
        : undefined
    throw tagPluginHostError(
      new TypeError(ERROR_TEXT.SCHEDULER_GETTER_FAILED, {
        cause: lifecycleCause !== undefined ? lifecycleCause : error
      }),
      PluginHostErrorCode.invalidOption
    )
  }
  if (snapshot === undefined)
    throw createPluginHostTypeError(PluginHostInternalText.SCHEDULER_FUNCTIONS)
  return snapshot
}
