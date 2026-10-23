export type { IAdapterJsonRpcChannelOptions } from './handshake.js'
/** Existing bridge diagnostic and protocol values retain one runtime-neutral owner. */
export { createJsonRpcBridgeError } from './error.js'
export {
  JsonRpcProfile,
  JsonRpcErrorNumber,
  JSONRPC_REQUIRED_CAPABILITIES,
  JSONRPC_ALLOWED_CAPABILITIES,
  JSONRPC_REQUIRED_METHODS
} from './constants.js'
