import type { IFactoryDiscoveryMode, IFactoryPingCapability } from './internal/factory-types.js'
import type { IAbortSignal, INativeAbortSignal } from '@migaia/utils/promise'
import type { IRpcProviderRejection } from './provider-admission.js'
import type {
  RpcProviderRejectionReason,
  RpcReplayCapacityNamespace
} from './semantic-constants.js'
import type { IRpcTransport } from './transport.js'
import type { IRpcFeature } from './feature.js'
import type { IRpcNativeMiddleware } from './middleware.js'
import type {
  IRpcEnvelope,
  IRpcFramer,
  IRpcProtocol,
  IRpcRuntimeEnvelope
} from '@migaia/rpc-contract'
import type { IRpcRuntimeStepOutcome } from '@migaia/rpc-contract/v1'
import type { IRpcIdempotencyStore } from './idempotency-store.js'
import type { ICodec } from '@migaia/serialize/codec'
import type { IRpcPlatformValue } from './transport-constants.js'
import type { IRpcCandidateStatus, IRpcOperation } from './transport-constants.js'

/**
 * Explicit provider settlement. Requests must return a success or failure value; an unrecognized
 * return is PROVIDER_NOT_SETTLED.
 */
export type IRpcProviderResult =
  | {
      /** Successful context-owned settlement. */ readonly ok: true
      /** Application response value. */ readonly data?: unknown
      /** Optional physical transfer list for this response. */ readonly transfer?: readonly unknown[]
    }
  | {
      /** Failed context-owned settlement. */ readonly ok: false
      /** Application failure explanation. */ readonly message: string
      /** Stable application failure code. */ readonly code: string
    }
/**
 * One admitted provider invocation. Keep response work within its synchronous or awaited lifetime;
 * later settlement returns a PROVIDER_CONTEXT_EXPIRED failure record without sending it.
 */
export type IRpcContext = {
  /** Serving endpoint identity lets mounted services exclude their own observation traffic. */
  readonly localEndpointId: string
  /** Present only after generation@1 directory admission for this actual runtime-profile task. */
  readonly callerGeneration?: import('@migaia/rpc-contract').IRpcRuntimeGeneration
  /** The final provider fence is the selected accepted identity, never an attempt counter. */
  readonly targetGeneration?: import('@migaia/rpc-contract').IRpcRuntimeGeneration
  /** Application parameters received for this invocation. */
  readonly data: unknown
  /** Cooperative provider cancellation signal; application I/O must observe it. */
  readonly signal: INativeAbortSignal
  /** Direct authenticated routing identity; forwarding never substitutes an earlier caller. */
  readonly senderId: string
  /** Remaining provider deadline, calculated with the original endpoint's monotonic clock. */
  readonly timeoutMs?: number
  /** Ordered signed forwarding nodes; absent on ordinary originating calls and foreign terminals. */
  readonly route?: readonly string[]
  /** Opaque trace supplied by the caller; downstream sends must pass it explicitly. */
  readonly trace?: string
  /** Build a successful response and preserve the explicit transfer list for the physical sender. */
  success(data?: unknown, options?: { readonly transfer?: readonly unknown[] }): IRpcProviderResult
  /** Build an application failure reply with its public message and code. */
  failed(message: string, code: string): IRpcProviderResult
  /** Send a notification through this invocation's existing routing owner without awaiting a reply. */
  dispatchTo(input: { readonly id?: string; readonly method: string; readonly data: unknown }): void
}
/**
 * Request handler returning an explicit context-owned success/failure; throwing becomes a remote
 * failure with local diagnostics.
 */
export type IRpcProvider = (
  context: IRpcContext
) => IRpcProviderResult | Promise<IRpcProviderResult>
/** Bounded provider execution admission; excess requests fail immediately. */
export type IRpcProviderLimits = {
  /** Positive safe-integer maximum active provider work across peers; defaults to 256. */
  readonly maxGlobal?: number
  /** Positive safe-integer maximum active provider work per verified peer; defaults to 64. */
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
/**
 * Notification handler for an endpoint event; its failure is diagnostic rather than a request
 * result.
 */
export type IRpcEventListener = (context: IRpcContext) => void | Promise<void>
/**
 * Controls one logical request. Timeout overrides the installed timeout policy; cancellation does
 * not prove remote side effects were undone.
 */
export type ISendOptions = {
  /** Cancel local waiting; remote notification requires the abort capability. */
  readonly signal?: IAbortSignal
  /**
   * Finite non-negative milliseconds, false for no deadline, or omitted to inherit the timeout
   * policy. Zero expires before sending.
   */
  readonly timeoutMs?: number | false
  /** Physical ownership transfer resources; validation and support belong to the selected carrier. */
  readonly transfer?: readonly unknown[]
  /**
   * Stable logical execution key for a configured provider idempotency store; it is not an
   * automatic retry request.
   */
  readonly idempotencyKey?: string
  /** Optional printable correlation string forwarded only when explicitly supplied. */
  readonly trace?: string
}

/** Atomic native groups share the existing wire controls and local cancellation/ownership inputs. */
export type IRpcRuntimeGroupOptions = Omit<
  Extract<IRpcRuntimeEnvelope, { kind: 'runtime-call' }>['options'],
  'timeoutMs'
> &
  Pick<ISendOptions, 'timeoutMs' | 'signal' | 'transfer'>
/** Native group inputs use the public request-only wire grammar. */
export type IRpcRuntimeGroupSteps = Extract<IRpcRuntimeEnvelope, { kind: 'runtime-group' }>['steps']
/** Outcome lookup exposes original retention and completion facts without routing headers. */
export type IRpcRuntimeOutcomeResult =
  | Pick<
      Extract<IRpcRuntimeEnvelope, { kind: 'runtime-outcome'; state: 'pending' | 'unknown' }>,
      'state' | 'store'
    >
  | Pick<
      Extract<IRpcRuntimeEnvelope, { kind: 'runtime-outcome'; state: 'done' }>,
      'state' | 'store' | 'outcome'
    >

/** A session owner may inject shared deduplication with an authenticated scope function. */
export type IRpcIdempotencyConfig = Readonly<{
  /** Borrowed store for keyed provider executions; omission selects the endpoint-owned default. */
  store?: IRpcIdempotencyStore
  /** Compute an authenticated deduplication namespace from admitted token and sender identity. */
  scope?: (admission: Readonly<{ token: string; senderId: string }>) => string
}>
/** Numeric replay exhaustion facts; contains no peer, task, method, or payload identity. */
export type IRpcReplayCapacityDetail = Readonly<{
  /** Inbound or outbound owner whose bounded identifier ledger refused admission. */
  readonly namespace: RpcReplayCapacityNamespace
  /** Specific replay-capacity refusal, separate from provider concurrency. */
  readonly reason: Extract<RpcProviderRejectionReason, 'replayLedgerFull' | 'outboundReplayFull'>
  /** Currently retained entries in that ledger. */
  readonly occupancy: number
  /** Configured maximum entry count. */
  readonly limit: number
  /** Present only for inbound capacity, without identifying the verified peer. */
  readonly peerOccupancy?: number
  /** Configured per-verified-peer limit when this is inbound capacity. */
  readonly peerLimit?: number
}>

/**
 * Local diagnostic observation. Optional fields depend on the event; this record is not a protocol
 * message or a permission to retry.
 */
export type IRpcHookEvent = {
  /** Stable event name identifying the diagnostic scenario. */
  readonly name: string
  /** Wall-clock epoch milliseconds used for diagnostic presentation. */
  readonly at: number
  /** Endpoint that emitted this observation. */
  readonly localId: string
  /** Semantic failure code when this event represents a failure. */
  readonly code?: string
  /** Original local diagnostic failure, when supplied. */
  readonly error?: unknown
  /** Field associated with a validation or callback failure. */
  readonly field?: string
  /** Rate-limited, local-only replay capacity evidence; never serialized onto RPC frames. */
  readonly detail?: IRpcReplayCapacityDetail
  /** Relative peer drain announced by a validated close control frame. */
  readonly durationMs?: number
  /** Contract diagnostic detail when relevant to this event. */
  readonly contract?: unknown
  /** Control-variation diagnostic value when present. */
  readonly variation?: unknown
  /** Logical target involved in this observation. */
  readonly targetId?: string
  /** Selected concrete receiver, if known. */
  readonly receiverId?: string
  /** Requester involved in a discovery observation. */
  readonly requesterId?: string
  /** Candidate receiver identities associated with the event. */
  readonly receiverIds?: readonly string[]
  /** Whether receiver selection observed multiple eligible candidates. */
  readonly ambiguous?: boolean
  /** Number of observed discovery responses, when supplied. */
  readonly responseCount?: number
}
/** Local diagnostic listener; it never settles an application request. */
export type IRpcHook = (event: IRpcHookEvent) => void | Promise<void>
/** One schema failure path suitable for locating invalid parameters or results. */
export type IRpcSchemaIssue = {
  /** Object keys and array indices leading to the invalid value. */
  readonly path: readonly (string | number)[]
  /** Schema-supplied explanation of the validation failure. */
  readonly message: string
  /** Optional schema-specific diagnostic code. */
  readonly code?: string
}
/**
 * Synchronous acceptance parser; validation may throw and does not replace the original application
 * payload.
 */
export type IRpcSchema<T = unknown> = {
  /** Accept or throw synchronously for one value. */ parse(value: unknown): T
}
/** Parameter and result validators for one method; both parsers must be present. */
export type IRpcMethodSchema = {
  /** Validate input before provider execution or outbound sending. */
  readonly params: IRpcSchema
  /** Validate successful response data before accepting it. */
  readonly result: IRpcSchema
}
/**
 * Optional application contract constraints; omitted fields add no application-version or
 * method-schema restriction.
 */
export type IRpcContractConfig = {
  /** Application version written to routed messages, when configured. */
  readonly version?: string
  /** Allowed incoming application versions; omission adds no explicit allow-list. */
  readonly acceptVersions?: readonly string[]
  /** Optional positive safe-integer application identifier limit. */
  readonly maxIdentifierLength?: number
  /**
   * Method-name map of parameter/result parsers; undeclared methods have no added schema
   * validation.
   */
  readonly schemas?: Readonly<Record<string, IRpcMethodSchema>>
}
/** Executable contract capability installed by contract middleware. */
export type IRpcContractCapability = IRpcContractConfig & {
  /** Validate one method side; invalid data throws a schema validation failure. */
  readonly validateData: (method: string, side: 'params' | 'result', data: unknown) => void
}
/**
 * Identity request passed to a configured generator; each variation selects its own correlation
 * domain.
 */
export type IRpcUuidContext = {
  /** Whether an identifier is needed for a task, message or control variation. */
  readonly variation: 'task' | 'message' | 'variation'
  /** Local sending endpoint identity. */
  readonly senderId: string
  /** Logical target, when already selected. */
  readonly targetId?: string
}
/** Optional identifier generator. Omission uses the canonical Core generator. */
export type IRpcUuidConfig = {
  /** Optional task/message/variation id generator; omission uses Core's generator. */ readonly generate?: (
    context: IRpcUuidContext
  ) => string
}
/**
 * Legacy transform-shaped configuration. The public protocol factory accepts a semantic protocol
 * descriptor, not this transform pair.
 */
export type IRpcProtocolConfig = {
  /** Optional legacy outbound transform. */
  readonly encode?: (value: unknown) => unknown
  /** Optional legacy inbound transform. */
  readonly decode?: (value: unknown) => unknown
  /** Legacy declared representation: any value, text, or Uint8Array. */
  readonly encodedType?: 'any' | 'string' | 'uint8array'
}
/** Normalized protocol capability installed by protocol middleware. */
export type IRpcProtocolCapability = {
  /** Encode an admitted semantic value for the next pipeline edge. */
  readonly encode: (value: unknown) => unknown
  /** Restore an encoded value before protocol admission. */
  readonly decode: (value: unknown) => unknown
  /** Declared intermediate representation, when provided. */
  readonly encodedType?: 'any' | 'string' | 'uint8array'
  /** Whether this capability explicitly preserves input identity. */
  readonly identity?: boolean
}
/** Direction and direct endpoint/carrier metadata supplied to a per-frame authentication transform. */
export type IRpcAuthenticationContext = {
  /** Whether the frame is leaving or entering the local endpoint. */
  readonly direction: 'outbound' | 'inbound'
  /** Local endpoint identity supplied to the transform. */
  readonly endpointId: string
  /** Actual transport platform label. */
  readonly platform: IRpcPlatformValue
}
/**
 * Protect or restore one frame, synchronously or asynchronously; transform failures follow
 * authentication diagnostics.
 */
export type IRpcAuthenticationTransform = (
  value: unknown,
  context: IRpcAuthenticationContext
) => unknown | Promise<unknown>
/**
 * Per-frame protection callbacks. Signing and verification must pair; encryption additionally
 * requires decryption and signing.
 */
export type IRpcAuthenticationConfig = {
  /** Optional outbound encryption; requires matching decrypt plus sign/verify. */
  readonly encrypt?: IRpcAuthenticationTransform
  /** Optional inverse of the configured encryption. */
  readonly decrypt?: IRpcAuthenticationTransform
  /** Outbound signature/protection transform paired with verify. */
  readonly sign?: IRpcAuthenticationTransform
  /** Inbound verification transform paired with sign. */
  readonly verify?: IRpcAuthenticationTransform
  /**
   * Protected representation; any, string or uint8array. Omission uses the middleware's any
   * representation.
   */
  readonly encodedType?: 'any' | 'string' | 'uint8array'
}
/** Executable per-frame protection installed by authentication middleware. */
export type IRpcAuthenticationCapability = {
  /** Immutable authentication owner reports its configured mode to endpoint probe descriptors. */
  readonly mode?: import('./probe/types.js').IRpcProbeDescriptor['authentication']
  /** Marks an installed executable protection capability. */
  readonly enabled: true
  /** Protected frame representation produced and accepted by this capability. */
  readonly encodedType: 'any' | 'string' | 'uint8array'
  /** Apply outbound protection; failures reject the current send. */
  readonly protect: IRpcAuthenticationTransform
  /** Verify and restore an inbound protected frame. */
  readonly unprotect: IRpcAuthenticationTransform
}
/**
 * Default request timeout policy. An empty installed timeout policy is unbounded; false explicitly
 * disables the deadline.
 */
export type IRpcTimeoutConfig = {
  /** Finite non-negative milliseconds or false; omission in timeout({}) leaves calls unbounded. */
  readonly timeoutMs?: number | false
}
/** Executable timeout capability installed by timeout middleware. */
export type IRpcTimeoutCapability = IRpcTimeoutConfig & {
  /**
   * Select an explicit per-call override or the installed default; preserve false and undefined for
   * the operation owner to interpret.
   */
  readonly resolveTimeout: (override?: number | false) => number | false | undefined
}
/** Initial diagnostic listeners and their failure reporter, captured during middleware installation. */
export type IRpcHooksConfig = {
  /** Initial hook or ordered hook array; defaults to no listeners. */
  readonly listeners?: IRpcHook | readonly IRpcHook[]
  /** Optional synchronous reporter for hook failures; omission uses Core's diagnostic policy. */
  readonly onHookError?: (error: unknown, event: IRpcHookEvent) => void
}
/** Direct incoming routing and native-source metadata available to connection verification. */
export type IRpcConnectContext = {
  /** Direct envelope sender identity. */
  readonly senderId: string
  /** Envelope target that must match this endpoint. */
  readonly targetId: string
  /** Carrier-established direct peer address, when known. */
  readonly peerId?: string
  /** Native origin associated with the delivery. */
  readonly origin?: string
  /** Native carrier source object, when available. */
  readonly source?: unknown
  /** Incoming value available to the selected verifier. */
  readonly data?: unknown
  /** Transport platform label for the current delivery. */
  readonly platform?: IRpcPlatformValue
  /** Exclusive, multiplexed or broadcast routing shape. */
  readonly topology?: 'exclusive' | 'multiplexed' | 'broadcast'
}
/** Local endpoint/carrier context for generating an instance discriminator during connection setup. */
export type IRpcUniqueTargetIdContext = {
  /** Local endpoint requesting an instance discriminator. */
  readonly endpointId: string
  /** Platform of the configured physical transport. */
  readonly platform: IRpcPlatformValue
}
/**
 * Connection verification and receiver selection. Automatic discovery and built-in identity
 * verification apply unless explicitly changed.
 */
export type IRpcConnectConfig = {
  /** Optional when factory.transport supplies the canonical transport. */
  readonly transport?: IRpcTransport
  /** Defaults to built-in verification. Explicit false additionally requires and invokes identifier. */
  readonly useBaseIdVerifyOnly?: boolean
  /** Instance discriminator or factory, used only with explicit false and a custom identifier. */
  readonly uniqueTargetId?:
    | string
    | ((context: IRpcUniqueTargetIdContext) => string | Promise<string>)
  /** Defaults to automatic; manual exposes explicit query and registration controls. */
  readonly discoveryMode?: 'automatic' | 'manual'
  /** Additional verifier used only when useBaseIdVerifyOnly is false; false rejects the peer. */
  readonly identifier?: (context: IRpcConnectContext) => boolean | Promise<boolean>
  /** Optional selector for a concrete registry candidate; an unknown selection fails TARGET_UNKNOWN. */
  readonly receiverSelector?: (
    serverList: readonly IRpcServerMetadata[],
    context: {
      /** Local endpoint selecting a receiver. */
      readonly endpointId: string
      /** Logical target whose known candidates are supplied. */
      readonly targetId: string
      /** Whether selection serves send, dispatch or ping. */
      readonly operation: IRpcOperation
    }
  ) => string | undefined | Promise<string | undefined>
}
/** Local receiver inspection and pinning available in automatic discovery mode. */
export type IRpcAutomaticConnectControl<TTargetId extends string = string> = Pick<
  IRpcConnectControl<TTargetId>,
  'getServerList' | 'pinReceiver' | 'unpinReceiver'
>
/** Manual discovery adds explicit query, acceptance, registration and candidate liveness operations. */
export type IRpcManualConnectControl<TTargetId extends string = string> =
  IRpcAutomaticConnectControl<TTargetId> &
    Required<
      Pick<IRpcConnectControl<TTargetId>, 'query' | 'onQuery' | 'register' | 'unregister' | 'ping'>
    >
/**
 * Automatic lets operations resolve receivers; manual exposes explicit discovery controls to the
 * connection owner.
 */
export type IRpcDiscoveryMode = 'automatic' | 'manual'
/** Select only the discovery controls published by the configured mode. */
export type IRpcConnectControlForMode<
  TTargetId extends string,
  TMode extends IRpcDiscoveryMode
> = TMode extends 'manual'
  ? IRpcManualConnectControl<TTargetId>
  : IRpcAutomaticConnectControl<TTargetId>
/** Executable peer-verification capability installed by connect middleware. */
export type IRpcConnectCapability = Omit<IRpcConnectConfig, 'uniqueTargetId'> & {
  /** Captured static discriminator admitted by the installed verification policy. */
  readonly uniqueTargetId?: string
  /** Captured dynamic discriminator factory, if enabled by the policy. */
  readonly uniqueTargetIdFactory?: (context: IRpcUniqueTargetIdContext) => string | Promise<string>
  /** Verify direct routing/source metadata; a rejected peer returns false. */
  readonly verify: (
    context: IRpcConnectContext,
    reportRead?: (failure: Readonly<{ key: PropertyKey; error: unknown }>) => undefined
  ) => boolean | Promise<boolean>
}
/**
 * Receiver registry observation, not a remote health guarantee. Times belong to this endpoint
 * scheduler.
 */
export type IRpcServerMetadata<TTargetId extends string = string> = {
  /** Logical service target registered by this receiver. */
  readonly targetId: TTargetId
  /** Concrete receiver identity usable for pinning. */
  readonly receiverId: string
  /** Optional instance discriminator established during verification. */
  readonly uniqueTargetId?: string
  /** Carrier platform on which this receiver was observed. */
  readonly platform: IRpcPlatformValue
  /** Native origin retained for the receiver, when supplied. */
  readonly origin?: string
  /**
   * Endpoint monotonic time (the endpoint scheduler's `now()`) when the receiver was registered.
   * Comparable only with other metadata of the same endpoint or with `IRpcTimePort.now()`.
   */
  readonly registeredAt: number
  /** Endpoint monotonic time of the last observation; same comparison domain as `registeredAt`. */
  readonly lastSeenAt: number
  /** Whether the logical target is explicitly pinned to this receiver. */
  readonly pinned: boolean
  /** Active, stale or unregistered registry state. */
  readonly status: IRpcCandidateStatus
}
/** Receiver inspection and manual-mode discovery controls. */
export type IRpcConnectControl<TTargetId extends string = string> = {
  /** Read receiver metadata, optionally limited to one logical target. */
  readonly getServerList: (targetId?: TTargetId) => readonly IRpcServerMetadata<TTargetId>[]
  /** Pin a known concrete receiver; anonymous or unknown targets cannot be pinned. */
  readonly pinReceiver: (targetId: TTargetId, receiverId: string) => void
  /** Clear the target's explicit receiver selection. */
  readonly unpinReceiver: (targetId: TTargetId) => void
  /** Collect candidates from one manual discovery query. */
  query?: (
    targetId: TTargetId,
    options?: { readonly timeoutMs?: number; readonly signal?: IAbortSignal }
  ) => Promise<readonly IRpcDiscoveryCandidate<TTargetId>[]>
  /** Subscribe to inbound manual queries and return that registration's remover. */
  onQuery?: (
    listener: (query: IRpcInboundDiscoveryQuery<TTargetId>) => void | Promise<void>
  ) => () => void
  /** Register a validated manual discovery response. */
  register?: (candidate: IRpcDiscoveryCandidate<TTargetId>) => void
  /** Retire one concrete receiver, or all registered receivers for a target. */
  unregister?: (targetId: TTargetId, receiverId?: string) => Promise<void>
  /** Check one candidate through the canonical control owner. */
  ping?: (
    candidate: IRpcDiscoveryCandidate<TTargetId>,
    options?: { readonly timeoutMs?: number; readonly signal?: IAbortSignal }
  ) => Promise<boolean>
}
/**
 * One received manual discovery query; accept or reject replies to that query without granting
 * arbitrary peer authority.
 */
export type IRpcInboundDiscoveryQuery<TTargetId extends string = string> = {
  /** Logical target requested by the remote query. */
  readonly targetId: TTargetId
  /** Query application payload. */
  readonly data: unknown
  /** Carrier that delivered the query. */
  readonly platform: IRpcPlatformValue
  /** Native delivery origin, when supplied. */
  readonly origin?: string
  /** Reply with optional data and resolve whether this query response was accepted. */
  readonly accept: (data?: unknown) => Promise<boolean>
  /** Reply with an optional rejection reason and resolve whether it was sent. */
  readonly reject: (reason?: string) => Promise<boolean>
}
/**
 * A query response candidate. Registration and verification decide whether it becomes a usable
 * receiver.
 */
export type IRpcDiscoveryCandidate<TTargetId extends string = string> = {
  /** Discovery request that produced this candidate. */
  readonly queryId: string
  /** Logical service target associated with the reply. */
  readonly targetId: TTargetId
  /** Concrete receiver address, when identifiable. */
  readonly receiverId?: string
  /** Candidate response payload. */
  readonly data: unknown
  /** Carrier on which the candidate was observed. */
  readonly platform: IRpcPlatformValue
  /** Native delivery origin, when available. */
  readonly origin?: string
}
/** Read and pin the endpoint receiver registry without issuing manual discovery traffic. */
export type IRpcDiscoveryControl<TTargetId extends string = string> = {
  /** Read the endpoint's receiver registry, optionally for one target. */
  readonly getServerList: (targetId?: TTargetId) => readonly IRpcServerMetadata<TTargetId>[]
  /** Choose one known concrete receiver for subsequent target resolution. */
  readonly pinReceiver: (targetId: TTargetId, receiverId: string) => void
  /** Return the target to ordinary receiver selection. */
  readonly unpinReceiver: (targetId: TTargetId) => void
}
/** Legacy optional control capability flags; current factories select explicit middleware roles. */
export type IRpcFeatureConfig = {
  /** Legacy remote-cancellation role flag. */ readonly abort?: boolean
  /** Legacy explicit-ping role flag. */ readonly ping?: boolean
}
/** Installed marker enabling remote cancellation notification through the canonical control path. */
export type IRpcAbortCapability = {
  /** Enables remote abort notification, not automatic application I/O cancellation. */ readonly enabled: true
}
/** Installed marker enabling ping controls; it does not start a heartbeat loop. */
export type IRpcPingCapability = {
  /** Enables explicit liveness control without scheduling a heartbeat. */ readonly enabled: true
}
/**
 * Per-target settlement of a fan-out request; one failed target does not discard successful
 * siblings.
 */
export type IRpcFanoutResult<TResult> = {
  /** Successful results indexed by target identity. */
  readonly fulfilled: Partial<Record<string, TResult>>
  /** Failures indexed by target identity, retaining the original rejection values. */
  readonly rejected: Partial<Record<string, unknown>>
}

/** Static claims admitted before a WebRPC plugin crosses the Host boundary. */
export type IRpcPluginClaims = {
  /** Inbound protocol routes reserved by this middleware. */
  readonly routes: readonly string[]
  /** Named capabilities contributed to the composition graph. */
  readonly provides: readonly string[]
  /** Required capability names that must be available in the composition. */
  readonly consumes: readonly string[]
  /** Exact endpoint extension keys this middleware publishes. */
  readonly publicKeys: readonly string[]
  /** Exact exposed capability keys used during admission. */
  readonly exposedKeys: readonly string[]
  /** Whether this role commits the prepared ingress activation. */
  readonly activator: boolean
}

/** Immutable metadata used by the composer to admit one domain plugin. */
export type IRpcPluginMetadata = {
  /** Static route, dependency and publication claims checked before installation. */
  readonly claims: IRpcPluginClaims
  /** Shared port keys this middleware owns, when declared. */
  readonly sharedProvides?: readonly PropertyKey[]
  /** Shared ports required from other installed roles. */
  readonly sharedConsumes?: readonly PropertyKey[]
  /** Optional shared ports that may be absent. */
  readonly sharedOptionalConsumes?: readonly PropertyKey[]
}

/** Host-neutral scope exposed to one WebRPC plugin install body. */
export type IRpcPluginInstallScope = {
  /** Stable local endpoint identity. */
  readonly id: string
  /** Selected physical transport; ownership remains with the endpoint kernel. */
  readonly transport: IRpcTransport
  /** Construction/registration cancellation signal. */
  readonly signal: INativeAbortSignal
  /** Emit a local diagnostic through the endpoint hook owner. */
  readonly hooks: (event: IRpcHookEvent) => void
  /** Read an admitted shared composition port. */
  readonly getPort: (key: PropertyKey) => unknown
  /** Register a release operation with this install scope for rollback and normal disposal. */
  own<T>(resource: T, release: () => void | Promise<void>): T
}

/** Immutable extension/shared result returned by a WebRPC plugin install. */
export type IRpcPluginInstallResult = {
  /** Endpoint extension values whose keys must match the declared publication claim. */
  readonly extension: Readonly<Record<string, unknown>>
  /** Shared port values whose keys must match declared providers. */
  readonly ports: Readonly<Record<PropertyKey, unknown>>
}

/** Public item contract used by migrated middleware without widening its component contribution. */
export type IRpcPlugin<TComponents extends object = {}> = {
  /** Unique middleware name; duplicates reject endpoint construction. */
  readonly name: string
  /** Static dependency, route and publication claims checked before activation. */
  readonly metadata: IRpcPluginMetadata
  /** Discovery mode retained on the native descriptor for factory conditional typing. */
  readonly discoveryMode?: IRpcDiscoveryMode
  /** Ping capability retained on the native descriptor for factory conditional typing. */
  readonly pingCapability?: true
  /** Runtime component slots stay opaque until tuple selection proves their exact contribution. */
  readonly transport?: unknown
  /** Optional semantic protocol component contributed to the pipeline. */
  readonly protocol?: unknown
  /** Optional codec component contributed to the pipeline. */
  readonly codec?: unknown
  /** Optional framing component contributed to the pipeline. */
  readonly framer?: unknown
  /** Install under the construction scope; acquired resources roll back on failure. */
  readonly install: (
    scope: IRpcPluginInstallScope
  ) => IRpcPluginInstallResult | Promise<IRpcPluginInstallResult>
} & Readonly<TComponents>

/** One factory tuple may contain legacy WebRPC middleware or direct PluginHost middleware. */
export type IRpcMiddleware = IRpcPlugin | IRpcNativeMiddleware
/**
 * Endpoint construction inputs. Invalid components reject construction and acquired resources roll
 * back before publication.
 */
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
    readonly signal?: IAbortSignal
    /** Bounds endpoint construction, or disables the deadline when explicitly `false`. */
    readonly timeoutMs?: number | false
  }
}
/**
 * Conditional ping methods selected by the middleware tuple; these do not run a background
 * heartbeat.
 */
export type IRpcPingEndpointSurface<TPing extends boolean> = boolean extends TPing
  ? {
      /** Probe one selected receiver; the Promise resolves true only for the admitted pong. */
      ping(targetId: string, receiverId?: string, options?: IRpcPingOptions): Promise<boolean>
      /** Probe configured receivers and retain individual successes/failures. */
      pingAll(): Promise<IRpcFanoutResult<boolean>>
    }
  : TPing extends true
    ? {
        /** Probe one selected receiver; the Promise resolves true only for the admitted pong. */
        ping(targetId: string, receiverId?: string, options?: IRpcPingOptions): Promise<boolean>
        /** Probe configured receivers and retain individual successes/failures. */
        pingAll(): Promise<IRpcFanoutResult<boolean>>
      }
    : {}
/** One liveness request budget and cancellation signal; false disables its local deadline. */
export type IRpcPingOptions = {
  /** Explicit finite non-negative budget, false for no deadline, or omitted to inherit policy. */
  readonly timeoutMs?: number | false
  /** Cancel local liveness waiting; cancellation is not proof of remote termination. */
  readonly signal?: IAbortSignal
}
/**
 * Bidirectional endpoint surface. Select smaller client/provider presets when only one role is
 * needed; dispose retires the endpoint and settles pending work.
 */
export type IRpcEndpoint<
  TTargetId extends string = string,
  TMode extends IRpcDiscoveryMode = 'automatic',
  TPing extends boolean = boolean
> = {
  /**
   * Register one request handler and return this endpoint; a duplicate name throws
   * PROVIDER_DUPLICATED without replacing it.
   */
  provide(method: string, provider: IRpcProvider): IRpcEndpoint<TTargetId, TMode, TPing>
  /** Subscribe to notification events; return the remover for this exact registration. */
  on(event: string, listener: IRpcEventListener): () => void
  /**
   * Request one target result; timeout, cancellation, remote and transport failures reject the
   * Promise.
   */
  send<T>(targetId: TTargetId, method: string, data: unknown, options?: ISendOptions): Promise<T>
  /** Request every configured target and collect each fulfillment or rejection separately. */
  sendAll<T>(method: string, data: unknown, options?: ISendOptions): Promise<IRpcFanoutResult<T>>
  /** Send a notification without a reply Promise; delivery failures are diagnostic. */
  dispatch(targetId: TTargetId, method: string, data: unknown): void
  /** Notify each configured target without collecting remote results. */
  dispatchAll(method: string, data: unknown): void
  /** Submit one atomic request group to an actually admitted native peer. */
  group(
    targetId: TTargetId,
    steps: IRpcRuntimeGroupSteps,
    options?: IRpcRuntimeGroupOptions
  ): Promise<readonly IRpcRuntimeStepOutcome[]>
  /** Read a logical key's original stored outcome without executing its providers again. */
  outcome(targetId: TTargetId, idempotencyKey: string): Promise<IRpcRuntimeOutcomeResult>
  /** Announce a bounded drain window to one peer without closing the channel in core. */
  announceClose(
    targetId: TTargetId,
    options: { readonly drainMs: number; readonly receiverId?: string }
  ): Promise<void>
  /** Mode-specific connection and receiver-selection controls. */
  readonly connect: IRpcConnectControlForMode<TTargetId, TMode>
  /** Local receiver inspection and pinning view. */
  readonly discovery: IRpcDiscoveryControl<TTargetId>
  /** Subscribe to local endpoint diagnostics; registration removal is caller-owned. */
  readonly hooks: { on(listener: IRpcHook): () => void }
  /**
   * Retire this endpoint, settle pending work and release owned resources; repeated calls share
   * terminal cleanup.
   */
  dispose(): Promise<void>
} & IRpcPingEndpointSurface<TPing>
/**
 * Asynchronous full endpoint constructor; resolution means its construction batch and ingress
 * activation have completed.
 */
export type IRpcEndpointFactory = <
  TTargetId extends string = string,
  TMiddlewares extends readonly IRpcMiddleware[] = readonly IRpcMiddleware[]
>(
  config: IRpcFactoryConfig<TTargetId, TMiddlewares>
) => Promise<
  IRpcEndpoint<TTargetId, IFactoryDiscoveryMode<TMiddlewares>, IFactoryPingCapability<TMiddlewares>>
>
