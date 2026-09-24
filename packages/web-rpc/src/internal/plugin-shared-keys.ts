import type {
  IWebRpcAuthenticationCapability,
  IWebRpcConnectCapability,
  IWebRpcContractCapability,
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
import type { IWebRpcVariation } from '../semantic-constants.js'
import type { IRpcEnvelope } from '@migaia/rpc-contract'

/** Typed outbound owner port consumed by dependent feature descriptors. */
export type IWebRpcOutboundAttachmentPort = IOutboundAttachmentHost

/** Stable Feature names for the seventeen package-owned middleware ports. */
export const WebRpcPortName = Object.freeze({
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

export type IWebRpcPortName = (typeof WebRpcPortName)[keyof typeof WebRpcPortName]

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

/** Bounded provider command sent through the one outbound operation. */
export type IWebRpcOutboundCommand =
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
      readonly event: Omit<IWebRpcHookEvent, 'at' | 'localId'>
    }
  | { readonly kind: 'report'; readonly error: unknown; readonly code?: string }

/** Commands whose canonical transport operation is asynchronous. */
export type IWebRpcResponseOutboundCommand = Extract<
  IWebRpcOutboundCommand,
  { readonly kind: 'response' | 'frame' | 'one-way' }
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
      readonly reason: unknown
    }

/** Exact variation admission operation; no second variation owner is published. */
export type IWebRpcVariationCoordinatorPort = {
  readonly admit: (
    request: IWebRpcVariationAdmissionRequest
  ) => boolean | { readonly found: boolean; readonly reason: unknown } | (() => void) | void
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
export type IWebRpcPortValues = {
  readonly [WebRpcPortName.protocol]?: IWebRpcProtocolPort
  readonly [WebRpcPortName.authentication]?: IWebRpcAuthenticationPort
  readonly [WebRpcPortName.contract]?: IWebRpcContractPort
  readonly [WebRpcPortName.connect]?: IWebRpcConnectPort
  readonly [WebRpcPortName.abort]?: IWebRpcAbortEnablePort
  readonly [WebRpcPortName.ping]?: IWebRpcPingEnablePort
  readonly [WebRpcPortName.hooks]?: IWebRpcHooksPort
  readonly [WebRpcPortName.timeout]?: IWebRpcTimeoutPort
  readonly [WebRpcPortName.uuid]?: IWebRpcUuidPort
  readonly [WebRpcPortName.inboundIdentity]?: IWebRpcInboundIdentityPort
  readonly [WebRpcPortName.variationCoordinator]?: IWebRpcVariationCoordinatorPort
  readonly [WebRpcPortName.outboundOperations]?: IWebRpcOutboundOperationsPort
  readonly [WebRpcPortName.discoveryResolver]?: IWebRpcDiscoveryResolverPort
  readonly [WebRpcPortName.candidatePing]?: IWebRpcCandidatePingPort
  readonly [WebRpcPortName.providerCancellation]?: IWebRpcProviderCancellationPort
  readonly [WebRpcPortName.time]?: IWebRpcTimePort
  readonly [WebRpcPortName.outboundAttachment]?: IOutboundAttachmentHost
}
