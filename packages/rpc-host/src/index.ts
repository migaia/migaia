/** One native host projects every RPC call under its installed transport namespace. */
export { createRpcHost } from './host/create-rpc-host.js'
export type { IRpcHost, IRpcHostOptions } from './host/public.js'
export type {
  IRpcNamespace,
  IRpcCallOptions,
  IRpcNotifyOptions,
  IRpcFanoutResult
} from './namespace/types.js'
export type {
  IRpcContext,
  IRpcProvide,
  IRpcProvider,
  IRpcProviderMethod
} from './dispatch/types.js'
/** Public error diagnostics retain their actual contract-owned class identities. */
export {
  RpcLifecycleError,
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
  RpcConstructionError,
  RpcSerializationError,
  RpcProtocolError,
  RpcContractError,
  RpcTransportError,
  RpcAuthenticationError,
  RpcChunkError,
  RpcRemoteError,
  RpcAbortError,
  RpcTimeoutError,
  IRpcError,
  IRpcCleanupError
} from '@migaia/rpc-contract/errors'
export { defaultRpcReporter } from './host/report.js'
