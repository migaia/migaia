import { attachErrorIdentity } from '@migaia/utils/error'
import { ERROR_SOURCE, type IPartReactErrorCode } from './error-code.ts'

/** Stable messages of `part.react` errors. */
export const PartReactErrorText = {
  /** No React binding for a part. */
  bindingMissing: (partId: string, address: string): string =>
    `part "${partId}" at "${address}" has no React binding`,
  /** No root element after commit. */
  elementUnresolved: (address: string): string => `no root element was resolved for "${address}"`,
  /** Node render failure. */
  renderFailed: (address: string): string => `part at "${address}" failed to render`
} as const

/** Creates a tagged `Error`; the original failure, when any, stays on `cause`. */
export function createPartReactError(
  code: IPartReactErrorCode,
  message: string,
  cause?: unknown
): Error {
  /** One construction keeps stack and cause intact before identity attachment. */
  const error = cause === undefined ? new Error(message) : new Error(message, { cause })
  return attachErrorIdentity(error, { source: ERROR_SOURCE, code })
}
