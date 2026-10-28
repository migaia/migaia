/** Publishes the Devtools flow plugin, caller-owned collector types and Contract error identities. */
export { devtoolsPlugin, type IDevtoolsPlugin } from './plugin.ts'

export type { IRpcDevtools, IRpcDevtoolsOptions } from './collector-types.ts'
export {
  RpcDevtoolsErrorCode,
  RPC_DEVTOOLS_ERROR_SOURCE as RPC_DEVTOOLS_SOURCE,
  type IRpcDevtoolsErrorCode
} from '@migaia/rpc-contract/error-code'
