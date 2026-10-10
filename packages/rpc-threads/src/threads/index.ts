export { createThreadPlugin } from './plugin.js'
export { createThreadPeer } from './peer.js'
export { createNodeThreadChannel, createWebThreadChannel } from './channel.js'
export { receiveThreadData, readThreadBootstrap } from './bootstrap.js'
export type {
  IThreadChannelFactory,
  IThreadChannelOptions,
  IThreadCommonOptions,
  IThreadPluginOptions,
  IThreadWebPort
} from './types.js'
export type { IThreadBootstrapData } from './bootstrap.js'

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
