/**
 * Publishes browser transport factories, their native source options and centralized browser error
 * identities.
 */
export { windowPlugin } from './browser/window-plugin.ts'
export { dedicatedWorkerPlugin } from './browser/dedicated-worker-plugin.ts'
export { sharedWorkerPlugin } from './browser/shared-worker-plugin.ts'
export { rtcDataChannelPlugin } from './browser/rtc-data-channel-plugin.ts'
export type {
  IWindowPluginOptions,
  IWorkerPluginOptions,
  ISharedWorkerPluginOptions,
  IRtcDataChannelPluginOptions
} from './browser/peer-types.ts'
export type { IBrowserPluginOptions } from './browser/plugin-types.ts'
export {
  RpcBrowserErrorCode,
  RPC_BROWSER_ERROR_SOURCE,
  type IRpcBrowserErrorCode
} from '@migaia/rpc-contract/error-code'
export { webTransportPlugin } from './browser/web-transport-plugin.ts'
export type { IWebTransportPluginOptions } from './browser/web-transport-types.ts'
export { serviceWorkerPlugin } from './browser/service-worker-plugin.ts'
export type { IServiceWorkerPluginOptions } from './browser/service-worker-types.ts'
export { broadcastChannelPlugin } from './browser/broadcast-channel-plugin.ts'
export type { IBroadcastChannelPluginOptions } from './browser/broadcast-channel-plugin.ts'
