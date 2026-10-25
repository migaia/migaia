/**
 * Publishes browser transport factories, their native source options and centralized browser error
 * identities.
 */
export { windowPlugin } from './browser/window-plugin.js'
export { dedicatedWorkerPlugin } from './browser/dedicated-worker-plugin.js'
export { sharedWorkerPlugin } from './browser/shared-worker-plugin.js'
export { rtcDataChannelPlugin } from './browser/rtc-data-channel-plugin.js'
export type {
  IWindowPluginOptions,
  IWorkerPluginOptions,
  ISharedWorkerPluginOptions,
  IRtcDataChannelPluginOptions
} from './browser/peer-types.js'
export type { IBrowserPluginOptions } from './browser/plugin-types.js'
export {
  RpcBrowserErrorCode,
  RPC_BROWSER_ERROR_SOURCE,
  type IRpcBrowserErrorCode
} from '@migaia/rpc-contract/error-code'
export { webTransportPlugin } from './browser/web-transport-plugin.js'
export type { IWebTransportPluginOptions } from './browser/web-transport-types.js'
export { serviceWorkerPlugin } from './browser/service-worker-plugin.js'
export type { IServiceWorkerPluginOptions } from './browser/service-worker-types.js'
export { broadcastChannelPlugin } from './browser/broadcast-channel-plugin.js'
export type { IBroadcastChannelPluginOptions } from './browser/broadcast-channel-plugin.js'
