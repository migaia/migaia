import type {
  IWebRpcAuthenticationCapability,
  IWebRpcChunkCapability,
  IWebRpcChunkConfig,
  IWebRpcConnectCapability,
  IWebRpcConnectConfig,
  IWebRpcContractCapability,
  IWebRpcContractConfig,
  IWebRpcFeatureConfig,
  IWebRpcHookEvent,
  IWebRpcHooksConfig,
  IWebRpcProtocolCapability,
  IWebRpcProtocolConfig,
  IWebRpcProviderLimits,
  IWebRpcTimeoutCapability,
  IWebRpcTimeoutConfig,
  IWebRpcUuidConfig
} from '../typing.js'

/** Canonical normalized endpoint options produced by middleware/config bootstrap. */
export type IWebRpcEndpointOptions<TTargetId extends string> = {
  contract?: IWebRpcContractConfig | IWebRpcContractCapability
  uuid?: IWebRpcUuidConfig
  protocol?: IWebRpcProtocolConfig | IWebRpcProtocolCapability
  authentication?: IWebRpcAuthenticationCapability
  timeout?: IWebRpcTimeoutConfig | IWebRpcTimeoutCapability
  hooks?: IWebRpcHooksConfig
  chunk?: IWebRpcChunkConfig | IWebRpcChunkCapability
  targetIds?: readonly TTargetId[]
  providerLimits?: IWebRpcProviderLimits
  connect?: IWebRpcConnectConfig | IWebRpcConnectCapability
  features?: IWebRpcFeatureConfig
  initialHookEvents?: readonly IWebRpcHookEvent[]
  replay?: { readonly maxEntries?: number; readonly ttlMs?: number }
}
