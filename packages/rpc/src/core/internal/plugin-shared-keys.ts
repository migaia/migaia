import type {
  IRpcAuthenticationCapability,
  IRpcConnectCapability,
  IRpcContractCapability,
  IRpcDiscoveryCandidate,
  IRpcHookEvent,
  IRpcHook,
  IRpcPingOptions,
  IRpcProtocolCapability,
  IRpcTimeoutCapability,
  IRpcUuidConfig
} from '../typing.js'
import type { IRpcHookFailureReporter } from './hooks.js'
import type { IOutboundAttachmentHost } from './outbound-attachment.js'
import type { IInboundIdentityAdmission, IInboundIdentityRequest } from './inbound-identity.js'
import type { IVariationHandler } from './variation-coordinator.js'
import type { IRpcVariation } from '../semantic-constants.js'
import type { IRpcEnvelope } from '../../contract/index.js'

/** Typed outbound owner port consumed by dependent feature descriptors. */
export type IRpcOutboundAttachmentPort = IOutboundAttachmentHost

/** Stable Feature names for the seventeen package-owned middleware ports. */
export const RpcPortName = Object.freeze({
  protocol: 'protocol',
  authentication: 'authentication',
  contract: 'contract',
  connect: 'connect',
  abort: 'abort',
  hooks: 'hooks',
  timeout: 'timeout',
  uuid: 'uuid',
  ping: 'ping',
  inboundIdentity: 'inboundIdentity',
  variationCoordinator: 'variationCoordinator',
  outboundOperations: 'outboundOperations',
  discoveryResolver: 'discoveryResolver',
  candidatePing: 'candidatePing',
  providerCancellation: 'providerCancellation',
  time: 'time',
  outboundAttachment: 'outboundAttachment'
} as const)

export type IRpcPortName = (typeof RpcPortName)[keyof typeof RpcPortName]

/** Stable protocol commands shared by protocol providers and frame consumers. */
export type IRpcProtocolPort = IRpcProtocolCapability

/** Authentication command shared by the authentication feature and sender. */
export type IRpcAuthenticationPort = IRpcAuthenticationCapability

/** Contract query shared by schema validation and request admission. */
export type IRpcContractPort = IRpcContractCapability

/** Transport connection facts shared by connection and discovery features. */
export type IRpcConnectPort = IRpcConnectCapability

/** Immutable internal hook snapshot shared during construction and successful runtime setup. */
export type IRpcHooksPort = {
  readonly listeners: readonly IRpcHook[]
  readonly onHookError?: IRpcHookFailureReporter
  readonly reportConstructionDiagnostic: (event: IRpcHookEvent) => void
}

/** Timeout resolver shared by timeout-aware feature operations. */
export type IRpcTimeoutPort = IRpcTimeoutCapability

/** Frozen middleware enablement shared with the finalizer; it owns no cancellation command. */
export type IRpcAbortEnablePort = { readonly enabled: true }

/** Frozen conditional ping enablement; it carries no heartbeat command or timer owner. */
export type IRpcPingEnablePort = { readonly enabled: true }

/** Canonical immutable shape used by the future native ping middleware publication. */
export const RpcPingEnablePortShape: IRpcPingEnablePort = Object.freeze({ enabled: true })

/** Identifier factory shared by request and response correlation owners. */
export type IRpcUuidPort = { readonly generate?: IRpcUuidConfig['generate'] }

/** Bounded provider command sent through the one outbound operation. */
export type IRpcOutboundCommand =
  | {
      readonly kind: 'response' | 'frame'
      readonly message: IRpcEnvelope
      readonly transfer?: readonly unknown[]
    }
  | {
      readonly kind: 'dispatch'
      readonly targetId: string
      readonly method: string
      readonly data: unknown
    }
  | {
      /** One-way delivery waits for physical pipeline completion without response settlement. */
      readonly kind: 'one-way'
      readonly targetId: string
      readonly method: string
      readonly data: unknown
      readonly transfer?: readonly unknown[]
    }
  | {
      readonly kind: 'validate'
      readonly method: string
      readonly side: 'params' | 'result'
      readonly data: unknown
    }
  | {
      readonly kind: 'diagnostic'
      readonly event: Omit<IRpcHookEvent, 'at' | 'localId'>
    }
  | { readonly kind: 'report'; readonly error: unknown; readonly code?: string }

/** Commands whose canonical transport operation is asynchronous. */
export type IRpcResponseOutboundCommand = Extract<
  IRpcOutboundCommand,
  { readonly kind: 'response' | 'frame' | 'one-way' }
>

/** Commands whose canonical owner must preserve synchronous throw timing. */
export type IRpcSynchronousOutboundCommand = Exclude<
  IRpcOutboundCommand,
  IRpcResponseOutboundCommand
>

/** One bounded operation with command-specific result timing. */
export type IRpcOutboundSend = {
  (command: IRpcResponseOutboundCommand): Promise<void>
  (command: IRpcSynchronousOutboundCommand): void
}

/** Bounded source-admission and binding commands for the one identity operation. */
export type IRpcIdentityCommand =
  | { readonly operation: 'admit'; readonly request: IInboundIdentityRequest }
  | { readonly operation: 'retain' | 'release'; readonly token: string }

/** Exact inbound identity operation; request admission remains owned by the outbound feature. */
export type IRpcInboundIdentityPort = {
  readonly verify: (
    command: IRpcIdentityCommand
  ) => Promise<IInboundIdentityAdmission | undefined> | boolean | void
}

/** One provider operation admitted through the exact variation `admit` operation. */
export type IRpcVariationAdmissionRequest =
  | {
      readonly operation: 'register'
      readonly variation: IRpcVariation
      readonly handler: IVariationHandler
    }
  | { readonly operation: 'consumeAbort'; readonly key: string }
  | {
      readonly operation: 'abort'
      readonly key: string
      readonly controller: AbortController | undefined
      readonly expiresAt: number
      readonly reason: unknown
    }

/** Exact variation admission operation; no second variation owner is published. */
export type IRpcVariationCoordinatorPort = {
  readonly admit: (
    request: IRpcVariationAdmissionRequest
  ) => boolean | { readonly found: boolean; readonly reason: unknown } | (() => void) | void
}

/** Exact D87 outbound operation; provider dispatch uses the existing send owner. */
export type IRpcOutboundOperationsPort = {
  readonly send: IRpcOutboundSend
}

/** Discovery-backed receiver selection shared with the canonical outbound sender. */
export type IRpcDiscoveryResolverPort = {
  readonly resolve: (id: string) => Promise<{
    readonly receiverId: string
    readonly verifiedPeerKey?: string
  }>
}

/** Candidate probe delegated to the canonical control attachment and its one ping state owner. */
export type IRpcCandidatePingPort = {
  readonly ping: (
    candidate: IRpcDiscoveryCandidate<string>,
    options?: IRpcPingOptions
  ) => Promise<boolean>
}

/** Provider cancellation command shared by provider and control owners. */
export type IRpcProviderCancellationPort = { readonly abort: (id: string) => void }

/** One endpoint-owned timer handle shared with discovery expiry scheduling. */
export type IRpcEndpointTimer = { readonly clear: () => void }

/** Endpoint clock and timer operations shared with construction-aware features. */
export type IRpcTimePort = {
  readonly now: () => number
  readonly setTimeout: (task: () => void, delayMs: number) => IRpcEndpointTimer
  readonly clearTimeout: (timer: IRpcEndpointTimer) => void
}

/** Typed slot map used by PluginHost shared providers and consumers. */
export type IRpcPortValues = {
  readonly [RpcPortName.protocol]?: IRpcProtocolPort
  readonly [RpcPortName.authentication]?: IRpcAuthenticationPort
  readonly [RpcPortName.contract]?: IRpcContractPort
  readonly [RpcPortName.connect]?: IRpcConnectPort
  readonly [RpcPortName.abort]?: IRpcAbortEnablePort
  readonly [RpcPortName.ping]?: IRpcPingEnablePort
  readonly [RpcPortName.hooks]?: IRpcHooksPort
  readonly [RpcPortName.timeout]?: IRpcTimeoutPort
  readonly [RpcPortName.uuid]?: IRpcUuidPort
  readonly [RpcPortName.inboundIdentity]?: IRpcInboundIdentityPort
  readonly [RpcPortName.variationCoordinator]?: IRpcVariationCoordinatorPort
  readonly [RpcPortName.outboundOperations]?: IRpcOutboundOperationsPort
  readonly [RpcPortName.discoveryResolver]?: IRpcDiscoveryResolverPort
  readonly [RpcPortName.candidatePing]?: IRpcCandidatePingPort
  readonly [RpcPortName.providerCancellation]?: IRpcProviderCancellationPort
  readonly [RpcPortName.time]?: IRpcTimePort
  readonly [RpcPortName.outboundAttachment]?: IOutboundAttachmentHost
}
