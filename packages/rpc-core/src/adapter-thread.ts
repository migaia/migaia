/** Complete Thread resource operations own capability admission and private launch preparation. */
export {
  createAdapterNodeThreadChannel,
  createAdapterWebThreadChannel
} from './adapter-owned/threads/channel.js'
export { createThreadPeer } from './adapter-owned/threads/peer.js'
export { createThreadPlugin } from './adapter-owned/threads/plugin.js'
export { createAdapterNodeThreadPeer } from './adapter-owned/threads/node-peer.js'
export {
  createAdapterNodeThreadLauncher,
  createAdapterNodeThreadChannelFactory
} from './adapter-owned/threads/node-launcher.js'
export {
  createAdapterWebThreadLauncher,
  createAdapterWebThreadChannelFactory
} from './adapter-owned/threads/web-launcher.js'
export { receiveThreadData, readThreadBootstrap } from './adapter-owned/threads/bootstrap.js'
export type { IThreadBootstrapData } from './adapter-owned/threads/bootstrap.js'
export type {
  IThreadRuntimeResource,
  IThreadParentPort,
  IThreadNativeWorker,
  IThreadNativeWorkerConstructor,
  IThreadNativeRuntimeModule
} from './adapter-owned/threads/runtime-resource.js'
export type {
  IRuntimeThreadPeerOptions,
  IRuntimeThreadSpawn
} from './adapter-owned/threads/runtime-peer.js'
export type { IRuntimeThreadPluginOptions } from './adapter-owned/threads/plugin.js'
export type {
  IThreadChannelFactory,
  IThreadChannelOptions,
  IThreadCommonOptions,
  IThreadPluginOptions,
  IThreadWebPort
} from './adapter-owned/threads/types.js'
export type {
  INodeThreadHandle,
  IAdapterNodeThreadHandle
} from './adapter-owned/threads/node-launcher.js'
export type {
  IWebThreadHandle,
  IAdapterWebThreadHandle,
  IWebThreadWorker,
  IWebThreadLauncherOptions
} from './adapter-owned/threads/web-launcher.js'
/** Classify a held Worker sampling failure without importing a private error constructor. */
export {
  ERROR_SOURCE as RPC_THREAD_ERROR_SOURCE,
  RpcThreadErrorCode,
  type IRpcThreadErrorCode
} from './adapter-owned/threads/error-code.js'
/** Borrow a complete native parent-channel resource without eager listeners or public registrars. */
export { AdapterNodeThreadParentChannel } from './adapter-owned/threads/node-parent.js'
