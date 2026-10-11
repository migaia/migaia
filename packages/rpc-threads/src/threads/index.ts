export { createThreadPlugin } from './plugin.js'
export { createThreadPeer } from './peer.js'
export { createNodeThreadChannel, createWebThreadChannel } from './channel.js'
export { receiveThreadData, readThreadBootstrap } from './bootstrap.js'
export {
  RpcThreadErrorCode,
  ERROR_SOURCE as RPC_THREAD_ERROR_SOURCE,
  type IRpcThreadErrorCode
} from '../error-code.js'
export type {
  IThreadChannelFactory,
  IThreadChannelOptions,
  IThreadCommonOptions,
  IThreadPluginOptions,
  IThreadWebPort
} from './types.js'
export type { IThreadBootstrapData } from './bootstrap.js'
/** Existing user-level thread source configuration moved from Core's retired thread adapter entry. */
export type { IRuntimeThreadPeerOptions, IRuntimeThreadSpawn } from './runtime-peer.js'
/** Symmetric Plugin configuration belongs to the Thread owner that launches its native resource. */
export type { IRuntimeThreadPluginOptions } from './plugin.js'
/** Borrow the original parent port through the same complete Thread channel operation. */
export { AdapterNodeThreadParentChannel } from './node-parent.js'
/**
 * Advanced native launch retains the caller's actual runtime loader, rather than forcing Node
 * discovery.
 */
export { createAdapterNodeThreadLauncher } from './node-launcher.js'
/** Advanced child setup consumes the actual held parent port and raw native initial message. */
export { createAdapterNodeThreadPeer } from './node-peer.js'
/**
 * Generic Web runtime operations retain the caller's actual constructor and original channel
 * opening.
 */
export {
  createAdapterWebThreadLauncher as createWebThreadLauncher,
  createAdapterWebThreadChannelFactory as createWebThreadChannelFactory
} from './web-launcher.js'
/** Public raw runtime inputs move with their owning advanced Thread operations. */
export type {
  IThreadRuntimeResource,
  IThreadParentPort,
  IThreadNativeWorker,
  IThreadNativeWorkerConstructor,
  IThreadNativeRuntimeModule
} from './runtime-types.js'
/** Exact constructed native handles keep their own Core-resource open operation. */
export type { INodeThreadHandle, IAdapterNodeThreadHandle } from './node-launcher.js'
/** Public Web preparation and constructor shapes retain their original owner and readiness contract. */
export type {
  IWebThreadHandle,
  IAdapterWebThreadHandle,
  IWebThreadWorker,
  IWebThreadLauncherOptions
} from './web-launcher.js'

export type {
  IRuntimeSurface,
  IRuntimeDynamicSurface,
  IRuntimeTypedPeer
} from '@migaia/rpc-core/remote'

export type {
  IRuntimeQueryOptions,
  IRuntimeUnavailable,
  IRuntimeDetail,
  IRuntimeConnectionDetail,
  IRuntimeOverview,
  IRuntimeRecent
} from '@migaia/rpc-core/remote'

export type {
  IRuntimeListFilter,
  IRuntimeListOptions,
  IRuntimeThreadStopOptions
} from '@migaia/rpc-core/remote'
export type { IRuntimeEvent } from '@migaia/rpc-core/remote'
export type { RuntimeEventName } from '@migaia/rpc-core/remote'
