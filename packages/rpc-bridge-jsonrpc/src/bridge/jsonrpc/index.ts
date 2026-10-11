import { createJsonRpcAdapterChannel } from './channel.js'
import type { IJsonRpcBridgeOptions } from './handshake.js'
/** The adapter owns the moved raw-byte JSON-RPC operation at its ordinary public entry. */
export { createJsonRpcAdapterChannel } from './channel.js'
export type { IJsonRpcBridgeOptions } from './handshake.js'
/** Callers obtain the actual ordered byte resource through the Process package. */
export type { IProcessByteChannel } from '@migaia/rpc-process'
export {
  JsonRpcBridgeErrorCode,
  JSONRPC_BRIDGE_ERROR_SOURCE,
  type IJsonRpcBridgeErrorCode
} from '@migaia/rpc-contract/framing/jsonrpc'

/** Construct the foreign-language channel and retain the adapter owner's exact Promise. */
export function createJsonRpcRemoteChannel(options: IJsonRpcBridgeOptions) {
  return createJsonRpcAdapterChannel(options)
}
