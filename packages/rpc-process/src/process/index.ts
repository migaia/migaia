export { createProcessTransport, createAdapterChannel } from './handshake.js'
export { createProcessChannelClosedError } from './error.js'
export { openProcessObjectChannel } from './object-channel.js'
export { createProcessPeer } from './peer.js'
export { createNativeProcessOffer } from './offer.js'
export type { IProcessHostRegistrationApproval, IProcessHostRegistrations } from './host/types.js'
export {
  RpcProcessErrorCode,
  ERROR_SOURCE as RPC_PROCESS_ERROR_SOURCE,
  type IRpcProcessErrorCode
} from './error-code.js'
export { createProcessResilience } from './resilience/index.js'
export type {
  IProcessResilience,
  IProcessResilienceOptions,
  IProcessResilienceSnapshot,
  IProcessRegistration,
  IProcessRegistrationBinding,
  IProcessRegistrationListenOptions,
  IProcessRegistrationListener,
  IProcessLiquidationOwner,
  IProcessSessionIdentity,
  IProcessSessionLease
} from './resilience/types.js'
export {
  createProcessPlugin,
  parseProcessPluginDescriptor,
  ProcessPluginWire
} from './plugin/index.js'
export type {
  IProcessPluginOptions,
  IProcessPlugin,
  IProcessPluginReplaceResult,
  IProcessServeChildIngress,
  IProcessServeListenerIngress
} from './plugin/index.js'
export type { IProcessPluginDescriptor } from './plugin/index.js'
export type {
  IAuthenticatedProcessChannel,
  IListenProcessByteChannel,
  IProcessByteChannel,
  IProcessByteListener,
  IProcessByteOptions,
  IProcessCommonOptions,
  IProcessMessageChannel,
  IProcessMessageOptions,
  IProcessPendingByteConnection
} from './types.js'

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
  IRuntimeProcessStopOptions
} from '@migaia/rpc-core/remote'
export type { IRuntimeEvent } from '@migaia/rpc-core/remote'
export type { RuntimeEventName } from '@migaia/rpc-core/remote'

/** Former Core adapter operations now belong to this Process public entry. */
export { receiveAdapterBootstrap } from './bootstrap.js'
export { createAdapterWebByteIO } from './web-byte-stream.js'
export { createAdapterProcessLaunch } from './launch.js'
export type { IAdapterProcessLaunchContext, IAdapterProcessLaunchOptions } from './launch.js'
export type { IProcessRuntimeBootstrapOptions } from './runtime-bootstrap.js'
export { createAdapterProcessPeer } from './peer.js'
export type {
  IAdapterProcessRuntimeIO,
  IAdapterProcessRuntimeModule,
  IAdapterProcessRuntimeLoader
} from './peer.js'
export type { IRuntimeProcessPeerOptions } from './runtime-peer.js'
export { createAdapterProcessPlugin } from './plugin/operation.js'
export type { IRuntimeProcessPluginOptions } from './plugin/operation.js'
export {
  PROCESS_HANDSHAKE_MAX_FRAME_BYTES,
  PROCESS_RUNTIME_API_ENV,
  PROCESS_RUNTIME_API_ENV_VERSION,
  PROCESS_RUNTIME_API_BOOTSTRAP_KIND,
  PROCESS_RUNTIME_API_BOOTSTRAP_VERSION,
  PROCESS_RUNTIME_API_FINGERPRINT_PREFIX,
  PROCESS_RUNTIME_API_BOOTSTRAP_TIMEOUT_MS
} from './constants.js'

/** Preserve all user-level configuration types moved from the former Core Process entry. */
export type * from './resilience/types.js'
export type * from './plugin/types.js'
export type * from './host/types.js'
