export { createProcessTransport } from './handshake.js'
export { createProcessPeer } from './peer.js'
export { createNativeProcessOffer } from './offer.js'
export type {
  IProcessHostRegistrationApproval,
  IProcessHostRegistrations
} from '@migaia/rpc-core/adapter/process'
export {
  RpcProcessErrorCode,
  ERROR_SOURCE as RPC_PROCESS_ERROR_SOURCE,
  type IRpcProcessErrorCode
} from './error-code.js'
export { createProcessResilience } from '@migaia/rpc-core/adapter/process'
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
} from '@migaia/rpc-core/adapter/process'
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
