/**
 * Process adapters supply actual runtime stdio and launcher resources. These whole operations own
 * bootstrap, peer/Plugin preparation, sessions, provider admission and binding drain in Core. A
 * third-party adapter implements discovery/open on its own I/O and passes its loader to the peer
 * constructor; copied labels or callbacks cannot register another transport's trust facts.
 */
export { createAdapterProcessPeer } from './adapter-owned/process/peer.js'
export type {
  IAdapterProcessRuntimeIO,
  IAdapterProcessRuntimeModule,
  IAdapterProcessRuntimeLoader
} from './adapter-owned/process/peer.js'
export { createAdapterProcessPlugin } from './adapter-owned/process/plugin/client.js'
export type { IRuntimeProcessPluginOptions } from './adapter-owned/process/plugin/client.js'
export { createAdapterProcessLaunch } from './adapter-owned/process/launch.js'
export type {
  IAdapterProcessLaunchContext,
  IAdapterProcessLaunchOptions
} from './adapter-owned/process/launch.js'
export type { IProcessRuntimeBootstrapOptions } from './adapter-owned/process/runtime-bootstrap.js'
export type { IRuntimeProcessPeerOptions } from './adapter-owned/process/runtime-peer.js'
export { createNativeProcessOffer } from './adapter-owned/process/offer.js'
export { createProcessResilience } from './adapter-owned/process/resilience/index.js'
export type * from './adapter-owned/process/resilience/types.js'
export type * from './adapter-owned/process/plugin/types.js'
export type * from './adapter-owned/process/host/types.js'
export { parseProcessPluginDescriptor } from './adapter-owned/process/plugin/descriptor.js'
export type { IProcessPluginDescriptor } from './adapter-owned/process/plugin/descriptor.js'
export { ProcessPluginWire } from './adapter-owned/process/plugin/constants.js'
