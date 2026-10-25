/**
 * Publishes the Process transport factory, native source recipes, child discovery and centralized
 * error identities. Runtime acquisition stays in the corresponding native modules.
 */
export { processPlugin } from './plugin.js'
export type {
  IProcessPluginOptions,
  IProcessPluginCommonOptions,
  IProcessSpawnSource,
  IProcessConnectSource,
  IProcessListenSource,
  IProcessNamespaceExtensions
} from './plugin.js'
export type {
  IProcessLaunchCommand,
  IProcessShortSpawn,
  IProcessShortSourceOptions
} from './adapters/short-source.js'
export { isProcessChild } from './child.js'
export {
  RpcProcessErrorCode,
  RPC_PROCESS_ERROR_SOURCE,
  type IRpcProcessErrorCode
} from '@migaia/rpc-contract/error-code'

export type {
  IProcessFeature,
  ISpawnProcessPluginDeployment,
  IConnectProcessPluginDeployment,
  IProcessServeChildIngress,
  IProcessServeListenerIngress
} from './plugin/types.js'
