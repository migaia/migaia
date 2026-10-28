/** Pool scheduling is installed on the actual Host instead of constructing transport-specific Peers. */
export { pool } from './plugin.ts'
export type { IPoolExtensions } from './plugin.ts'
export {
  RpcPoolErrorCode,
  RPC_POOL_ERROR_SOURCE,
  type IRpcPoolErrorCode
} from '@migaia/rpc-contract/error-code'
export { RpcPoolState, RPC_POOL_PEER_ID } from './text.ts'
export type { IPoolPluginOptions, IRpcPoolStats, IRpcPoolControls } from './types.ts'
