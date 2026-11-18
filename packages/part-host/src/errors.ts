import { attachErrorIdentity } from '@migaia/utils/error'
import { ERROR_SOURCE, type IPartHostErrorCode } from './error-code.ts'

/** Error thrown by the part host, carrying `(source, code)`. */
export type IPartHostError = Error & { readonly source: string; readonly code: IPartHostErrorCode }

/** Creates a tagged `Error`; the original failure, when any, stays on `cause`. */
export function createPartHostError(
  code: IPartHostErrorCode,
  message: string,
  cause?: unknown
): IPartHostError {
  /** One construction keeps stack and cause intact before identity attachment. */
  const error = cause === undefined ? new Error(message) : new Error(message, { cause })
  return attachErrorIdentity(error, { source: ERROR_SOURCE, code }) as IPartHostError
}

/** True when a value is an error carrying the given part-host code. */
export function hasPartHostCode(value: unknown, code: IPartHostErrorCode): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { source?: unknown }).source === ERROR_SOURCE &&
    (value as { code?: unknown }).code === code
  )
}
