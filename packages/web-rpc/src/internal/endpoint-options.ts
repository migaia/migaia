import type {
  IWebRpcAuthenticationCapability,
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
import type { IRpcEnvelope, IRpcFramer, IRpcProtocol } from '@migaia/rpc-contract'
import type { IRpcBoundFrameIngress } from '@migaia/rpc-contract/framing'
import type { ICodec } from '@migaia/serialize/codec'

/** Immutable descriptor snapshot consumed by the one composed endpoint pipeline. */
export type IWebRpcSelectedComponents = Readonly<{
  readonly protocol: IRpcProtocol<IRpcEnvelope, string, number>
  readonly codec: ICodec<IRpcEnvelope, unknown>
  readonly framer: IRpcFramer<unknown, unknown, string, number>
  /** Captured native ingress preparation; binding never requires a construction-time frame call. */
  readonly ingressPrepare: IRpcBoundFrameIngress<unknown>
  readonly shadowed: readonly Readonly<{
    readonly component: string
    readonly winner: object
    readonly shadowed: object
  }>[]
}>

/** Canonical normalized endpoint options produced by middleware/config bootstrap. */
export type IWebRpcEndpointOptions<TTargetId extends string> = {
  /** Descriptors selected once before Host installation drives the canonical byte pipeline. */
  components?: IWebRpcSelectedComponents
  contract?: IWebRpcContractConfig | IWebRpcContractCapability
  uuid?: IWebRpcUuidConfig
  protocol?: IWebRpcProtocolConfig | IWebRpcProtocolCapability
  authentication?: IWebRpcAuthenticationCapability
  timeout?: IWebRpcTimeoutConfig | IWebRpcTimeoutCapability
  hooks?: IWebRpcHooksConfig
  targetIds?: readonly TTargetId[]
  providerLimits?: IWebRpcProviderLimits
  connect?: IWebRpcConnectConfig | IWebRpcConnectCapability
  features?: IWebRpcFeatureConfig
  initialHookEvents?: readonly IWebRpcHookEvent[]
  replay?: { readonly maxEntries?: number; readonly ttlMs?: number }
}
