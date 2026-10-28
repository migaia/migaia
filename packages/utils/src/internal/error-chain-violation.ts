/**
 * Attach the caller or utils violation identity while retaining the original offending value as
 * cause.
 */
import { attachErrorIdentity } from './error-primitives.ts'
import { ERROR_SOURCE, UtilsErrorCode } from '../error-code.ts'
import { UtilsErrorText } from '../error-text.ts'
import type { ErrorChainViolation } from '../error-chain-constants.ts'
import type { IErrorChainStrategy } from '../error-chain-types.ts'

/** Attach the caller's violation identity, or the default utils identity, retaining the input cause. */
export function createViolation(
  strategy: IErrorChainStrategy,
  cause: unknown,
  pointer: string,
  violation: ErrorChainViolation
): Error {
  if (strategy.createViolation) return strategy.createViolation(cause, pointer, violation)
  /** A native TypeError identifies malformed cross-realm input without replacing the original cause. */
  const error = new TypeError(UtilsErrorText.errorChainInvalid(pointer, violation), { cause })
  attachErrorIdentity(error, { source: ERROR_SOURCE, code: UtilsErrorCode.errorChainInvalid })
  Object.defineProperty(error, 'pointer', { value: pointer })
  Object.defineProperty(error, 'violation', { value: violation })
  return error
}
