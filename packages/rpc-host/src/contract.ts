/** Named contract forwarding preserves the application's single peer-package identities. */
export {
  RpcLifecycleError,
  RpcConstructionError,
  RpcAbortError,
  isRpcError,
  isRpcErrorInstance,
  isRpcRemoteError,
  isRpcTimeoutError,
  RPC_CORE_ERROR_SOURCE
} from '@migaia/rpc-contract/errors'
export type {
  RpcError,
  RpcSchemaValidationError,
  RpcConfigurationError,
  RpcSerializationError,
  RpcProtocolError,
  RpcContractError,
  RpcTransportError,
  RpcAuthenticationError,
  RpcChunkError,
  RpcRemoteError,
  RpcTimeoutError,
  IRpcError,
  IRpcCleanupError
} from '@migaia/rpc-contract/errors'
export { normalizeRpcPortable } from '@migaia/rpc-contract/portable'
export type { IRpcPortableValue } from '@migaia/rpc-contract/portable'
