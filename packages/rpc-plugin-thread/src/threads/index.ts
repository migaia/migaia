export { threadPlugin } from './plugin.js'
export type { IThreadPluginOptions, IThreadCommonOptions, IThreadSpawnSource } from './plugin.js'
export { isThreadChild } from './child.js'
export {
  RpcThreadErrorCode,
  ERROR_SOURCE as RPC_THREAD_ERROR_SOURCE,
  type IRpcThreadErrorCode
} from '../error-code.js'
