/**
 * Publishes the Thread transport factory, complete source types, child discovery and canonical
 * error identities. Native Worker acquisition stays behind the selected source recipe.
 */
export { threadPlugin } from './plugin.ts'
export type {
  IThreadPluginOptions,
  IThreadCommonOptions,
  IThreadSpawnSource,
  IThreadNamespaceExtensions
} from './plugin.ts'
export { isThreadChild } from './child.ts'
export {
  RpcThreadErrorCode,
  RPC_THREAD_ERROR_SOURCE,
  type IRpcThreadErrorCode
} from '@migaia/rpc-contract/error-code'

export type { IThreadSpawn } from './source.ts'
export type { IThreadShortSpawn } from './short-spawn.ts'
