/** Cooperative transport definitions join the same public Host and native installation boundary. */
export {
  coroutinePlugin,
  type ICoroutinePluginOptions,
  type ICoroutineCommonOptions,
  type ICoroutineNamespaceExtensions
} from './coroutine-plugin.js'
export type {
  ICoroutineConnect,
  ICoroutineUserTask,
  ICoroutineTaskContext,
  ICoroutineReplaceSpec
} from './coroutine-task.js'
export type { ICoroutineSupervisorPolicy } from './coroutine-source.js'
export {
  RpcCoroutineErrorCode,
  RPC_COROUTINE_ERROR_SOURCE,
  type IRpcCoroutineErrorCode
} from '@migaia/rpc-contract/error-code'
