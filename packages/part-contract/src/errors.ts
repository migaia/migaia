import { attachErrorIdentity } from '@migaia/utils/error'
import { ERROR_SOURCE, type IPartContractErrorCode } from './error-code.ts'

/** Error thrown by the part contract, carrying `(source, code)` without replacing the native error. */
export type IPartContractError = Error & {
  readonly source: string
  readonly code: IPartContractErrorCode
}

/**
 * Creates an `Error` tagged with this package's source and the given code. The native stack is the
 * constructor's; `cause` is attached by the platform when given.
 */
export function createPartContractError(
  code: IPartContractErrorCode,
  message: string,
  cause?: unknown
): IPartContractError {
  /** One construction keeps the original stack and cause intact before identity attachment. */
  const error = cause === undefined ? new Error(message) : new Error(message, { cause })
  return attachErrorIdentity(error, { source: ERROR_SOURCE, code }) as IPartContractError
}
