import { createPluginHostTypeError } from './error-text.js'

/**
 * Option validation for the host's timeout budgets.
 *
 * These read the caller's options and nothing else — no host state, no runtime — so they sit beside
 * the host rather than inside it. Every budget is either a finite non-negative number of
 * milliseconds or `false`, which means "wait without a deadline"; `undefined` means the caller left
 * it to the default, and only the mandatory ones reject it.
 */

/** Validates a configurable timeout: `undefined`/`false` are legal, a number must be finite ≥ 0. */
export const assertTimeoutOption = (value: number | false | undefined, label: string): void => {
  if (value === undefined || value === false) return
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0)
    throw createPluginHostTypeError(`${label} must be false or a non-negative finite number`)
}

/** Rejects an omitted mandatory execution budget before any unrelated option is observed. */
export const assertRequiredTimeoutOption = (
  value: number | false | undefined,
  label: string
): void => {
  if (value === undefined)
    throw createPluginHostTypeError(
      `${label} must be provided as false or a non-negative finite number`
    )
  assertTimeoutOption(value, label)
}
