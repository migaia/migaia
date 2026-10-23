/** Cooperative transport definitions join the same public Host and native installation boundary. */
export { coroutinePlugin, type ICoroutinePluginOptions } from './coroutine-plugin.js'
export type {
  ICoroutineConnect,
  ICoroutineUserTask,
  ICoroutineTaskContext,
  ICoroutineReplaceSpec
} from './coroutine-task.js'
export type { ICoroutineSupervisorPolicy } from './coroutine-binding.js'
export {
  RpcCoroutineErrorCode,
  ERROR_SOURCE as RPC_COROUTINE_ERROR_SOURCE,
  type IRpcCoroutineErrorCode
} from './error-code.js'
