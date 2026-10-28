/** Owns scheduler validation state and resources without adding a scheduling policy. */
import { UtilsErrorCode } from '../error-code.ts'
import { UtilsErrorText } from '../error-text.ts'

import { ERROR_SOURCE, type IUtilsErrorCode } from '../error-code.ts'
import { attachErrorIdentity } from '../error.ts'

/** Native error constructors whose runtime type callers branch on. */
export type ISchedulerErrorConstructor =
  | ErrorConstructor
  | TypeErrorConstructor
  | RangeErrorConstructor

/** Expectation text shared by every delay-like argument this module validates. */
export const DELAY_EXPECTATION = UtilsErrorText.finiteNonNegativeNumberExpectation

/**
 * Creates a native error of the requested type and attaches the utils boundary identity without
 * replacing the error object, so callers can branch on both the native type and `code`.
 */
export function schedulerError(
  Constructor: ISchedulerErrorConstructor,
  code: IUtilsErrorCode,
  message: string,
  options?: ErrorOptions
): Error {
  return attachErrorIdentity(new Constructor(message, options), { source: ERROR_SOURCE, code })
}

/**
 * Rejects a delay-like argument before any state changes: a non-number is a `TypeError`, a
 * non-finite or negative number is a `RangeError`; both carry `INVALID_ARGUMENT`.
 */
export function assertDelay(value: unknown, field: string): number {
  if (typeof value !== 'number')
    throw schedulerError(
      TypeError,
      UtilsErrorCode.invalidArgument,
      UtilsErrorText.invalidArgument(field, DELAY_EXPECTATION)
    )
  if (!Number.isFinite(value) || value < 0)
    throw schedulerError(
      RangeError,
      UtilsErrorCode.invalidArgument,
      UtilsErrorText.invalidArgument(field, DELAY_EXPECTATION)
    )
  return value
}

/**
 * Adds a validated increment to the virtual clock and rejects an overflowing target before the
 * caller mutates its heap or clock.
 */
export function addVirtualTime(base: number, delta: number, field: string): number {
  /** Candidate absolute virtual time; only returned when it stayed finite. */
  const target = base + delta
  if (!Number.isFinite(target))
    throw schedulerError(
      RangeError,
      UtilsErrorCode.invalidArgument,
      UtilsErrorText.invalidArgument(field, DELAY_EXPECTATION)
    )
  return target
}
