import { createJsonRpcAdapterChannel } from '@migaia/rpc-core/adapter/jsonrpc'
import type { IJsonRpcBridgeOptions } from '@migaia/rpc-core/adapter/jsonrpc'
export type { IJsonRpcBridgeOptions } from '@migaia/rpc-core/adapter/jsonrpc'
/** Callers obtain the actual ordered byte resource through the Process package. */
export type { IProcessByteChannel } from '@migaia/rpc-process'
export {
  JsonRpcBridgeErrorCode,
  JSONRPC_BRIDGE_ERROR_SOURCE,
  type IJsonRpcBridgeErrorCode
} from '@migaia/rpc-contract/framing/jsonrpc'

/** Construct the foreign-language channel and retain the Core owner's exact Promise. */
export function createJsonRpcRemoteChannel(options: IJsonRpcBridgeOptions) {
  return createJsonRpcAdapterChannel(options)
}
