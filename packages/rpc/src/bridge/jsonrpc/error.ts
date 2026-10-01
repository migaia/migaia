import { attachErrorIdentity } from '@migaia/utils/error'
import { ERROR_SOURCE, JsonRpcBridgeErrorCode, type IJsonRpcBridgeErrorCode } from './error-code.js'
import { JsonRpcBridgeErrorText } from './error-text.js'

/** One constructor owns code/text pairing and preserves non-secret original failures. */
export function createJsonRpcBridgeError(
  code: IJsonRpcBridgeErrorCode,
  cause?: unknown,
  local = false
): Error {
  /** Native TypeError identifies unsupported modes and local caller misuse. */
  const Constructor = local || code === JsonRpcBridgeErrorCode.unsupportedMode ? TypeError : Error
  /** Text lookup follows the declaration keys without echoing any peer data. */
  const key = Object.keys(JsonRpcBridgeErrorCode).find(
    (candidate) => JsonRpcBridgeErrorCode[candidate as keyof typeof JsonRpcBridgeErrorCode] === code
  ) as keyof typeof JsonRpcBridgeErrorText
  return attachErrorIdentity(
    new Constructor(JsonRpcBridgeErrorText[key], cause === undefined ? undefined : { cause }),
    {
      source: ERROR_SOURCE,
      code
    }
  )
}
