import type {
  IRpcAuthenticationCapability,
  IRpcConnectCapability,
  IRpcConnectConfig,
  IRpcContractCapability,
  IRpcContractConfig,
  IRpcFeatureConfig,
  IRpcHookEvent,
  IRpcHooksConfig,
  IRpcProtocolCapability,
  IRpcProtocolConfig,
  IRpcProviderLimits,
  IRpcIdempotencyConfig,
  IRpcTimeoutCapability,
  IRpcTimeoutConfig,
  IRpcUuidConfig
} from '../typing.js'
import type { IRpcEnvelope, IRpcFramer, IRpcProtocol } from '../../contract/index.js'
import type { IRpcBoundFrameIngress } from '../../contract/framing/index.js'
import type { ICodec } from '@migaia/serialize/codec'
import type { IScheduler, IWallClock } from '@migaia/utils/scheduler'

/** Immutable descriptor snapshot consumed by the one composed endpoint pipeline. */
export type IRpcSelectedComponents = Readonly<{
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
export type IRpcEndpointOptions<TTargetId extends string> = {
  /** Original caller scheduler, preserved without copying for endpoint and Host ownership. */
  injectedScheduler?: IScheduler
  /** Original caller wall clock, preserved without copying; only stamps diagnostics. */
  injectedWallClock?: IWallClock
  /** Descriptors selected once before Host installation drives the canonical byte pipeline. */
  components?: IRpcSelectedComponents
  contract?: IRpcContractConfig | IRpcContractCapability
  uuid?: IRpcUuidConfig
  protocol?: IRpcProtocolConfig | IRpcProtocolCapability
  authentication?: IRpcAuthenticationCapability
  timeout?: IRpcTimeoutConfig | IRpcTimeoutCapability
  hooks?: IRpcHooksConfig
  targetIds?: readonly TTargetId[]
  providerLimits?: IRpcProviderLimits
  idempotency?: IRpcIdempotencyConfig
  connect?: IRpcConnectConfig | IRpcConnectCapability
  features?: IRpcFeatureConfig
  initialHookEvents?: readonly IRpcHookEvent[]
  replay?: { readonly maxEntries?: number; readonly ttlMs?: number }
}
