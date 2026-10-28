/**
 * Publishes the Process transport factory, native source recipes, child discovery and centralized
 * error identities. Runtime acquisition stays in the corresponding native modules.
 */
export { processPlugin } from './plugin.ts'
export type {
  IProcessPluginOptions,
  IProcessPluginCommonOptions,
  IProcessSpawnSource,
  IProcessConnectSource,
  IProcessListenSource,
  IProcessNamespaceExtensions
} from './plugin.ts'
export type {
  IProcessLaunchCommand,
  IProcessShortSpawn,
  IProcessShortSourceOptions
} from './adapters/short-source.ts'
export { isProcessChild } from './child.ts'
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
} from './plugin/types.ts'
