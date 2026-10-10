import type { IRpcProviderRejection } from './provider-admission.js'
import type {
  RpcProviderRejectionReason,
  RpcReplayCapacityNamespace
} from './semantic-constants.js'
import type { IRpcError } from './errors.js'
import type { IRpcTransport } from './transport.js'
import type { IRpcFeature } from './feature.js'
import type { IRpcMiddlewareComponentContribution, IRpcNativeMiddleware } from './middleware.js'
import type { IRpcEnvelope, IRpcFramer, IRpcProtocol } from '../contract/index.js'
import type { IRpcIdempotencyStore } from './idempotency-store.js'
import type { ICodec } from '@migaia/serialize/codec'
import type { IRpcPlatformValue as IProtocolWebRpcPlatform } from './transport-constants.js'
import type { IRpcCandidateStatus, IRpcOperation } from './transport-constants.js'

export type IRpcProviderResult =
  | { readonly ok: true; readonly data?: unknown; readonly transfer?: readonly unknown[] }
  | { readonly ok: false; readonly message: string; readonly code: string }
export type IRpcContext = {
  /** Present only after generation@1 directory admission for this actual runtime-profile task. */
  readonly callerGeneration?: import('../contract/index.js').IRpcRuntimeGeneration
  /** The final provider fence is the selected accepted identity, never an attempt counter. */
  readonly targetGeneration?: import('../contract/index.js').IRpcRuntimeGeneration
  readonly data: unknown
  readonly signal: IRpcAbortSignal
  /** Direct authenticated routing identity; forwarding never substitutes an earlier caller. */
  readonly senderId: string
  /** Remaining provider deadline, calculated with the original endpoint's monotonic clock. */
  readonly timeoutMs?: number
  /** Ordered signed forwarding nodes; absent on ordinary originating calls and foreign terminals. */
  readonly route?: readonly string[]
  /** Opaque trace supplied by the caller; downstream sends must pass it explicitly. */
  readonly trace?: string
  success(data?: unknown, options?: { readonly transfer?: readonly unknown[] }): IRpcProviderResult
  failed(message: string, code: string): IRpcProviderResult
  dispatchTo(input: { readonly id?: string; readonly method: string; readonly data: unknown }): void
}
export type IRpcProvider = (
  context: IRpcContext
) => IRpcProviderResult | Promise<IRpcProviderResult>
/** Bounded provider execution admission; excess requests fail immediately. */
export type IRpcProviderLimits = {
  readonly maxGlobal?: number
  readonly maxPerPeer?: number
  /**
   * Maximum completed inbound request tombstones retained per verified peer; defaults to 1024.
   * Configure a known session workload without changing concurrency or the global replay ceiling.
   */
  readonly maxReplayEntriesPerPeer?: number
  /**
   * Notify the local connection owner of a refused provider execution. The provider is not invoked;
   * observer failures are reported through endpoint hooks without replacing the existing OVERLOADED
   * result. No wire data is inspected.
   */
  readonly onRejected?: (rejection: IRpcProviderRejection) => void | Promise<void>
}
export type IRpcEventListener = (context: IRpcContext) => void | Promise<void>
export type ISendOptions = {
  readonly signal?: IRpcAbortSignal
  readonly timeoutMs?: number | false
  readonly transfer?: readonly unknown[]
  readonly idempotencyKey?: string
  readonly trace?: string
}

/** A session owner may inject shared deduplication with an authenticated scope function. */
export type IRpcIdempotencyConfig = Readonly<{
  store?: IRpcIdempotencyStore
  scope?: (admission: Readonly<{ token: string; senderId: string }>) => string
}>
/** Numeric replay exhaustion facts; contains no peer, task, method, or payload identity. */
export type IRpcReplayCapacityDetail = Readonly<{
  readonly namespace: RpcReplayCapacityNamespace
  readonly reason: Extract<RpcProviderRejectionReason, 'replayLedgerFull' | 'outboundReplayFull'>
  readonly occupancy: number
  readonly limit: number
  /** Present only for inbound capacity, without identifying the verified peer. */
  readonly peerOccupancy?: number
  readonly peerLimit?: number
}>

export type IRpcHookEvent = {
  readonly name: string
  readonly at: number
  readonly localId: string
  readonly code?: string
  readonly error?: unknown
  readonly field?: string
  /** Rate-limited, local-only replay capacity evidence; never serialized onto RPC frames. */
  readonly detail?: IRpcReplayCapacityDetail
  /** Relative peer drain announced by a validated close control frame. */
  readonly durationMs?: number
  readonly contract?: unknown
  readonly variation?: unknown
  readonly targetId?: string
  readonly receiverId?: string
  readonly requesterId?: string
  readonly receiverIds?: readonly string[]
  readonly ambiguous?: boolean
  readonly responseCount?: number
}
export type IRpcHook = (event: IRpcHookEvent) => void | Promise<void>
export type IRpcSchemaIssue = {
  readonly path: readonly (string | number)[]
  readonly message: string
  readonly code?: string
}
export type IRpcSchema<T = unknown> = { parse(value: unknown): T }
export type IRpcMethodSchema = {
  readonly params: IRpcSchema
  readonly result: IRpcSchema
}
export type IRpcContractConfig = {
  readonly version?: string
  readonly acceptVersions?: readonly string[]
  readonly maxIdentifierLength?: number
  readonly schemas?: Readonly<Record<string, IRpcMethodSchema>>
}
/** Executable contract capability installed by contract middleware. */
export type IRpcContractCapability = IRpcContractConfig & {
  readonly validateData: (method: string, side: 'params' | 'result', data: unknown) => void
}
export type IRpcUuidContext = {
  readonly variation: 'task' | 'message' | 'variation'
  readonly senderId: string
  readonly targetId?: string
}
export type IRpcUuidConfig = { readonly generate?: (context: IRpcUuidContext) => string }
export type IRpcProtocolConfig = {
  readonly encode?: (value: unknown) => unknown
  readonly decode?: (value: unknown) => unknown
  readonly encodedType?: 'any' | 'string' | 'uint8array'
}
/** Normalized protocol capability installed by protocol middleware. */
export type IRpcProtocolCapability = {
  readonly encode: (value: unknown) => unknown
  readonly decode: (value: unknown) => unknown
  readonly encodedType?: 'any' | 'string' | 'uint8array'
  readonly identity?: boolean
}
export type IRpcAuthenticationContext = {
  readonly direction: 'outbound' | 'inbound'
  readonly endpointId: string
  readonly platform: IRpcPlatform
}
export type IRpcAuthenticationTransform = (
  value: unknown,
  context: IRpcAuthenticationContext
) => unknown | Promise<unknown>
export type IRpcAuthenticationConfig = {
  readonly encrypt?: IRpcAuthenticationTransform
  readonly decrypt?: IRpcAuthenticationTransform
  readonly sign?: IRpcAuthenticationTransform
  readonly verify?: IRpcAuthenticationTransform
  readonly encodedType?: 'any' | 'string' | 'uint8array'
}
/** Executable per-frame protection installed by authentication middleware. */
export type IRpcAuthenticationCapability = {
  readonly enabled: true
  readonly encodedType: 'any' | 'string' | 'uint8array'
  readonly protect: IRpcAuthenticationTransform
  readonly unprotect: IRpcAuthenticationTransform
}
export type IRpcTimeoutConfig = {
  readonly timeoutMs?: number | false
}
/** Executable timeout capability installed by timeout middleware. */
export type IRpcTimeoutCapability = IRpcTimeoutConfig & {
  readonly resolveTimeout: (override?: number | false) => number | false | undefined
}
export type IRpcHooksConfig = {
  readonly listeners?: IRpcHook | readonly IRpcHook[]
  readonly onHookError?: (error: unknown, event: IRpcHookEvent) => void
}
export type IRpcConnectContext = {
  readonly senderId: string
  readonly targetId: string
  readonly peerId?: string
  readonly origin?: string
  readonly source?: unknown
  readonly data?: unknown
  readonly platform?: IRpcPlatform
  readonly topology?: 'exclusive' | 'multiplexed' | 'broadcast'
}
export type IRpcUniqueTargetIdContext = {
  readonly endpointId: string
  readonly platform: IRpcPlatform
}
export type IRpcConnectConfig = {
  /** Optional when factory.transport supplies the canonical transport. */
  readonly transport?: IRpcTransport
  readonly useBaseIdVerifyOnly?: boolean
  readonly uniqueTargetId?:
    | string
    | ((context: IRpcUniqueTargetIdContext) => string | Promise<string>)
  readonly discoveryMode?: 'automatic' | 'manual'
  readonly identifier?: (context: IRpcConnectContext) => boolean | Promise<boolean>
  readonly receiverSelector?: (
    serverList: readonly IRpcServerMetadata[],
    context: {
      readonly endpointId: string
      readonly targetId: string
      readonly operation: IRpcOperation
    }
  ) => string | undefined | Promise<string | undefined>
}
export type IRpcAutomaticConnectControl<TTargetId extends string = string> = Pick<
  IRpcConnectControl<TTargetId>,
  'getServerList' | 'pinReceiver' | 'unpinReceiver'
>
export type IRpcManualConnectControl<TTargetId extends string = string> =
  IRpcAutomaticConnectControl<TTargetId> &
    Required<
      Pick<IRpcConnectControl<TTargetId>, 'query' | 'onQuery' | 'register' | 'unregister' | 'ping'>
    >
export type IRpcDiscoveryMode = 'automatic' | 'manual'
export type IRpcConnectControlForMode<
  TTargetId extends string,
  TMode extends IRpcDiscoveryMode
> = TMode extends 'manual'
  ? IRpcManualConnectControl<TTargetId>
  : IRpcAutomaticConnectControl<TTargetId>
/** Executable peer-verification capability installed by connect middleware. */
export type IRpcConnectCapability = Omit<IRpcConnectConfig, 'uniqueTargetId'> & {
  readonly uniqueTargetId?: string
  readonly uniqueTargetIdFactory?: (context: IRpcUniqueTargetIdContext) => string | Promise<string>
  readonly verify: (
    context: IRpcConnectContext,
    reportRead?: (failure: Readonly<{ key: PropertyKey; error: unknown }>) => undefined
  ) => boolean | Promise<boolean>
}
export type IRpcPlatform = IProtocolWebRpcPlatform
export type IRpcServerMetadata<TTargetId extends string = string> = {
  readonly targetId: TTargetId
  readonly receiverId: string
  readonly uniqueTargetId?: string
  readonly platform: IRpcPlatform
  readonly origin?: string
  /**
   * Endpoint monotonic time (the endpoint scheduler's `now()`) when the receiver was registered.
   * Comparable only with other metadata of the same endpoint or with `IRpcTimePort.now()`.
   */
  readonly registeredAt: number
  /** Endpoint monotonic time of the last observation; same comparison domain as `registeredAt`. */
  readonly lastSeenAt: number
  readonly pinned: boolean
  readonly status: IRpcCandidateStatus
}
export type IRpcConnectControl<TTargetId extends string = string> = {
  readonly getServerList: (targetId?: TTargetId) => readonly IRpcServerMetadata<TTargetId>[]
  readonly pinReceiver: (targetId: TTargetId, receiverId: string) => void
  readonly unpinReceiver: (targetId: TTargetId) => void
  query?: (
    targetId: TTargetId,
    options?: { readonly timeoutMs?: number; readonly signal?: IRpcAbortSignal }
  ) => Promise<readonly IRpcDiscoveryCandidate<TTargetId>[]>
  onQuery?: (
    listener: (query: IRpcInboundDiscoveryQuery<TTargetId>) => void | Promise<void>
  ) => () => void
  register?: (candidate: IRpcDiscoveryCandidate<TTargetId>) => void
  unregister?: (targetId: TTargetId, receiverId?: string) => Promise<void>
  ping?: (
    candidate: IRpcDiscoveryCandidate<TTargetId>,
    options?: { readonly timeoutMs?: number; readonly signal?: IRpcAbortSignal }
  ) => Promise<boolean>
}
export type IRpcInboundDiscoveryQuery<TTargetId extends string = string> = {
  readonly targetId: TTargetId
  readonly data: unknown
  readonly platform: IRpcPlatform
  readonly origin?: string
  readonly accept: (data?: unknown) => Promise<boolean>
  readonly reject: (reason?: string) => Promise<boolean>
}
export type IRpcDiscoveryCandidate<TTargetId extends string = string> = {
  readonly queryId: string
  readonly targetId: TTargetId
  readonly receiverId?: string
  readonly data: unknown
  readonly platform: IRpcPlatform
  readonly origin?: string
}
export type IRpcDiscoveryControl<TTargetId extends string = string> = {
  readonly getServerList: (targetId?: TTargetId) => readonly IRpcServerMetadata<TTargetId>[]
  readonly pinReceiver: (targetId: TTargetId, receiverId: string) => void
  readonly unpinReceiver: (targetId: TTargetId) => void
}
export type IRpcFeatureConfig = { readonly abort?: boolean; readonly ping?: boolean }
export type IRpcAbortCapability = { readonly enabled: true }
export type IRpcPingCapability = { readonly enabled: true }
export type IRpcFanoutResult<TResult> = {
  readonly fulfilled: Partial<Record<string, TResult>>
  readonly rejected: Partial<Record<string, unknown>>
}

/** Static claims admitted before a WebRPC plugin crosses the Host boundary. */
export type IRpcPluginClaims = {
  readonly routes: readonly string[]
  readonly provides: readonly string[]
  readonly consumes: readonly string[]
  readonly publicKeys: readonly string[]
  readonly exposedKeys: readonly string[]
  readonly activator: boolean
}

/** Immutable metadata used by the composer to admit one domain plugin. */
export type IRpcPluginMetadata = {
  readonly claims: IRpcPluginClaims
  readonly sharedProvides?: readonly PropertyKey[]
  readonly sharedConsumes?: readonly PropertyKey[]
  readonly sharedOptionalConsumes?: readonly PropertyKey[]
}

/** Host-neutral scope exposed to one WebRPC plugin install body. */
export type IRpcPluginInstallScope = {
  readonly id: string
  readonly transport: IRpcTransport
  readonly signal: IRpcAbortSignal
  readonly hooks: (event: IRpcHookEvent) => void
  readonly getPort: (key: PropertyKey) => unknown
  own<T>(resource: T, release: () => void | Promise<void>): T
}

/** Immutable extension/shared result returned by a WebRPC plugin install. */
export type IRpcPluginInstallResult = {
  readonly extension: Readonly<Record<string, unknown>>
  readonly ports: Readonly<Record<PropertyKey, unknown>>
}

/** Public item contract used by migrated middleware without widening its component contribution. */
export type IRpcPlugin<TComponents extends object = {}> = {
  readonly name: string
  readonly metadata: IRpcPluginMetadata
  /** Discovery mode retained on the native descriptor for factory conditional typing. */
  readonly discoveryMode?: IRpcDiscoveryMode
  /** Ping capability retained on the native descriptor for factory conditional typing. */
  readonly pingCapability?: true
  /** Runtime component slots stay opaque until tuple selection proves their exact contribution. */
  readonly transport?: unknown
  readonly protocol?: unknown
  readonly codec?: unknown
  readonly framer?: unknown
  readonly install: (
    scope: IRpcPluginInstallScope
  ) => IRpcPluginInstallResult | Promise<IRpcPluginInstallResult>
} & Readonly<TComponents>

/** One factory tuple may contain legacy WebRPC middleware or direct PluginHost middleware. */
export type IRpcMiddleware = IRpcPlugin | IRpcNativeMiddleware
export type IRpcFactoryConfig<
  TTargetId extends string = string,
  TMiddlewares extends readonly IRpcMiddleware[] = readonly IRpcMiddleware[],
  TFeatures extends readonly IRpcFeature[] = readonly IRpcFeature[],
  TEnvelope extends IRpcEnvelope = IRpcEnvelope,
  TEncoded = unknown,
  TFrame = TEncoded
> = {
  /** Stable local endpoint identity included in every routed protocol envelope. */
  readonly id: string
  /**
   * Endpoint monotonic clock and timers; the same injected instance also drives PluginHost
   * deadlines. `now()` must return finite non-negative milliseconds and is never read as an epoch.
   */
  readonly scheduler?: import('@migaia/utils/scheduler').IScheduler
  /**
   * Endpoint wall clock; only produces wire `sentAt` and hook event `at` diagnostics. `timestamp()`
   * must return non-negative safe-integer epoch milliseconds. Defaults to the host wall clock.
   */
  readonly wallClock?: import('@migaia/utils/scheduler').IWallClock
  /** Optional known-peer seed; automatic discovery may resolve additional target ids lazily. */
  readonly targetIds?: readonly TTargetId[]
  /** Transport receives exactly the selected framer output, except an explicit opaque sink. */
  readonly transport?: IRpcTransport<TFrame>
  /** Semantic descriptor feeding the codec edge in the canonical endpoint pipeline. */
  readonly protocol?: IRpcProtocol<TEnvelope, string, number>
  /** Codec whose output must match the selected framer input exactly. */
  readonly codec?: ICodec<TEnvelope, TEncoded>
  /** Framer whose output is the value delivered to the selected transport. */
  readonly framer?: IRpcFramer<TEncoded, TFrame, string, number>
  /** Initial provider methods registered before endpoint construction completes. */
  readonly provider?: Readonly<Record<string, IRpcProvider>>
  /** Provider concurrency budgets; defaults to 256 global and 64 per peer. */
  readonly providerLimits?: IRpcProviderLimits
  /** Optional store and session scope used only for keyed provider requests. */
  readonly idempotency?: IRpcIdempotencyConfig
  /** Bounds outbound identifier replay reservations for this endpoint. */
  readonly replay?: {
    /** Maximum retained outbound request identifiers; defaults to 4096. */
    readonly maxEntries?: number
    /** Retention time for outbound request identifiers; defaults to 310 seconds. */
    readonly ttlMs?: number
  }
  /** Ordered middleware tuple installed atomically during endpoint construction. */
  readonly middlewares: TMiddlewares
  /** Finite immutable tuple of user-defined features installed by the canonical Host batch. */
  readonly features?: TFeatures
  /** Cancellation and deadline controls for middleware installation and rollback. */
  readonly construction?: {
    /** Aborts construction while still rolling back every installed middleware. */
    readonly signal?: IRpcAbortSignal
    /** Bounds endpoint construction, or disables the deadline when explicitly `false`. */
    readonly timeoutMs?: number | false
  }
}
/**
 * Reads component slots only from native middleware definitions. The optional unique-symbol marker
 * is otherwise structurally compatible with legacy middleware and would incorrectly infer a ping
 * capability from an ordinary `connect()` descriptor.
 */
type INativeMiddlewareComponentContribution<TMiddleware> =
  TMiddleware extends IRpcNativeMiddleware & IRpcMiddlewareComponentContribution<infer TComponents>
    ? TComponents
    : never
export type IFactoryDiscoveryMode<TMiddlewares extends readonly IRpcMiddleware[]> = [
  Extract<
    TMiddlewares[number] | INativeMiddlewareComponentContribution<TMiddlewares[number]>,
    { readonly discoveryMode: 'manual' }
  >
] extends [never]
  ? 'automatic'
  : 'manual'
/** Distinguishes an explicitly selected ping capability from the optional legacy slot. */
type IRequiredPingCapability<TMiddleware> = TMiddleware extends object
  ? 'pingCapability' extends keyof TMiddleware
    ? {} extends Pick<TMiddleware, 'pingCapability'>
      ? false
      : TMiddleware extends { readonly pingCapability: true }
        ? true
        : false
    : false
  : false
/** Selects the public ping surface only when a middleware actually requires that capability. */
export type IFactoryPingCapability<TMiddlewares extends readonly IRpcMiddleware[]> =
  true extends IRequiredPingCapability<
    TMiddlewares[number] | INativeMiddlewareComponentContribution<TMiddlewares[number]>
  >
    ? true
    : false
export type IRpcPingEndpointSurface<TPing extends boolean> = boolean extends TPing
  ? {
      ping(targetId: string, receiverId?: string, options?: IRpcPingOptions): Promise<boolean>
      pingAll(): Promise<IRpcFanoutResult<boolean>>
    }
  : TPing extends true
    ? {
        ping(targetId: string, receiverId?: string, options?: IRpcPingOptions): Promise<boolean>
        pingAll(): Promise<IRpcFanoutResult<boolean>>
      }
    : {}
export type IRpcPingOptions = {
  readonly timeoutMs?: number | false
  readonly signal?: IRpcAbortSignal
}
export type IRpcEndpoint<
  TTargetId extends string = string,
  TMode extends IRpcDiscoveryMode = 'automatic',
  TPing extends boolean = boolean
> = {
  provide(method: string, provider: IRpcProvider): IRpcEndpoint<TTargetId, TMode, TPing>
  on(event: string, listener: IRpcEventListener): () => void
  send<T>(targetId: TTargetId, method: string, data: unknown, options?: ISendOptions): Promise<T>
  sendAll<T>(method: string, data: unknown, options?: ISendOptions): Promise<IRpcFanoutResult<T>>
  dispatch(targetId: TTargetId, method: string, data: unknown): void
  dispatchAll(method: string, data: unknown): void
  /** Announce a bounded drain window to one peer without closing the channel in core. */
  announceClose(
    targetId: TTargetId,
    options: { readonly drainMs: number; readonly receiverId?: string }
  ): Promise<void>
  readonly connect: IRpcConnectControlForMode<TTargetId, TMode>
  readonly discovery: IRpcDiscoveryControl<TTargetId>
  readonly hooks: { on(listener: IRpcHook): () => void }
  dispose(): Promise<void>
} & IRpcPingEndpointSurface<TPing>
export type IRpcEndpointFactory = <
  TTargetId extends string = string,
  TMiddlewares extends readonly IRpcMiddleware[] = readonly IRpcMiddleware[]
>(
  config: IRpcFactoryConfig<TTargetId, TMiddlewares>
) => Promise<
  IRpcEndpoint<TTargetId, IFactoryDiscoveryMode<TMiddlewares>, IFactoryPingCapability<TMiddlewares>>
>
export type IRpcPublicError = IRpcError
/** Structural cancellation signal used by the public API without requiring DOM typings. */
export type IRpcAbortSignal = {
  readonly aborted: boolean
  readonly reason?: unknown
  addEventListener(type: 'abort', listener: () => void, options?: { readonly once?: boolean }): void
  removeEventListener(type: 'abort', listener: () => void): void
  readonly throwIfAborted?: () => void
}
