import type { IWebRpcError } from './errors.js'
import type { IWebRpcTransport } from './transport.js'
import type { IWebRpcFeature } from './feature.js'
import type {
  IWebRpcMiddlewareComponentContribution,
  IWebRpcNativeMiddleware
} from './middleware.js'
import type { IRpcEnvelope, IRpcFramer, IRpcProtocol } from '@migaia/rpc-contract'
import type { ICodec } from '@migaia/serialize/codec'
import type { IWebRpcPlatformValue as IProtocolWebRpcPlatform } from './transport-constants.js'
import type { IWebRpcCandidateStatus, IWebRpcOperation } from './transport-constants.js'

export type IWebRpcProviderResult =
  | { readonly ok: true; readonly data?: unknown; readonly transfer?: readonly unknown[] }
  | { readonly ok: false; readonly message: string; readonly code: string }
export type IWebRpcContext = {
  readonly data: unknown
  readonly signal: IWebRpcAbortSignal
  success(
    data?: unknown,
    options?: { readonly transfer?: readonly unknown[] }
  ): IWebRpcProviderResult
  failed(message: string, code: string): IWebRpcProviderResult
  dispatchTo(input: { readonly id?: string; readonly method: string; readonly data: unknown }): void
}
export type IWebRpcProvider = (
  context: IWebRpcContext
) => IWebRpcProviderResult | Promise<IWebRpcProviderResult>
/** Bounded provider execution admission; excess requests fail immediately. */
export type IWebRpcProviderLimits = {
  readonly maxGlobal?: number
  readonly maxPerPeer?: number
}
export type IWebRpcEventListener = (context: IWebRpcContext) => void | Promise<void>
export type ISendOptions = {
  readonly signal?: IWebRpcAbortSignal
  readonly timeoutMs?: number | false
  readonly transfer?: readonly unknown[]
}
export type IWebRpcHookEvent = {
  readonly name: string
  readonly at: number
  readonly localId: string
  readonly code?: string
  readonly error?: unknown
  readonly contract?: unknown
  readonly variation?: unknown
  readonly targetId?: string
  readonly receiverId?: string
  readonly requesterId?: string
  readonly receiverIds?: readonly string[]
  readonly ambiguous?: boolean
  readonly responseCount?: number
}
export type IWebRpcHook = (event: IWebRpcHookEvent) => void | Promise<void>
export type IWebRpcSchemaIssue = {
  readonly path: readonly (string | number)[]
  readonly message: string
  readonly code?: string
}
export type IWebRpcSchema<T = unknown> = { parse(value: unknown): T }
export type IWebRpcMethodSchema = {
  readonly params: IWebRpcSchema
  readonly result: IWebRpcSchema
}
export type IWebRpcContractConfig = {
  readonly version?: string
  readonly acceptVersions?: readonly string[]
  readonly maxIdentifierLength?: number
  readonly schemas?: Readonly<Record<string, IWebRpcMethodSchema>>
}
/** Executable contract capability installed by contract middleware. */
export type IWebRpcContractCapability = IWebRpcContractConfig & {
  readonly validateData: (method: string, side: 'params' | 'result', data: unknown) => void
}
export type IWebRpcUuidContext = {
  readonly variation: 'task' | 'message' | 'variation'
  readonly senderId: string
  readonly targetId?: string
}
export type IWebRpcUuidConfig = { readonly generate?: (context: IWebRpcUuidContext) => string }
export type IWebRpcProtocolConfig = {
  readonly encode?: (value: unknown) => unknown
  readonly decode?: (value: unknown) => unknown
  readonly encodedType?: 'any' | 'string' | 'uint8array'
}
/** Normalized protocol capability installed by protocol middleware. */
export type IWebRpcProtocolCapability = {
  readonly encode: (value: unknown) => unknown
  readonly decode: (value: unknown) => unknown
  readonly encodedType?: 'any' | 'string' | 'uint8array'
  readonly identity?: boolean
}
export type IWebRpcAuthenticationContext = {
  readonly direction: 'outbound' | 'inbound'
  readonly endpointId: string
  readonly platform: IWebRpcPlatform
}
export type IWebRpcAuthenticationTransform = (
  value: unknown,
  context: IWebRpcAuthenticationContext
) => unknown | Promise<unknown>
export type IWebRpcAuthenticationConfig = {
  readonly encrypt?: IWebRpcAuthenticationTransform
  readonly decrypt?: IWebRpcAuthenticationTransform
  readonly sign?: IWebRpcAuthenticationTransform
  readonly verify?: IWebRpcAuthenticationTransform
  readonly encodedType?: 'any' | 'string' | 'uint8array'
}
/** Executable per-frame protection installed by authentication middleware. */
export type IWebRpcAuthenticationCapability = {
  readonly enabled: true
  readonly encodedType: 'any' | 'string' | 'uint8array'
  readonly protect: IWebRpcAuthenticationTransform
  readonly unprotect: IWebRpcAuthenticationTransform
}
export type IWebRpcTimeoutConfig = {
  readonly timeoutMs?: number | false
}
/** Executable timeout capability installed by timeout middleware. */
export type IWebRpcTimeoutCapability = IWebRpcTimeoutConfig & {
  readonly resolveTimeout: (override?: number | false) => number | false | undefined
}
export type IWebRpcHooksConfig = {
  readonly listeners?: IWebRpcHook | readonly IWebRpcHook[]
  readonly onHookError?: (error: unknown, event: IWebRpcHookEvent) => void
}
export type IWebRpcConnectContext = {
  readonly senderId: string
  readonly targetId: string
  readonly peerId?: string
  readonly origin?: string
  readonly source?: unknown
  readonly data?: unknown
  readonly platform?: IWebRpcPlatform
  readonly topology?: 'exclusive' | 'multiplexed' | 'broadcast'
}
export type IWebRpcUniqueTargetIdContext = {
  readonly endpointId: string
  readonly platform: IWebRpcPlatform
}
export type IWebRpcConnectConfig = {
  /** Optional when factory.transport supplies the canonical transport. */
  readonly transport?: IWebRpcTransport
  readonly useBaseIdVerifyOnly?: boolean
  readonly uniqueTargetId?:
    | string
    | ((context: IWebRpcUniqueTargetIdContext) => string | Promise<string>)
  readonly discoveryMode?: 'automatic' | 'manual'
  readonly identifier?: (context: IWebRpcConnectContext) => boolean | Promise<boolean>
  readonly receiverSelector?: (
    serverList: readonly IWebRpcServerMetadata[],
    context: {
      readonly endpointId: string
      readonly targetId: string
      readonly operation: IWebRpcOperation
    }
  ) => string | undefined | Promise<string | undefined>
}
export type IWebRpcAutomaticConnectControl<TTargetId extends string = string> = Pick<
  IWebRpcConnectControl<TTargetId>,
  'getServerList' | 'pinReceiver' | 'unpinReceiver'
>
export type IWebRpcManualConnectControl<TTargetId extends string = string> =
  IWebRpcAutomaticConnectControl<TTargetId> &
    Required<
      Pick<
        IWebRpcConnectControl<TTargetId>,
        'query' | 'onQuery' | 'register' | 'unregister' | 'ping'
      >
    >
export type IWebRpcDiscoveryMode = 'automatic' | 'manual'
export type IWebRpcConnectControlForMode<
  TTargetId extends string,
  TMode extends IWebRpcDiscoveryMode
> = TMode extends 'manual'
  ? IWebRpcManualConnectControl<TTargetId>
  : IWebRpcAutomaticConnectControl<TTargetId>
/** Executable peer-verification capability installed by connect middleware. */
export type IWebRpcConnectCapability = Omit<IWebRpcConnectConfig, 'uniqueTargetId'> & {
  readonly uniqueTargetId?: string
  readonly uniqueTargetIdFactory?: (
    context: IWebRpcUniqueTargetIdContext
  ) => string | Promise<string>
  readonly verify: (context: IWebRpcConnectContext) => boolean | Promise<boolean>
}
export type IWebRpcPlatform = IProtocolWebRpcPlatform
export type IWebRpcServerMetadata<TTargetId extends string = string> = {
  readonly targetId: TTargetId
  readonly receiverId: string
  readonly uniqueTargetId?: string
  readonly platform: IWebRpcPlatform
  readonly origin?: string
  readonly registeredAt: number
  readonly lastSeenAt: number
  readonly pinned: boolean
  readonly status: IWebRpcCandidateStatus
}
export type IWebRpcConnectControl<TTargetId extends string = string> = {
  readonly getServerList: (targetId?: TTargetId) => readonly IWebRpcServerMetadata<TTargetId>[]
  readonly pinReceiver: (targetId: TTargetId, receiverId: string) => void
  readonly unpinReceiver: (targetId: TTargetId) => void
  query?: (
    targetId: TTargetId,
    options?: { readonly timeoutMs?: number; readonly signal?: IWebRpcAbortSignal }
  ) => Promise<readonly IWebRpcDiscoveryCandidate<TTargetId>[]>
  onQuery?: (
    listener: (query: IWebRpcInboundDiscoveryQuery<TTargetId>) => void | Promise<void>
  ) => () => void
  register?: (candidate: IWebRpcDiscoveryCandidate<TTargetId>) => void
  unregister?: (targetId: TTargetId, receiverId?: string) => Promise<void>
  ping?: (
    candidate: IWebRpcDiscoveryCandidate<TTargetId>,
    options?: { readonly timeoutMs?: number; readonly signal?: IWebRpcAbortSignal }
  ) => Promise<boolean>
}
export type IWebRpcInboundDiscoveryQuery<TTargetId extends string = string> = {
  readonly targetId: TTargetId
  readonly data: unknown
  readonly platform: IWebRpcPlatform
  readonly origin?: string
  readonly accept: (data?: unknown) => Promise<boolean>
  readonly reject: (reason?: string) => Promise<boolean>
}
export type IWebRpcDiscoveryCandidate<TTargetId extends string = string> = {
  readonly queryId: string
  readonly targetId: TTargetId
  readonly receiverId?: string
  readonly data: unknown
  readonly platform: IWebRpcPlatform
  readonly origin?: string
}
export type IWebRpcDiscoveryControl<TTargetId extends string = string> = {
  readonly getServerList: (targetId?: TTargetId) => readonly IWebRpcServerMetadata<TTargetId>[]
  readonly pinReceiver: (targetId: TTargetId, receiverId: string) => void
  readonly unpinReceiver: (targetId: TTargetId) => void
}
export type IWebRpcFeatureConfig = { readonly abort?: boolean; readonly ping?: boolean }
export type IWebRpcAbortCapability = { readonly enabled: true }
export type IWebRpcPingCapability = { readonly enabled: true }
export type IWebRpcFanoutResult<TResult> = {
  readonly fulfilled: Partial<Record<string, TResult>>
  readonly rejected: Partial<Record<string, unknown>>
}

/** Static claims admitted before a WebRPC plugin crosses the Host boundary. */
export type IWebRpcPluginClaims = {
  readonly routes: readonly string[]
  readonly provides: readonly string[]
  readonly consumes: readonly string[]
  readonly publicKeys: readonly string[]
  readonly exposedKeys: readonly string[]
  readonly activator: boolean
}

/** Immutable metadata used by the composer to admit one domain plugin. */
export type IWebRpcPluginMetadata = {
  readonly claims: IWebRpcPluginClaims
  readonly sharedProvides?: readonly PropertyKey[]
  readonly sharedConsumes?: readonly PropertyKey[]
  readonly sharedOptionalConsumes?: readonly PropertyKey[]
}

/** Host-neutral scope exposed to one WebRPC plugin install body. */
export type IWebRpcPluginInstallScope = {
  readonly id: string
  readonly transport: IWebRpcTransport
  readonly signal: IWebRpcAbortSignal
  readonly hooks: (event: IWebRpcHookEvent) => void
  readonly getShared: (key: PropertyKey) => unknown
  own<T>(resource: T, release: () => void | Promise<void>): T
}

/** Immutable extension/shared result returned by a WebRPC plugin install. */
export type IWebRpcPluginInstallResult = {
  readonly extension: Readonly<Record<string, unknown>>
  readonly shared: Readonly<Record<PropertyKey, unknown>>
}

/** Public item contract used by migrated middleware without widening its component contribution. */
export type IWebRpcPlugin<TComponents extends object = {}> = {
  readonly name: string
  readonly metadata: IWebRpcPluginMetadata
  /** Discovery mode retained on the native descriptor for factory conditional typing. */
  readonly discoveryMode?: IWebRpcDiscoveryMode
  /** Ping capability retained on the native descriptor for factory conditional typing. */
  readonly pingCapability?: true
  /** Runtime component slots stay opaque until tuple selection proves their exact contribution. */
  readonly transport?: unknown
  readonly protocol?: unknown
  readonly codec?: unknown
  readonly framer?: unknown
  readonly install: (
    scope: IWebRpcPluginInstallScope
  ) => IWebRpcPluginInstallResult | Promise<IWebRpcPluginInstallResult>
} & Readonly<TComponents>

/** One factory tuple may contain legacy WebRPC middleware or direct PluginHost middleware. */
export type IWebRpcMiddleware = IWebRpcPlugin | IWebRpcNativeMiddleware
export type IWebRpcFactoryConfig<
  TTargetId extends string = string,
  TMiddlewares extends readonly IWebRpcMiddleware[] = readonly IWebRpcMiddleware[],
  TFeatures extends readonly IWebRpcFeature[] = readonly IWebRpcFeature[],
  TEnvelope extends IRpcEnvelope = IRpcEnvelope,
  TEncoded = unknown,
  TFrame = TEncoded
> = {
  /** Stable local endpoint identity included in every routed protocol envelope. */
  readonly id: string
  /** Optional known-peer seed; automatic discovery may resolve additional target ids lazily. */
  readonly targetIds?: readonly TTargetId[]
  /** Transport receives exactly the selected framer output, except an explicit opaque sink. */
  readonly transport?: IWebRpcTransport<TFrame>
  /** Semantic descriptor feeding the codec edge in the canonical endpoint pipeline. */
  readonly protocol?: IRpcProtocol<TEnvelope, string, number>
  /** Codec whose output must match the selected framer input exactly. */
  readonly codec?: ICodec<TEnvelope, TEncoded>
  /** Framer whose output is the value delivered to the selected transport. */
  readonly framer?: IRpcFramer<TEncoded, TFrame, string, number>
  /** Initial provider methods registered before endpoint construction completes. */
  readonly provider?: Readonly<Record<string, IWebRpcProvider>>
  /** Provider concurrency budgets; defaults to 256 global and 64 per peer. */
  readonly providerLimits?: IWebRpcProviderLimits
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
    readonly signal?: IWebRpcAbortSignal
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
  TMiddleware extends IWebRpcNativeMiddleware &
    IWebRpcMiddlewareComponentContribution<infer TComponents>
    ? TComponents
    : never
export type IFactoryDiscoveryMode<TMiddlewares extends readonly IWebRpcMiddleware[]> = [
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
export type IFactoryPingCapability<TMiddlewares extends readonly IWebRpcMiddleware[]> =
  true extends IRequiredPingCapability<
    TMiddlewares[number] | INativeMiddlewareComponentContribution<TMiddlewares[number]>
  >
    ? true
    : false
export type IWebRpcPingEndpointSurface<TPing extends boolean> = boolean extends TPing
  ? {
      ping(targetId: string, receiverId?: string, options?: IWebRpcPingOptions): Promise<boolean>
      pingAll(): Promise<IWebRpcFanoutResult<boolean>>
    }
  : TPing extends true
    ? {
        ping(targetId: string, receiverId?: string, options?: IWebRpcPingOptions): Promise<boolean>
        pingAll(): Promise<IWebRpcFanoutResult<boolean>>
      }
    : {}
export type IWebRpcPingOptions = {
  readonly timeoutMs?: number | false
  readonly signal?: IWebRpcAbortSignal
}
export type IWebRpcEndpoint<
  TTargetId extends string = string,
  TMode extends IWebRpcDiscoveryMode = 'automatic',
  TPing extends boolean = boolean
> = {
  provide(method: string, provider: IWebRpcProvider): IWebRpcEndpoint<TTargetId, TMode, TPing>
  on(event: string, listener: IWebRpcEventListener): () => void
  send<T>(targetId: TTargetId, method: string, data: unknown, options?: ISendOptions): Promise<T>
  sendAll<T>(method: string, data: unknown, options?: ISendOptions): Promise<IWebRpcFanoutResult<T>>
  dispatch(targetId: TTargetId, method: string, data: unknown): void
  dispatchAll(method: string, data: unknown): void
  readonly connect: IWebRpcConnectControlForMode<TTargetId, TMode>
  readonly discovery: IWebRpcDiscoveryControl<TTargetId>
  readonly hooks: { on(listener: IWebRpcHook): () => void }
  dispose(): Promise<void>
} & IWebRpcPingEndpointSurface<TPing>
export type IWebRpcEndpointFactory = <
  TTargetId extends string = string,
  TMiddlewares extends readonly IWebRpcMiddleware[] = readonly IWebRpcMiddleware[]
>(
  config: IWebRpcFactoryConfig<TTargetId, TMiddlewares>
) => Promise<
  IWebRpcEndpoint<
    TTargetId,
    IFactoryDiscoveryMode<TMiddlewares>,
    IFactoryPingCapability<TMiddlewares>
  >
>
export type IWebRpcPublicError = IWebRpcError
/** Structural cancellation signal used by the public API without requiring DOM typings. */
export type IWebRpcAbortSignal = {
  readonly aborted: boolean
  readonly reason?: unknown
  addEventListener(type: 'abort', listener: () => void, options?: { readonly once?: boolean }): void
  removeEventListener(type: 'abort', listener: () => void): void
  readonly throwIfAborted?: () => void
}
