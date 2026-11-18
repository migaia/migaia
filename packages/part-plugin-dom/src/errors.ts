import { attachErrorIdentity } from '@migaia/utils/error'
import { ERROR_SOURCE, type IPartDomErrorCode } from './error-code.ts'

/** Creates a tagged `Error`; the original failure, when any, stays on `cause`. */
export function createPartDomError(
  code: IPartDomErrorCode,
  message: string,
  cause?: unknown
): Error {
  /** One construction keeps stack and cause intact before identity attachment. */
  const error = cause === undefined ? new Error(message) : new Error(message, { cause })
  return attachErrorIdentity(error, { source: ERROR_SOURCE, code })
}
