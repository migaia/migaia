/** Native coded errors shared by ConfigOwner responsibilities; no state or error translation policy. */
import { ERROR_SOURCE, type IUtilsErrorCode } from '../error-code.ts'
import { attachErrorIdentity } from '../error.ts'

/** Creates a coded native error without replacing its native type. */
export function ownerError(
  Constructor: TypeErrorConstructor | ErrorConstructor,
  code: IUtilsErrorCode,
  message: string,
  cause?: unknown
): Error {
  return attachErrorIdentity(
    new Constructor(message, cause === undefined ? undefined : { cause }),
    { source: ERROR_SOURCE, code }
  )
}
