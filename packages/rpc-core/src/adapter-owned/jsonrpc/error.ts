import { attachErrorIdentity } from '@migaia/utils/error'
import {
  JSONRPC_BRIDGE_ERROR_SOURCE,
  JsonRpcBridgeErrorCode,
  type IJsonRpcBridgeErrorCode
} from '@migaia/rpc-contract/framing/jsonrpc'
import { JsonRpcBridgeErrorText } from '@migaia/rpc-contract/framing/jsonrpc'

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
      source: JSONRPC_BRIDGE_ERROR_SOURCE,
      code
    }
  )
}
