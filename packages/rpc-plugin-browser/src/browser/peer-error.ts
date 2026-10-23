import { attachErrorIdentity } from '@migaia/utils/error'
import { ERROR_SOURCE, type IRpcBrowserErrorCode } from '../error-code.js'

/** Native TypeError and its exact decoder cause survive package-local admission tagging. */
export function createBrowserPeerError(
  code: IRpcBrowserErrorCode,
  message: string,
  cause?: unknown
): TypeError {
  return attachErrorIdentity(new TypeError(message, { cause }), { source: ERROR_SOURCE, code })
}
