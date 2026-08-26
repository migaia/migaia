import type {
  IWebRpcAuthenticationCapability,
  IWebRpcConnectCapability,
  IWebRpcContractCapability,
  IWebRpcChunkCapability,
  IWebRpcDiscoveryCandidate,
  IWebRpcHookEvent,
  IWebRpcHook,
  IWebRpcPingOptions,
  IWebRpcProtocolCapability,
  IWebRpcTimeoutCapability,
  IWebRpcUuidConfig
} from '../typing.js'
import type { IWebRpcHookFailureReporter } from './hooks.js'
import type { IOutboundAttachmentHost } from './outbound-attachment.js'
import type { IInboundIdentityAdmission, IInboundIdentityRequest } from './inbound-identity.js'
import type { IVariationHandler } from './variation-coordinator.js'
import type { IWebRpcVariation } from '../protocol-constants.js'

/** Typed outbound owner port consumed by dependent feature descriptors. */
export type IWebRpcOutboundAttachmentPort = IOutboundAttachmentHost

/** Package-owned symbols prevent cross-endpoint and cross-package shared-port collisions. */
export const WebRpcSharedKey = Object.freeze({
  protocol: Symbol('web-rpc.shared.protocol'),
  authentication: Symbol('web-rpc.shared.authentication'),
  contract: Symbol('web-rpc.shared.contract'),
  connect: Symbol('web-rpc.shared.connect'),
  abort: Symbol('web-rpc.shared.abort-enable'),
  hooks: Symbol('web-rpc.shared.hooks'),
  timeout: Symbol('web-rpc.shared.timeout'),
  uuid: Symbol('web-rpc.shared.uuid'),
  chunk: Symbol('web-rpc.shared.chunk'),
  ping: Symbol('web-rpc.shared.ping-enable'),
  inboundIdentity: Symbol('web-rpc.shared.inbound-identity'),
  variationCoordinator: Symbol('web-rpc.shared.variation-coordinator'),
  outboundOperations: Symbol('web-rpc.shared.outbound-operations'),
  discoveryResolver: Symbol('web-rpc.shared.discovery-resolver'),
  candidatePing: Symbol('web-rpc.shared.candidate-ping'),
  providerCancellation: Symbol('web-rpc.shared.provider-cancellation'),
  time: Symbol('web-rpc.shared.time'),
  outboundAttachment: Symbol('web-rpc.shared.outbound-attachment')
} as const)

export type IWebRpcSharedKey = (typeof WebRpcSharedKey)[keyof typeof WebRpcSharedKey]

/** Stable protocol commands shared by protocol providers and frame consumers. */
export type IWebRpcProtocolPort = IWebRpcProtocolCapability

/** Authentication command shared by the authentication feature and sender. */
export type IWebRpcAuthenticationPort = IWebRpcAuthenticationCapability

/** Contract query shared by schema validation and request admission. */
export type IWebRpcContractPort = IWebRpcContractCapability

/** Transport connection facts shared by connection and discovery features. */
export type IWebRpcConnectPort = IWebRpcConnectCapability

/** Immutable internal hook snapshot shared during construction and successful runtime setup. */
export type IWebRpcHooksPort = {
  readonly listeners: readonly IWebRpcHook[]
  readonly onHookError?: IWebRpcHookFailureReporter
  readonly reportConstructionDiagnostic: (event: IWebRpcHookEvent) => void
}

/** Timeout resolver shared by timeout-aware feature operations. */
export type IWebRpcTimeoutPort = IWebRpcTimeoutCapability

/** Frozen middleware enablement shared with the finalizer; it owns no cancellation command. */
export type IWebRpcAbortEnablePort = { readonly enabled: true }

/** Frozen conditional ping enablement; it carries no heartbeat command or timer owner. */
export type IWebRpcPingEnablePort = { readonly enabled: true }

/** Canonical immutable shape used by the future native ping middleware publication. */
export const WebRpcPingEnablePortShape: IWebRpcPingEnablePort = Object.freeze({ enabled: true })

/** Identifier factory shared by request and response correlation owners. */
export type IWebRpcUuidPort = { readonly generate?: IWebRpcUuidConfig['generate'] }

/** Chunk framing commands shared by the chunk feature and sender. */
export type IWebRpcChunkPort = IWebRpcChunkCapability

/** Bounded provider command sent through the one outbound operation. */
export type IWebRpcOutboundCommand =
  | {
      readonly kind: 'response' | 'frame'
      readonly message: unknown
      readonly transfer?: readonly unknown[]
    }
  | {
      readonly kind: 'dispatch'
      readonly targetId: string
      readonly method: string
      readonly data: unknown
    }
  | {
      readonly kind: 'validate'
      readonly method: string
      readonly side: 'params' | 'result'
      readonly data: unknown
    }
  | {
      readonly kind: 'diagnostic'
      readonly event: Omit<IWebRpcHookEvent, 'at' | 'localId'>
    }
  | { readonly kind: 'report'; readonly error: unknown; readonly code?: string }

/** Commands whose canonical transport operation is asynchronous. */
export type IWebRpcResponseOutboundCommand = Extract<
  IWebRpcOutboundCommand,
  { readonly kind: 'response' | 'frame' }
>

/** Commands whose canonical owner must preserve synchronous throw timing. */
export type IWebRpcSynchronousOutboundCommand = Exclude<
  IWebRpcOutboundCommand,
  IWebRpcResponseOutboundCommand
>

/** One bounded operation with command-specific result timing. */
export type IWebRpcOutboundSend = {
  (command: IWebRpcResponseOutboundCommand): Promise<void>
  (command: IWebRpcSynchronousOutboundCommand): void
}

/** Bounded source-admission and binding commands for the one identity operation. */
export type IWebRpcIdentityCommand =
  | { readonly operation: 'admit'; readonly request: IInboundIdentityRequest }
  | { readonly operation: 'retain' | 'release'; readonly token: string }

/** Exact inbound identity operation; request admission remains owned by the outbound feature. */
export type IWebRpcInboundIdentityPort = {
  readonly verify: (
    command: IWebRpcIdentityCommand
  ) => Promise<IInboundIdentityAdmission | undefined> | boolean | void
}

/** One provider operation admitted through the exact variation `admit` operation. */
export type IWebRpcVariationAdmissionRequest =
  | {
      readonly operation: 'register'
      readonly variation: IWebRpcVariation
      readonly handler: IVariationHandler
    }
  | { readonly operation: 'consumeAbort'; readonly key: string }
  | {
      readonly operation: 'abort'
      readonly key: string
      readonly controller: AbortController | undefined
      readonly expiresAt: number
    }

/** Exact variation admission operation; no second variation owner is published. */
export type IWebRpcVariationCoordinatorPort = {
  readonly admit: (request: IWebRpcVariationAdmissionRequest) => boolean | (() => void) | void
}

/** Exact D87 outbound operation; provider dispatch uses the existing send owner. */
export type IWebRpcOutboundOperationsPort = {
  readonly send: IWebRpcOutboundSend
}

/** Discovery-backed receiver selection shared with the canonical outbound sender. */
export type IWebRpcDiscoveryResolverPort = {
  readonly resolve: (id: string) => Promise<{
    readonly receiverId: string
    readonly verifiedPeerKey?: string
  }>
}

/** Candidate probe delegated to the canonical control attachment and its one ping state owner. */
export type IWebRpcCandidatePingPort = {
  readonly ping: (
    candidate: IWebRpcDiscoveryCandidate<string>,
    options?: IWebRpcPingOptions
  ) => Promise<boolean>
}

/** Provider cancellation command shared by provider and control owners. */
export type IWebRpcProviderCancellationPort = { readonly abort: (id: string) => void }

/** One endpoint-owned timer handle shared with discovery expiry scheduling. */
export type IWebRpcEndpointTimer = { readonly clear: () => void }

/** Endpoint clock and timer operations shared with construction-aware features. */
export type IWebRpcTimePort = {
  readonly now: () => number
  readonly setTimeout: (task: () => void, delayMs: number) => IWebRpcEndpointTimer
  readonly clearTimeout: (timer: IWebRpcEndpointTimer) => void
}

/** Typed slot map used by PluginHost shared providers and consumers. */
export type IWebRpcSharedValues = {
  readonly [WebRpcSharedKey.protocol]?: IWebRpcProtocolPort
  readonly [WebRpcSharedKey.authentication]?: IWebRpcAuthenticationPort
  readonly [WebRpcSharedKey.contract]?: IWebRpcContractPort
  readonly [WebRpcSharedKey.connect]?: IWebRpcConnectPort
  readonly [WebRpcSharedKey.abort]?: IWebRpcAbortEnablePort
  readonly [WebRpcSharedKey.ping]?: IWebRpcPingEnablePort
  readonly [WebRpcSharedKey.hooks]?: IWebRpcHooksPort
  readonly [WebRpcSharedKey.timeout]?: IWebRpcTimeoutPort
  readonly [WebRpcSharedKey.uuid]?: IWebRpcUuidPort
  readonly [WebRpcSharedKey.chunk]?: IWebRpcChunkPort
  readonly [WebRpcSharedKey.inboundIdentity]?: IWebRpcInboundIdentityPort
  readonly [WebRpcSharedKey.variationCoordinator]?: IWebRpcVariationCoordinatorPort
  readonly [WebRpcSharedKey.outboundOperations]?: IWebRpcOutboundOperationsPort
  readonly [WebRpcSharedKey.discoveryResolver]?: IWebRpcDiscoveryResolverPort
  readonly [WebRpcSharedKey.candidatePing]?: IWebRpcCandidatePingPort
  readonly [WebRpcSharedKey.providerCancellation]?: IWebRpcProviderCancellationPort
  readonly [WebRpcSharedKey.time]?: IWebRpcTimePort
  readonly [WebRpcSharedKey.outboundAttachment]?: IOutboundAttachmentHost
}
