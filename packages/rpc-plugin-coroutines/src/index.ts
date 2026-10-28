/** Cooperative transport definitions join the same public Host and native installation boundary. */
export {
  coroutinePlugin,
  type ICoroutinePluginOptions,
  type ICoroutineCommonOptions,
  type ICoroutineNamespaceExtensions
} from './coroutine-plugin.ts'
export type {
  ICoroutineConnect,
  ICoroutineUserTask,
  ICoroutineTaskContext,
  ICoroutineReplaceSpec
} from './coroutine-task.ts'
export type { ICoroutineSupervisorPolicy } from './coroutine-source.ts'
export {
  RpcCoroutineErrorCode,
  RPC_COROUTINE_ERROR_SOURCE,
  type IRpcCoroutineErrorCode
} from '@migaia/rpc-contract/error-code'
