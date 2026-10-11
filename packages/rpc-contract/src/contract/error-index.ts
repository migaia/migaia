/** Independent protocol implementations project and restore the complete coded error graph. */
export {
  classifyRpcContractError,
  deserializeRpcError,
  normalizeRpcSerializedError,
  reachRpcError,
  serializeRpcError
} from './error.js'
export { fromJsonRpcError, toJsonRpcError } from './error-jsonrpc.js'
export {
  RpcContractErrorCode,
  ERROR_SOURCE as RPC_CONTRACT_SOURCE,
  type IRpcContractErrorCode
} from './error-code.js'
export * from './wire-error-constants.js'
export type {
  IRpcContractError,
  IRpcErrorWireMetadata,
  IRpcErrorWireRouteStore,
  IRpcErrorWireSummary,
  IRpcJsonRpcErrorObject,
  IRpcSerializedError,
  IRpcSerializeErrorOptions,
  IRpcWireErrorFailure,
  IRpcWireErrorOptions
} from './types.js'
