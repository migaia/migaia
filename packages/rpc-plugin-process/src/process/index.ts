export { processPlugin } from './plugin.js'
export type {
  IProcessPluginOptions,
  IProcessPluginCommonOptions,
  IProcessSpawnSource,
  IProcessConnectSource,
  IProcessListenSource
} from './plugin.js'
export type {
  IProcessLaunchCommand,
  IProcessShortSpawn,
  IProcessShortSourceOptions
} from './adapters/short-source.js'
export { isProcessChild } from './child.js'
export {
  RpcProcessErrorCode,
  ERROR_SOURCE as RPC_PROCESS_ERROR_SOURCE,
  type IRpcProcessErrorCode
} from './error-code.js'
