/**
 * Tags native browser peer admission errors with Contract identities while preserving decoder
 * causes.
 */
import { attachErrorIdentity } from '@migaia/utils/error'
import {
  RPC_BROWSER_ERROR_SOURCE as ERROR_SOURCE,
  type IRpcBrowserErrorCode
} from '@migaia/rpc-contract/error-code'

/** Native TypeError and its exact decoder cause survive package-local admission tagging. */
export function createBrowserPeerError(
  code: IRpcBrowserErrorCode,
  message: string,
  cause?: unknown
): TypeError {
  return attachErrorIdentity(new TypeError(message, { cause }), { source: ERROR_SOURCE, code })
}
