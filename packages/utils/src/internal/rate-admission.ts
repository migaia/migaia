/** Owns admission control state and its existing native resource lifetime. */
import { UtilsErrorCode } from '../error-code.ts'
import { UtilsErrorText } from '../error-text.ts'

import type { IAbortSignal } from './promise-contract.ts'

import { systemScheduler, type IScheduler } from './scheduler.ts'

import { ERROR_SOURCE } from '../error-code.ts'
import { attachErrorIdentity } from '../error.ts'

/** Largest wait host timers accept without overflowing. */
export const MAXIMUM_DELAY = 2_147_483_647

/** Creates a coded `INVALID_ARGUMENT` error of the given native type. */
export function argumentError(
  Constructor: TypeErrorConstructor | RangeErrorConstructor,
  field: string,
  expectation: string
): Error {
  return attachErrorIdentity(new Constructor(UtilsErrorText.invalidArgument(field, expectation)), {
    source: ERROR_SOURCE,
    code: UtilsErrorCode.invalidArgument
  })
}

/** Validates a callback argument. */
export function admitFunction(value: unknown, field: string): void {
  if (typeof value !== 'function')
    throw argumentError(TypeError, field, UtilsErrorText.functionExpectation)
}

/** Validates a wait-like argument. */
export function admitWait(value: unknown, field: string): number {
  if (typeof value !== 'number')
    throw argumentError(TypeError, field, UtilsErrorText.delayExpectation)
  if (!Number.isFinite(value) || value < 0 || value > MAXIMUM_DELAY)
    throw argumentError(RangeError, field, UtilsErrorText.delayExpectation)
  return value
}

/** Validates an optional structural abort signal. */
export function admitSignal(value: unknown): IAbortSignal | undefined {
  if (value === undefined) return undefined
  if (
    value === null ||
    typeof value !== 'object' ||
    typeof (value as IAbortSignal).addEventListener !== 'function' ||
    typeof (value as IAbortSignal).aborted !== 'boolean'
  )
    throw argumentError(TypeError, 'signal', UtilsErrorText.abortSignalExpectation)
  return value as IAbortSignal
}

/** Validates an optional scheduler. */
export function admitScheduler(value: unknown): IScheduler {
  if (value === undefined) return systemScheduler
  if (
    value === null ||
    typeof value !== 'object' ||
    typeof (value as IScheduler).schedule !== 'function' ||
    typeof (value as IScheduler).now !== 'function'
  )
    throw argumentError(TypeError, 'scheduler', 'an IScheduler')
  return value as IScheduler
}
