import {
  WebRpcAbortError,
  WebRpcAuthenticationError,
  WebRpcConstructionError,
  WebRpcError,
  WebRpcErrorCode,
  WebRpcContractError,
  WebRpcLifecycleError,
  WebRpcRemoteError,
  WebRpcSchemaValidationError,
  WebRpcTransportError,
  WebRpcTimeoutError
} from './errors';
import type {
  IWebRpcContractConfig,
  IWebRpcContractCapability,
  IWebRpcEndpoint,
  IWebRpcEventListener,
  IWebRpcHook,
  IWebRpcHookEvent,
  IWebRpcProvider,
  ISendOptions,
  IWebRpcUuidConfig,
  IWebRpcProtocolConfig,
  IWebRpcTimeoutConfig,
  IWebRpcTimeoutCapability,
  IWebRpcHooksConfig,
  IWebRpcChunkConfig,
  IWebRpcChunkCapability,
  IWebRpcConnectConfig,
  IWebRpcConnectCapability,
  IWebRpcFeatureConfig,
  IWebRpcFanoutResult,
  IWebRpcConnectControl,
  IWebRpcInboundDiscoveryQuery,
  IWebRpcDiscoveryControl,
  IWebRpcDiscoveryCandidate,
  IWebRpcPlatform,
  IWebRpcServerMetadata,
  IWebRpcProtocolCapability,
  IWebRpcAbortSignal,
  IWebRpcAuthenticationCapability
} from './typing';
import type {
  IWebRpcInboundMessage,
  IWebRpcTransport,
  IWebRpcTransportTopology
} from './transport';
import { WebRpcCapabilityRegistry, WebRpcRuntime } from './internal/runtime';
import type { PeerRegistry } from './internal/peers';
import { splitUtf8, utf8ByteLength } from './internal/chunk';
import { validateContractData } from './internal/contract';
import { allocateRpcId } from './internal/id';
import { WebRpcOutboundPipeline } from './internal/pipeline';
import { ProviderExecutor } from './internal/provider-executor';
import { executeWithRetry } from './internal/retry';
import { createSettlement } from './internal/settlement';
import { createSafeRecord, safeRead, safeString, tupleKey } from './internal/safe-value';
import { createRuntimeTimer, raceWithAsyncControl } from './internal/async-control';
import { ResourceScope } from './internal/resource-scope';
import { VerifiedPeerRegistry } from './internal/identity';
import { ReplayWindow } from './internal/replay';
import { RequestReplayLedger } from './internal/request-replay-ledger';
import { ProviderAdmissionRegistry } from './internal/provider-admission';
import { ControlTaskRegistry } from './internal/control-task-registry';
import { OperationScope } from './internal/operation-scope';
import { DiscoveryRegistry } from './internal/discovery-registry';
import { EndpointResourceManager } from './internal/endpoint-resource-manager';
import {
  registerEndpointDebugSnapshot,
  type IWebRpcEndpointDebugSnapshot
} from './internal/test-observer';
import {
  assertMethod,
  normalizeWebRpcEnvelope,
  type IWebRpcChunkFrame,
  type IWebRpcEnvelope,
  type IWebRpcRequest,
  type IWebRpcResponse,
  type IWebRpcDiscoveryQuery,
  type IWebRpcDiscoveryResponse
} from './wire';

let nextReceiverNonce = 0;

type IPendingTask = {
  method: string;
  targetId: string;
  receiverId?: string;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
  settleResolve: (value: unknown) => boolean;
  settleReject: (error: unknown) => boolean;
  abort?: () => void;
  verifiedPeerKey?: string;
};
type IInternalSendOptions = ISendOptions & {
  readonly receiverId?: string;
  readonly generation?: number;
  readonly verifiedPeerKey?: string;
};
type IWebRpcDelivery<TTargetId extends string> = {
  readonly target: TTargetId;
  readonly receiverId?: string;
  readonly key: string;
};
type IDiscoveryWaiter = {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
  readonly reject: (error: unknown) => void;
  references: number;
  taskId?: string;
  timer?: { readonly clear: () => void };
  sessionDeadlineAt?: number;
  settled: boolean;
};
type IManualDiscoveryWaiter<TTargetId extends string> = {
  readonly targetId: TTargetId;
  readonly resolve: (candidates: readonly IWebRpcDiscoveryCandidate<TTargetId>[]) => void;
  readonly reject: (error: unknown) => void;
  readonly candidates: IWebRpcDiscoveryCandidate<TTargetId>[];
  readonly candidateKeys: Set<string>;
  readonly candidatePeerCounts: Map<string, number>;
  readonly timer: { readonly clear: () => void };
  readonly signal?: IWebRpcAbortSignal;
  readonly onAbort?: () => void;
};
type IManualInboundQuery = {
  readonly queryId: string;
  readonly senderId: string;
  readonly targetId: string;
  readonly verifiedPeerKey: string;
  readonly data: unknown;
  readonly platform: IWebRpcPlatform;
  readonly origin?: string;
};
type IWebRpcEndpointOptions<TTargetId extends string> = {
  capabilities?: WebRpcCapabilityRegistry;
  contract?: IWebRpcContractConfig | IWebRpcContractCapability;
  uuid?: IWebRpcUuidConfig;
  protocol?: IWebRpcProtocolConfig | IWebRpcProtocolCapability;
  authentication?: IWebRpcAuthenticationCapability;
  timeout?: IWebRpcTimeoutConfig | IWebRpcTimeoutCapability;
  hooks?: IWebRpcHooksConfig;
  chunk?: IWebRpcChunkConfig | IWebRpcChunkCapability;
  targetIds?: readonly TTargetId[];
  connect?: IWebRpcConnectConfig | IWebRpcConnectCapability;
  features?: IWebRpcFeatureConfig;
  initialHookEvents?: readonly IWebRpcHookEvent[];
  replay?: { readonly maxEntries?: number; readonly ttlMs?: number };
};

export class WebRpcEndpoint<
  TTargetId extends string = string
> implements IWebRpcEndpoint<TTargetId> {
  readonly #id: string;
  readonly #transport: IWebRpcTransport;
  readonly #transportPlatform: IWebRpcPlatform;
  readonly #transportTopology: IWebRpcTransportTopology | undefined;
  readonly #transportOrigin: string | undefined;
  readonly #runtime: WebRpcRuntime<TTargetId>;
  readonly #contract: IWebRpcContractCapability;
  readonly #version: string;
  readonly #acceptedVersions: readonly string[];
  readonly #maxIdentifierLength: number;
  readonly #uuid: IWebRpcUuidConfig;
  readonly #protocol: IWebRpcProtocolCapability;
  readonly #authentication: IWebRpcAuthenticationCapability | undefined;
  readonly #timeout: IWebRpcTimeoutCapability;
  readonly #hooksConfig: IWebRpcHooksConfig;
  readonly #connect: IWebRpcConnectCapability | undefined;
  readonly #connectPeerId: string | undefined;
  readonly #connectOrigin: string | undefined;
  /** Binds an exclusive adapter connection to its first authenticated logical sender. */
  #exclusiveSenderId: string | undefined;
  readonly #features: IWebRpcFeatureConfig;
  readonly #pipeline: WebRpcOutboundPipeline<TTargetId>;
  readonly #providerExecutor: ProviderExecutor<TTargetId>;
  readonly #sourceTokens = new WeakMap<object, string>();
  readonly #requestReplay = new RequestReplayLedger(4096, 1024, 310_000, {
    retain: (peerKey) => this.#resourceManager.retainPeer(peerKey),
    release: (peerKey) => this.#resourceManager.releasePeer(peerKey)
  });
  /** Owns discovery/control completion tombstones and their verified identity leases. */
  readonly #discoveryReplay = new RequestReplayLedger(4096, 1024, 310_000, {
    retain: (peerKey) => this.#resourceManager.retainPeer(peerKey),
    release: (peerKey) => this.#resourceManager.releasePeer(peerKey)
  });
  /** Owns variation replay and unordered abort state. */
  readonly #controlTasks = new ControlTaskRegistry({
    retain: (peerKey) => this.#resourceManager.retainPeer(peerKey),
    release: (peerKey) => this.#resourceManager.releasePeer(peerKey)
  });
  readonly #maxClockSkewMs = 300_000;
  #nextSourceToken = 0;
  readonly #unsubscribe: () => void;
  readonly #unsubscribeTransportError: (() => void) | undefined;
  readonly #unsubscribeListenerError: (() => void) | undefined;
  readonly #resources = new ResourceScope();
  /** Central owner for outbound operation identifiers and lifecycle scopes. */
  readonly #resourceManager: EndpointResourceManager;
  #disposed = false;
  #receiveGeneration = 0;
  #disposePromise: Promise<void> | undefined;
  readonly #closing = new AbortController();
  readonly #discovery = new DiscoveryRegistry({
    retain: (token) => this.#resourceManager.retainPeer(token),
    release: (token) => this.#resourceManager.releasePeer(token)
  });
  readonly #multipleReceiverSnapshots = new Map<TTargetId, string>();
  readonly #receiverStaleAfterMs = 300_000;
  readonly #maxReceiversPerTarget = 64;
  /** Counts authenticated responses in each automatic discovery window for group diagnostics. */
  /** Bounds automatic discovery admission independently from replay retention. */
  /** Maximum automatic discovery queries admitted in one freshness window. */
  readonly #maxAutomaticDiscoveryAdmissions = 128;
  /** Maximum automatic discovery queries admitted from one verified peer. */
  readonly #maxAutomaticDiscoveryAdmissionsPerPeer = 32;
  /** Freshness window for automatic discovery admission accounting. */
  readonly #automaticDiscoveryAdmissionWindowMs = 60_000;
  /** Bounds an automatic discovery session when its caller allows an unbounded wait. */
  readonly #discoverySessionTtlMs = 1_000;
  /** Caps callers sharing one automatic discovery session. */
  readonly #maxDiscoveryWaitersPerSession = 64;
  /** Manual discovery listeners, active only when connect discovery mode is manual. */
  readonly #manualQueryListeners = new Set<
    (query: IWebRpcInboundDiscoveryQuery<TTargetId>) => void | Promise<void>
  >();
  /** Tracks manual query windows and prevents candidates from becoming DNS implicitly. */
  /** Tracks inbound manual queries until the endpoint explicitly accepts or rejects them. */
  /** Bounds manual query sessions awaiting application accept/reject decisions. */
  readonly #maxManualInboundQueries = 128;
  /** Bounds how long an inbound manual query may occupy an application decision slot. */
  readonly #manualInboundQueryTtlMs = 60_000;
  /** Owns expiry timers for inbound manual query sessions. */
  /** Bounds accepted manual candidates per query to cap response amplification. */
  readonly #maxManualCandidatesPerQuery = 128;
  /** Bounds accepted manual candidates from one verified peer per query. */
  readonly #maxManualCandidatesPerPeer = 32;
  /** Opaque identity proof and expiry for candidates produced by manual query windows. */
  /** Candidate receiver keys revoked by explicit manual unregister. */
  readonly #maxManualRevokedCandidates = 4096;
  /** Captures nested candidate routing metadata before callers can mutate response data. */
  #connectControl: IWebRpcConnectControl<TTargetId> | undefined;
  #discoveryControl: IWebRpcDiscoveryControl<TTargetId> | undefined;
  #nextReceiverId = 0;
  get #activeControllers(): Map<string, AbortController> {
    return this.#resourceManager.activeControllers;
  }
  get #peers(): PeerRegistry<TTargetId> {
    return this.#runtime.peers;
  }
  get #hooks(): WebRpcRuntime<TTargetId>['hooks'] {
    return this.#runtime.hooks;
  }

  constructor(
    id: string,
    transport: IWebRpcTransport,
    providers?: Readonly<Record<string, IWebRpcProvider>>,
    options: IWebRpcEndpointOptions<TTargetId> = {}
  ) {
    this.#runtime = new WebRpcRuntime(options.capabilities);
    const assertConfigObject = (value: unknown, label: string): void => {
      if (
        value !== undefined &&
        (value === null || typeof value !== 'object' || Array.isArray(value))
      )
        throw new WebRpcError(WebRpcErrorCode.invalidConfig, `${label} descriptor is invalid`);
    };
    const transportSend = safeRead<unknown>(transport, 'send');
    const transportSubscribe = safeRead<unknown>(transport, 'subscribe');
    const transportClose = safeRead<unknown>(transport, 'close');
    const onTransportError = safeRead<unknown>(transport, 'onTransportError');
    const onListenerError = safeRead<unknown>(transport, 'onListenerError');
    const transportPlatform = safeRead<unknown>(transport, 'platform');
    const transportTopology = safeRead<unknown>(transport, 'topology');
    const transportOrigin = safeRead<unknown>(transport, 'origin');
    const transportEncodedType = safeRead<unknown>(transport, 'encodedType');
    const transportOwnership = safeRead<unknown>(transport, 'ownership');
    if (typeof transportSend !== 'function' || typeof transportSubscribe !== 'function')
      throw new WebRpcError(WebRpcErrorCode.invalidConfig, 'transport descriptor is invalid');
    if (
      (transportClose !== undefined && typeof transportClose !== 'function') ||
      (onTransportError !== undefined && typeof onTransportError !== 'function') ||
      (onListenerError !== undefined && typeof onListenerError !== 'function')
    )
      throw new WebRpcError(WebRpcErrorCode.invalidConfig, 'transport descriptor is invalid');
    if (
      !this.#isPlatform(transportPlatform) ||
      (transportTopology !== undefined &&
        transportTopology !== 'exclusive' &&
        transportTopology !== 'multiplexed' &&
        transportTopology !== 'broadcast') ||
      (transportOrigin !== undefined && typeof transportOrigin !== 'string') ||
      (transportEncodedType !== undefined &&
        transportEncodedType !== 'any' &&
        transportEncodedType !== 'string' &&
        transportEncodedType !== 'uint8array') ||
      (transportOwnership !== undefined &&
        transportOwnership !== 'owned' &&
        transportOwnership !== 'borrowed')
    )
      throw new WebRpcError(
        WebRpcErrorCode.invalidConfig,
        'transport identity descriptor is invalid'
      );
    this.#transportPlatform = transportPlatform as IWebRpcPlatform;
    this.#transportTopology = transportTopology as IWebRpcTransportTopology | undefined;
    this.#transportOrigin = transportOrigin as string | undefined;
    assertConfigObject(options.contract, 'contract');
    assertConfigObject(options.uuid, 'uuid');
    assertConfigObject(options.protocol, 'protocol');
    assertConfigObject(options.authentication, 'authentication');
    assertConfigObject(options.timeout, 'timeout');
    assertConfigObject(options.hooks, 'hooks');
    assertConfigObject(options.chunk, 'chunk');
    assertConfigObject(providers, 'provider');
    assertConfigObject(options.features, 'features');
    assertConfigObject(options.replay, 'replay');
    if (
      options.replay?.maxEntries !== undefined &&
      (!Number.isSafeInteger(options.replay.maxEntries) || options.replay.maxEntries < 1)
    )
      throw new WebRpcError(WebRpcErrorCode.invalidConfig, 'replay.maxEntries must be positive');
    if (
      options.replay?.ttlMs !== undefined &&
      (!Number.isSafeInteger(options.replay.ttlMs) || options.replay.ttlMs < 1)
    )
      throw new WebRpcError(WebRpcErrorCode.invalidConfig, 'replay.ttlMs must be positive');
    const replay = new ReplayWindow(options.replay?.maxEntries, options.replay?.ttlMs);
    const verifiedPeers = new VerifiedPeerRegistry();
    const providerAdmission = new ProviderAdmissionRegistry();
    this.#resourceManager = new EndpointResourceManager(replay, this.#resources, verifiedPeers);
    this.#resourceManager.attachRuntime(this.#runtime.chunks, providerAdmission);
    this.#resourceManager.attachCallerSettlement(() => {
      const disposalError = new WebRpcLifecycleError('Endpoint disposed');
      for (const pending of this.#resourceManager.pending.values())
        (pending as IPendingTask).settleReject(disposalError);
      for (const taskId of this.#resourceManager.pingPending.keys())
        this.#resourceManager.getPingPending(taskId)?.settle(false);
    });
    this.#resourceManager.attachProviderRegistry(this.#runtime.provider);
    this.#resourceManager.attachDiscoveryRegistry(() =>
      this.#discovery.close(new WebRpcLifecycleError('endpoint disposed'))
    );
    this.#resourceManager.registerReplayOwner(this.#requestReplay);
    this.#resourceManager.registerReplayOwner(this.#discoveryReplay);
    this.#resourceManager.registerReplayOwner(this.#controlTasks);
    this.#resourceManager.registerMaintenanceOwner({
      purge: (now) =>
        this.#discovery.purgeAdmissions(now - this.#automaticDiscoveryAdmissionWindowMs),
      clear: () => this.#discovery.clearAdmissions()
    });
    const contractConfig = options.contract ?? {};
    if ('validateData' in contractConfig && typeof contractConfig.validateData !== 'function')
      throw new WebRpcError(
        WebRpcErrorCode.invalidConfig,
        'contract.validateData must be a function'
      );
    const contractSnapshot: IWebRpcContractConfig = {
      ...contractConfig,
      schemas: contractConfig.schemas ? { ...contractConfig.schemas } : undefined
    };
    const contract: IWebRpcContractCapability = {
      ...contractSnapshot,
      validateData:
        'validateData' in contractConfig && contractConfig.validateData
          ? (contractConfig.validateData as IWebRpcContractCapability['validateData'])
          : (method, side, data) => validateContractData(contractSnapshot, method, side, data)
    };
    const uuid = options.uuid ?? {};
    if ('generate' in uuid && typeof uuid.generate !== 'function')
      throw new WebRpcError(WebRpcErrorCode.invalidConfig, 'uuid.generate must be a function');
    const protocolConfig = options.protocol ?? {};
    if (protocolConfig.encode !== undefined && typeof protocolConfig.encode !== 'function')
      throw new WebRpcError(WebRpcErrorCode.invalidConfig, 'protocol.encode must be a function');
    if (protocolConfig.decode !== undefined && typeof protocolConfig.decode !== 'function')
      throw new WebRpcError(WebRpcErrorCode.invalidConfig, 'protocol.decode must be a function');
    if (
      protocolConfig.encodedType !== undefined &&
      !['any', 'string', 'uint8array'].includes(protocolConfig.encodedType)
    )
      throw new WebRpcError(WebRpcErrorCode.invalidConfig, 'protocol.encodedType is invalid');
    const protocol: IWebRpcProtocolCapability = {
      ...protocolConfig,
      encode: protocolConfig.encode ?? ((value: unknown): unknown => value),
      decode: protocolConfig.decode ?? ((value: unknown): unknown => value)
    };
    const authentication = options.authentication;
    if (
      authentication &&
      (authentication.enabled !== true ||
        typeof authentication.protect !== 'function' ||
        typeof authentication.unprotect !== 'function' ||
        !['any', 'string', 'uint8array'].includes(authentication.encodedType))
    )
      throw new WebRpcError(WebRpcErrorCode.invalidConfig, 'authentication capability is invalid');
    if (
      transportEncodedType &&
      transportEncodedType !== 'any' &&
      (authentication?.encodedType ?? protocolConfig.encodedType) !== transportEncodedType
    )
      throw new WebRpcError(
        WebRpcErrorCode.invalidConfig,
        'outbound frame and transport encoded types are incompatible'
      );
    const timeoutConfig = options.timeout ?? {};
    const retryConfig = timeoutConfig.retry;
    if (
      retryConfig !== undefined &&
      (retryConfig === null ||
        typeof retryConfig !== 'object' ||
        Array.isArray(retryConfig) ||
        (retryConfig.shouldRetry !== undefined && typeof retryConfig.shouldRetry !== 'function') ||
        (retryConfig.delay !== undefined && typeof retryConfig.delay !== 'function'))
    )
      throw new WebRpcError(WebRpcErrorCode.invalidConfig, 'retry descriptor is invalid');
    if (
      timeoutConfig.retry?.maxAttempts !== undefined &&
      (!Number.isSafeInteger(timeoutConfig.retry.maxAttempts) ||
        timeoutConfig.retry.maxAttempts < 1)
    )
      throw new WebRpcError(
        WebRpcErrorCode.invalidConfig,
        'retry maxAttempts must be a positive safe integer'
      );
    if ('resolveTimeout' in timeoutConfig && typeof timeoutConfig.resolveTimeout !== 'function')
      throw new WebRpcError(WebRpcErrorCode.invalidConfig, 'resolveTimeout must be a function');
    /** Bounds operations when the caller does not explicitly opt into indefinite waiting. */
    const timeoutDefault = timeoutConfig.timeoutMs ?? 1000;
    const timeout: IWebRpcTimeoutCapability = {
      ...timeoutConfig,
      resolveTimeout:
        'resolveTimeout' in timeoutConfig && timeoutConfig.resolveTimeout
          ? (timeoutConfig.resolveTimeout as IWebRpcTimeoutCapability['resolveTimeout'])
          : (override) => (override === undefined ? timeoutDefault : override)
    };
    const hooksConfig = options.hooks ?? {};
    const chunkConfig = options.chunk ?? {};
    const listeners = hooksConfig.listeners;
    if (
      (listeners !== undefined &&
        (Array.isArray(listeners)
          ? listeners.some((listener) => typeof listener !== 'function')
          : typeof listeners !== 'function')) ||
      (hooksConfig.onHookError !== undefined && typeof hooksConfig.onHookError !== 'function')
    )
      throw new WebRpcError(WebRpcErrorCode.invalidConfig, 'hooks descriptor is invalid');
    if (options.initialHookEvents !== undefined && !Array.isArray(options.initialHookEvents))
      throw new WebRpcError(WebRpcErrorCode.invalidConfig, 'initialHookEvents must be an array');
    for (const [name, value] of [
      ['chunkSize', chunkConfig.chunkSize],
      ['maxMessageBytes', chunkConfig.maxMessageBytes],
      ['maxConcurrentMessages', chunkConfig.maxConcurrentMessages],
      ['maxConcurrentMessagesPerPeer', chunkConfig.maxConcurrentMessagesPerPeer],
      ['maxBufferedBytes', chunkConfig.maxBufferedBytes],
      ['maxChunksPerMessage', chunkConfig.maxChunksPerMessage],
      ['maxChunkBytes', chunkConfig.maxChunkBytes],
      ['assemblyTimeoutMs', chunkConfig.assemblyTimeoutMs]
    ] as const) {
      if (value !== undefined && (!Number.isSafeInteger(value) || value <= 0))
        throw new WebRpcError(
          WebRpcErrorCode.invalidConfig,
          `${name} must be a positive safe integer`
        );
    }
    if (chunkConfig.chunkSize !== undefined && chunkConfig.chunkSize < 4)
      throw new WebRpcError(
        WebRpcErrorCode.invalidConfig,
        'chunkSize must be at least 4 bytes for UTF-8 code points'
      );
    if ('byteLength' in chunkConfig && typeof chunkConfig.byteLength !== 'function')
      throw new WebRpcError(WebRpcErrorCode.invalidConfig, 'chunk.byteLength must be a function');
    if ('split' in chunkConfig && typeof chunkConfig.split !== 'function')
      throw new WebRpcError(WebRpcErrorCode.invalidConfig, 'chunk.split must be a function');
    const chunk: IWebRpcChunkCapability = {
      ...chunkConfig,
      byteLength:
        'byteLength' in chunkConfig && chunkConfig.byteLength
          ? (chunkConfig.byteLength as IWebRpcChunkCapability['byteLength'])
          : utf8ByteLength,
      split:
        'split' in chunkConfig && chunkConfig.split
          ? (chunkConfig.split as IWebRpcChunkCapability['split'])
          : splitUtf8
    };
    if (options.targetIds !== undefined && !Array.isArray(options.targetIds))
      throw new WebRpcError(WebRpcErrorCode.invalidConfig, 'targetIds must be an array');
    const targetIds = options.targetIds ?? [];
    const connectConfig = options.connect;
    if (
      connectConfig !== undefined &&
      (connectConfig === null ||
        (typeof connectConfig !== 'object' && typeof connectConfig !== 'function'))
    )
      throw new WebRpcError(WebRpcErrorCode.invalidConfig, 'connect descriptor is invalid');
    if (connectConfig && !connectConfig.transport)
      throw new WebRpcError(WebRpcErrorCode.invalidConfig, 'connect transport is required');
    if (connectConfig?.identifier !== undefined && typeof connectConfig.identifier !== 'function')
      throw new WebRpcError(WebRpcErrorCode.invalidConfig, 'connect identifier must be a function');
    if (
      connectConfig &&
      'verify' in connectConfig &&
      connectConfig.verify !== undefined &&
      typeof connectConfig.verify !== 'function'
    )
      throw new WebRpcError(WebRpcErrorCode.invalidConfig, 'connect.verify must be a function');
    const connectIdentifier = connectConfig?.identifier;
    const connectUseBaseIdVerifyOnly = connectConfig?.useBaseIdVerifyOnly;
    const connectPeerId = safeRead<unknown>(connectConfig?.transport, 'peerId');
    const connectOrigin = safeRead<unknown>(connectConfig?.transport, 'origin');
    const connectTopology = safeRead<unknown>(connectConfig?.transport, 'topology');
    const connectPlatform = safeRead<unknown>(connectConfig?.transport, 'platform');
    if (
      connectConfig &&
      ((connectPeerId !== undefined && typeof connectPeerId !== 'string') ||
        (connectOrigin !== undefined && typeof connectOrigin !== 'string') ||
        (connectTopology !== undefined &&
          connectTopology !== 'exclusive' &&
          connectTopology !== 'multiplexed' &&
          connectTopology !== 'broadcast'))
    )
      throw new WebRpcError(
        WebRpcErrorCode.invalidConfig,
        'connect identity descriptor is invalid'
      );
    const connect: IWebRpcConnectCapability | undefined = connectConfig
      ? {
          ...connectConfig,
          uniqueTargetId:
            typeof connectConfig.uniqueTargetId === 'string'
              ? connectConfig.uniqueTargetId
              : undefined,
          verify:
            'verify' in connectConfig && connectConfig.verify
              ? (connectConfig.verify as IWebRpcConnectCapability['verify'])
              : async (context) => {
                  const peerId = context.peerId ?? (connectPeerId as string | undefined);
                  const peerIdentity = Boolean(peerId) && context.senderId === peerId;
                  const originIdentity =
                    connectOrigin !== undefined && context.origin === connectOrigin;
                  const identifierSource =
                    connectUseBaseIdVerifyOnly === false &&
                    (context.source !== undefined ||
                      safeRead(context.data, '__unique_id__') !== undefined);
                  // BroadcastChannel has no physical sender/source identity.  The adapter-owned
                  // platform/topology pair is the only honest-peer admission signal available in
                  // anonymous mode; authenticated/identified configurations still run their
                  // identifier or frame verification below.
                  const anonymousBroadcast =
                    connectPlatform === 'BroadcastChannel' &&
                    connectTopology === 'broadcast' &&
                    connectConfig?.uniqueTargetId === undefined &&
                    context.platform === 'BroadcastChannel' &&
                    context.source == null &&
                    !context.peerId;
                  const exclusiveBinding =
                    (connectTopology === 'exclusive' ||
                      (connectTopology === undefined &&
                        connectPlatform !== 'Worker' &&
                        connectPlatform !== 'BroadcastChannel' &&
                        connectPlatform !== 'Iframe')) &&
                    context.targetId === id;
                  const baseVerified =
                    context.targetId === id &&
                    (exclusiveBinding ||
                      peerIdentity ||
                      originIdentity ||
                      identifierSource ||
                      anonymousBroadcast);
                  if (!baseVerified) return false;
                  if (connectUseBaseIdVerifyOnly !== false) return true;
                  if (!connectIdentifier)
                    throw new WebRpcContractError(
                      'identifier is required when base verification is disabled'
                    );
                  return connectIdentifier(context);
                }
        }
      : undefined;
    const features = options.features ?? { abort: true, ping: true };
    if (
      (features.abort !== undefined && typeof features.abort !== 'boolean') ||
      (features.ping !== undefined && typeof features.ping !== 'boolean')
    )
      throw new WebRpcError(WebRpcErrorCode.invalidConfig, 'features descriptor is invalid');
    if (typeof id !== 'string' || id.length === 0)
      throw new WebRpcError(WebRpcErrorCode.invalidConfig, 'id must be a non-empty string');
    if (
      typeof contract.version !== 'undefined' &&
      (typeof contract.version !== 'string' || contract.version.length === 0)
    )
      throw new WebRpcContractError('contract version must be a non-empty string');
    if (
      !Number.isSafeInteger(contract.maxIdentifierLength ?? 128) ||
      (contract.maxIdentifierLength ?? 128) <= 0
    )
      throw new WebRpcContractError('maxIdentifierLength must be a positive safe integer');
    if (
      contract.acceptVersions &&
      !contract.acceptVersions.every((version) => typeof version === 'string' && version.length > 0)
    )
      throw new WebRpcContractError('acceptVersions must contain non-empty strings');
    this.#id = id;
    this.#transport = transport;
    this.#contract = contract;
    this.#version = contract.version ?? '1.0';
    this.#acceptedVersions = contract.acceptVersions ?? [this.#version];
    this.#maxIdentifierLength = contract.maxIdentifierLength ?? 128;
    this.#validateIdentifier(id, 'id');
    this.#uuid = uuid;
    this.#protocol = protocol;
    this.#authentication = authentication;
    this.#timeout = timeout;
    this.#hooksConfig = hooksConfig;
    for (const targetId of targetIds) {
      if (targetId === id) continue;
      this.#validateIdentifier(targetId, 'targetId');
      this.#peers.add(targetId, true);
    }
    this.#connect = connect;
    this.#connectPeerId = safeRead<string>(connect?.transport, 'peerId');
    this.#connectOrigin = safeRead<string>(connect?.transport, 'origin');
    this.#features = features;
    this.#pipeline = new WebRpcOutboundPipeline(
      transport,
      id,
      protocol,
      chunk,
      (code, error) => this.#emit({ name: 'variation.failure', code, error }),
      authentication,
      this.#transportPlatform,
      (messageId) => this.#resourceManager.releaseId(messageId)
    );
    this.#runtime.chunks.configure(chunk);
    this.#runtime.chunks.observe((name, messageId, peerKey) => {
      if (name === 'chunk.expired' && messageId !== undefined && peerKey !== undefined)
        this.#resourceManager.releaseChunk(messageId, peerKey);
      this.#emit({ name, code: WebRpcErrorCode.internal });
    });
    this.#providerExecutor = new ProviderExecutor({
      id,
      registry: this.#runtime.provider,
      controllers: this.#resourceManager,
      admission: this.#resourceManager,
      retainBinding: (verifiedPeerKey) => this.#resourceManager.retainPeer(verifiedPeerKey),
      releaseBinding: (verifiedPeerKey) => this.#resourceManager.releasePeer(verifiedPeerKey),
      peers: this.#peers,
      dispatch: (targetId, method, data) => this.dispatch(targetId, method, data),
      send: (response, transfer) => Promise.resolve().then(() => this.#send(response, transfer)),
      validate: (method, side, data) => this.#validateData(method, side, data),
      emitFailure: (error, code) => this.#emit({ name: 'failure', error, code }),
      isReplay: (request, verifiedPeerKey) => {
        const key = tupleKey(verifiedPeerKey, request.senderId, request.taskId);
        return this.#isCompletedTask(key) || this.#requestReplay.has(key);
      },
      admitReplay: (request, verifiedPeerKey) =>
        this.#requestReplay.admit(
          tupleKey(verifiedPeerKey, request.senderId, request.taskId),
          verifiedPeerKey
        ),
      consumePendingAbort: (key) => {
        return this.#controlTasks.consumeAbort(key);
      }
    });
    const configuredHooks = hooksConfig.listeners
      ? Array.isArray(hooksConfig.listeners)
        ? hooksConfig.listeners
        : [hooksConfig.listeners]
      : [];
    for (const listener of configuredHooks) this.#hooks.add(listener);
    for (const event of options.initialHookEvents ?? []) this.#emit(event);
    for (const [method, provider] of Object.entries(providers ?? {}))
      this.provide(method, provider);
    if (transportOwnership !== 'borrowed') {
      const closeTransport = () => (transportClose as IWebRpcTransport['close'] | undefined)?.();
      this.#resources.add('transport close', async () => closeTransport(), 'critical');
    }
    try {
      this.#unsubscribe = (transportSubscribe as IWebRpcTransport['subscribe'])((message) => {
        void this.#receive(message).catch((error) => {
          this.#emit({ name: 'receive.failure', code: WebRpcErrorCode.internal, error });
        });
      });
      this.#resources.add('transport subscription', this.#unsubscribe, 'critical');
      this.#unsubscribeTransportError = (
        onTransportError as IWebRpcTransport['onTransportError'] | undefined
      )?.((error) => this.#failTransport(error));
      if (this.#unsubscribeTransportError)
        this.#resources.add(
          'transport error subscription',
          this.#unsubscribeTransportError,
          'critical'
        );
      this.#unsubscribeListenerError = (
        onListenerError as IWebRpcTransport['onListenerError'] | undefined
      )?.((error) =>
        this.#emit({ name: 'transport.listener.failure', code: WebRpcErrorCode.transport, error })
      );
      if (this.#unsubscribeListenerError)
        this.#resources.add(
          'listener error subscription',
          this.#unsubscribeListenerError,
          'critical'
        );
    } catch (error) {
      const cleanupPromise = this.#resources.releaseAll();
      throw new WebRpcConstructionError(
        safeString(safeRead(error, 'message'), 'Endpoint registration failed'),
        error,
        [],
        cleanupPromise
      );
    }
    registerEndpointDebugSnapshot(this, () => this.#debugSnapshot());
  }

  /** Builds the package-test lifecycle snapshot without widening the public endpoint contract. */
  #debugSnapshot(): IWebRpcEndpointDebugSnapshot {
    return {
      phase: this.#disposed ? 'disposed' : 'active',
      pending: this.#resourceManager.pendingSize,
      pingPending: this.#resourceManager.pingPendingSize,
      activeControllers: this.#activeControllers.size,
      chunks: this.#runtime.chunks.size,
      providers: this.#runtime.provider.providers.size,
      events: [...this.#runtime.provider.events.values()].reduce(
        (total, listeners) => total + listeners.length,
        0
      ),
      hooks: this.#hooks.size,
      resources: this.#resourceManager.size,
      discovery: this.#discovery.debugSnapshot()
    };
  }

  get hooks(): { on(listener: IWebRpcHook): () => void } {
    return {
      on: (listener) => {
        this.#assertActive();
        if (typeof listener !== 'function')
          throw new WebRpcError(WebRpcErrorCode.invalidConfig, 'hook listener must be a function');
        return this.#hooks.add(listener);
      }
    };
  }
  /** Exposes local receiver registration and immutable discovery snapshots. */
  get connect(): IWebRpcConnectControl<TTargetId> {
    const controls: IWebRpcConnectControl<TTargetId> = {
      getServerList: (targetId) => this.#getServerList(targetId),
      pinReceiver: (targetId, receiverId) => this.#pinReceiver(targetId, receiverId),
      unpinReceiver: (targetId) => this.#unpinReceiver(targetId)
    };
    if (this.#connect?.discoveryMode === 'manual') {
      controls.query = (targetId, options) => this.#manualQuery(targetId, options);
      controls.onQuery = (listener) => {
        this.#assertActive();
        if (typeof listener !== 'function')
          throw new WebRpcError(WebRpcErrorCode.invalidConfig, 'query listener must be a function');
        if (this.#manualQueryListeners.size > 0)
          throw new WebRpcError(
            WebRpcErrorCode.capabilityConflict,
            'only one manual query listener may be registered'
          );
        this.#manualQueryListeners.add(listener);
        return () => this.#manualQueryListeners.delete(listener);
      };
      controls.register = (candidate) => this.#manualRegister(candidate);
      controls.unregister = (targetId, receiverId) => this.#manualUnregister(targetId, receiverId);
      if (this.#features.ping === true)
        controls.ping = (candidate, options) => this.#manualPing(candidate, options);
    }
    return (this.#connectControl ??= controls);
  }
  /** Exposes remote discovery snapshots and receiver pinning without local registration controls. */
  get discovery(): IWebRpcDiscoveryControl<TTargetId> {
    return (this.#discoveryControl ??= {
      getServerList: (targetId) => this.#getServerList(targetId),
      pinReceiver: (targetId, receiverId) => this.#pinReceiver(targetId, receiverId),
      unpinReceiver: (targetId) => this.#unpinReceiver(targetId)
    });
  }
  addDisposer(disposer: () => void | Promise<void>): void {
    this.#resources.add('middleware', disposer);
  }
  provide(method: string, provider: IWebRpcProvider): this {
    this.#assertActive();
    assertMethod(method);
    if (typeof provider !== 'function')
      throw new WebRpcError(WebRpcErrorCode.invalidConfig, 'provider must be a function');
    if (!this.#runtime.provider.register(method, provider))
      throw new WebRpcError(
        WebRpcErrorCode.providerDuplicated,
        `Provider already registered: ${method}`
      );
    return this;
  }
  on(event: string, listener: IWebRpcEventListener): () => void {
    this.#assertActive();
    assertMethod(event);
    this.#validateIdentifier(event, 'event');
    if (typeof listener !== 'function')
      throw new WebRpcError(WebRpcErrorCode.invalidConfig, 'event listener must be a function');
    return this.#runtime.provider.listen(event, listener);
  }
  async send<T>(
    targetId: TTargetId,
    method: string,
    data: unknown,
    options: ISendOptions = {}
  ): Promise<T> {
    this.#assertActive();
    const operationGeneration = this.#receiveGeneration;
    this.#validateIdentifier(targetId, 'targetId');
    assertMethod(method);
    this.#validateIdentifier(method, 'method');
    this.#validateData(method, 'params', data);
    if (options.signal) {
      const probe = (): void => undefined;
      options.signal.addEventListener('abort', probe, { once: true });
      options.signal.removeEventListener('abort', probe);
      if (options.signal.aborted) throw new WebRpcAbortError();
    }
    const sendTimeoutMs = this.#timeout.resolveTimeout(options.timeoutMs);
    this.#assertValidTimeout(sendTimeoutMs);
    const operationScope = new OperationScope(
      operationGeneration,
      sendTimeoutMs,
      this.#closing.signal
    );
    const remainingTimeout = (): number | false | undefined => {
      return operationScope.remaining(sendTimeoutMs);
    };
    const retry = this.#timeout.retry;
    return executeWithRetry<T>({
      maxAttempts: retry ? (retry.maxAttempts ?? 1) : 1,
      signals: [operationScope.signal, ...(options.signal ? [options.signal] : [])],
      createAbortError: () => new WebRpcAbortError(),
      createTimeoutError: () => new WebRpcTimeoutError(),
      remainingTimeout,
      onDiagnostic: (error) =>
        this.#emit({ name: 'failure', code: WebRpcErrorCode.internal, error }),
      attempt: async () => {
        this.#assertOperationActive(operationGeneration);
        const attemptTimeout = remainingTimeout();
        if (attemptTimeout === 0) throw new WebRpcTimeoutError();
        const receiverOverride = (options as IInternalSendOptions).receiverId;
        if (receiverOverride !== undefined)
          this.#assertReceiverAvailable(targetId, receiverOverride);
        else
          await raceWithAsyncControl({
            operation: () => this.#discoverTargetIfNeeded(targetId, attemptTimeout, options.signal),
            timeoutMs: attemptTimeout,
            signals: options.signal === undefined ? undefined : [options.signal],
            createTimeoutError: () => new WebRpcTimeoutError(),
            createAbortError: () => new WebRpcAbortError(),
            onDiagnostic: (error) =>
              this.#emit({ name: 'failure', code: WebRpcErrorCode.internal, error })
          });
        const selectedReceiver =
          receiverOverride === undefined
            ? await this.#receiverForOperation(targetId, 'send', remainingTimeout(), options.signal)
            : {
                receiverId: receiverOverride,
                verifiedPeerKey: this.#discovery.getRemoteBinding(
                  tupleKey(targetId, receiverOverride)
                )
              };
        const request: IWebRpcRequest = {
          kind: 'request',
          version: this.#version,
          taskId: this.#makeId('task', targetId),
          senderId: this.#id,
          targetId,
          method,
          data,
          sentAt: Date.now(),
          receiverId: selectedReceiver.receiverId
        };
        const requestTimeout = remainingTimeout();
        if (requestTimeout === 0) throw new WebRpcTimeoutError();
        const attemptOptions =
          requestTimeout === sendTimeoutMs ? options : { ...options, timeoutMs: requestTimeout };
        return this.#request<T>(request, {
          ...attemptOptions,
          verifiedPeerKey: selectedReceiver.verifiedPeerKey,
          generation: operationGeneration
        } as IInternalSendOptions);
      },
      decide: async (error, attempt) => {
        if (
          !retry ||
          error instanceof WebRpcAbortError ||
          error instanceof WebRpcTimeoutError ||
          error instanceof WebRpcLifecycleError ||
          error instanceof WebRpcSchemaValidationError ||
          error instanceof WebRpcContractError ||
          (error instanceof WebRpcRemoteError && !retry.shouldRetry)
        )
          return { retry: false };
        const remaining = remainingTimeout();
        if (remaining === 0) throw new WebRpcTimeoutError();
        const context = { attempt, error, targetId: String(targetId), method, data };
        if (retry.shouldRetry && !(await retry.shouldRetry(context))) return { retry: false };
        const delay = retry.delay ? await retry.delay(context) : 0;
        if (delay === false || delay === null) return { retry: false };
        return {
          retry: true,
          delayMs:
            remaining === false || remaining === undefined ? delay : Math.min(delay, remaining)
        };
      }
    }).finally(() => operationScope.abort());
  }
  async sendAll<T>(
    method: string,
    data: unknown,
    options?: ISendOptions
  ): Promise<IWebRpcFanoutResult<T>> {
    this.#assertActive();
    assertMethod(method);
    this.#validateIdentifier(method, 'method');
    this.#validateData(method, 'params', data);
    const targets = this.#fanoutTargets();
    const deliveries = targets.flatMap<IWebRpcDelivery<TTargetId>>((target) => {
      const pinned = this.#discovery.getPin(target);
      const receivers = this.#getServerList(target).filter(
        (entry) =>
          entry.status === 'active' && (pinned === undefined || entry.receiverId === pinned)
      );
      if (pinned !== undefined && receivers.length === 0)
        return [{ target, receiverId: pinned, key: this.#fanoutDeliveryKey(target, pinned) }];
      return receivers.length
        ? receivers.map((entry) => ({
            target,
            receiverId: entry.receiverId,
            key: this.#fanoutDeliveryKey(target, entry.receiverId)
          }))
        : [{ target, receiverId: undefined, key: this.#fanoutDeliveryKey(target) }];
    });
    const results = await Promise.allSettled(
      deliveries.map(
        async ({ target, receiverId, key }) =>
          [
            key,
            await this.send<T>(target, method, data, {
              ...options,
              receiverId
            } as IInternalSendOptions)
          ] as const
      )
    );
    const lifecycleFailure = results.find(
      (result): result is PromiseRejectedResult =>
        result.status === 'rejected' && result.reason instanceof WebRpcLifecycleError
    );
    if (lifecycleFailure) throw lifecycleFailure.reason;
    const fulfilled = createSafeRecord<T>() as Partial<Record<string, T>>;
    const rejected = createSafeRecord<unknown>() as Partial<Record<string, unknown>>;
    results.forEach((result, index) => {
      const key = deliveries[index].key;
      if (result.status === 'fulfilled') fulfilled[key] = result.value[1];
      else rejected[key] = result.reason;
    });
    return { fulfilled, rejected };
  }
  dispatch(targetId: TTargetId, method: string, data: unknown): void {
    this.#assertActive();
    this.#validateIdentifier(targetId, 'targetId');
    assertMethod(method);
    this.#validateIdentifier(method, 'method');
    this.#validateData(method, 'params', data);
    this.#dispatchInternal(targetId, method, data);
  }
  /** Runs a dispatch after its synchronous contract preflight has completed. */
  #dispatchInternal(targetId: TTargetId, method: string, data: unknown): void {
    const operationGeneration = this.#receiveGeneration;
    const dispatchTimeout = this.#timeout.resolveTimeout();
    this.#assertValidTimeout(dispatchTimeout);
    const operationScope = new OperationScope(
      operationGeneration,
      dispatchTimeout,
      this.#closing.signal
    );
    const remainingDispatch = (): number | false | undefined =>
      operationScope.remaining(dispatchTimeout);
    void Promise.resolve()
      .then(() => {
        this.#assertOperationActive(operationGeneration);
        return raceWithAsyncControl({
          operation: () => this.#discoverTargetIfNeeded(targetId, remainingDispatch()),
          timeoutMs: remainingDispatch(),
          signals: [operationScope.signal],
          createTimeoutError: () => new WebRpcTimeoutError(),
          createAbortError: () => new WebRpcAbortError()
        });
      })
      .then(() => {
        this.#assertOperationActive(operationGeneration);
        return this.#receiverForOperation(targetId, 'dispatch', remainingDispatch());
      })
      .then((selectedReceiver) => {
        this.#assertOperationActive(operationGeneration);
        const taskId = this.#makeId('message', targetId);
        const operation = this.#resourceManager.begin('dispatch', taskId);
        // dispatch-only ids never correlate to a future response — unlike a regular request's
        // taskId, which must stay reserved for the replay TTL so a late/duplicate response can't
        // be matched against a reused id, there is nothing to protect here once the frame has
        // actually been handed to the transport. Releasing right after send settles (success or
        // failure) frees the outbound id budget instead of holding it for the full TTL — see
        // WR-R3-3 in docs/review/2026-08-13-plugin-host-logger-web-rpc-hardening.sdd.md.
        //
        // #send() can throw synchronously (protocol encode failure, oversized payload, an
        // invalid chunk split) — see WR-R5-1. Evaluating it inside this .then() callback,
        // rather than as an eager argument to Promise.resolve(), converts that synchronous
        // throw into a normal promise rejection so the .finally() below always runs and the
        // operation scope / outbound id are never left leaked.
        return Promise.resolve()
          .then(() =>
            this.#send({
              kind: 'request',
              version: this.#version,
              taskId,
              senderId: this.#id,
              targetId,
              method,
              data,
              dispatchOnly: true,
              sentAt: Date.now(),
              receiverId: selectedReceiver.receiverId
            })
          )
          .finally(() => {
            operation.release();
            this.#resourceManager.releaseId(taskId);
          });
      })
      .catch((error: unknown) =>
        this.#emit({ name: 'dispatch.failure', code: WebRpcErrorCode.transport, error })
      )
      .finally(() => operationScope.abort());
  }
  dispatchAll(method: string, data: unknown): void {
    this.#assertActive();
    assertMethod(method);
    this.#validateIdentifier(method, 'method');
    this.#validateData(method, 'params', data);
    for (const target of this.#fanoutTargets()) this.#dispatchInternal(target, method, data);
  }
  ping(
    targetId: TTargetId,
    receiverOverride?: string,
    options?: { readonly timeoutMs?: number; readonly signal?: IWebRpcAbortSignal }
  ): Promise<boolean> {
    return this.#pingInternal(targetId, receiverOverride, options, true);
  }
  /** Executes ping with an explicit choice of whether discovery may mutate DNS. */
  #pingInternal(
    targetId: TTargetId,
    receiverOverride: string | undefined,
    options: { readonly timeoutMs?: number; readonly signal?: IWebRpcAbortSignal } | undefined,
    discover: boolean,
    verifiedCandidate = false
  ): Promise<boolean> {
    this.#assertActive();
    const operationGeneration = this.#receiveGeneration;
    this.#validateIdentifier(targetId, 'targetId');
    if (receiverOverride !== undefined) {
      this.#validateIdentifier(receiverOverride, 'receiverId');
      if (!verifiedCandidate) this.#assertReceiverAvailable(targetId, receiverOverride);
    }
    if (this.#features.ping !== true)
      throw new WebRpcError(WebRpcErrorCode.middlewareMissing, 'ping middleware is not installed');
    const timeoutMs = options?.timeoutMs ?? this.#timeout.resolveTimeout();
    this.#assertValidTimeout(timeoutMs);
    if (options?.signal?.aborted) return Promise.resolve(false);
    if (!this.#discovery.canAdmitWaiter(String(targetId)))
      return Promise.reject(
        new WebRpcError(WebRpcErrorCode.overloaded, 'discovery waiter limit exceeded')
      );
    const taskId = this.#makeId('variation', targetId);
    const operation = this.#resourceManager.begin('ping', taskId, true);
    const deadline =
      timeoutMs === false || timeoutMs === undefined ? undefined : Date.now() + timeoutMs;
    const remaining = (): number | false | undefined =>
      deadline === undefined ? timeoutMs : Math.max(0, deadline - Date.now());
    const operationAbort = new AbortController();
    const operationScope = new OperationScope(
      this.#receiveGeneration,
      timeoutMs,
      this.#closing.signal
    );
    const abortOperation = (): void => {
      operationAbort.abort();
      this.#resourceManager.getPingPending(taskId)?.settle(false);
    };
    options?.signal?.addEventListener('abort', abortOperation, { once: true });
    this.#closing.signal.addEventListener('abort', abortOperation, { once: true });
    operationScope.signal.addEventListener('abort', abortOperation, { once: true });
    return new Promise((resolve) => {
      let releaseControl = (): void => undefined;
      const control = new Promise<void>((resolveControl) => {
        releaseControl = resolveControl;
      });
      const pending = {
        targetId,
        receiverId: receiverOverride,
        sentAt: Date.now(),
        resolve,
        release: releaseControl,
        settle: (_value: boolean) => false,
        verifiedPeerKey: undefined as string | undefined
      };
      const settlement = createSettlement<boolean>({
        cleanup: () => {
          this.#resourceManager.deletePingPending(taskId);
          operation.release();
          operationAbort.abort();
          options?.signal?.removeEventListener('abort', abortOperation);
          this.#closing.signal.removeEventListener('abort', abortOperation);
          operationScope.signal.removeEventListener('abort', abortOperation);
          operationScope.abort();
          pending.release?.();
        },
        resolve,
        reject: () => resolve(false)
      });
      pending.settle = settlement.resolve;
      this.#resourceManager.setPingPending(taskId, pending);
      if (operationAbort.signal.aborted) pending.settle(false);
      if (timeoutMs !== false) {
        void raceWithAsyncControl({
          operation: () => control,
          timeoutMs: remaining() ?? 1000,
          signals: options?.signal === undefined ? undefined : [options.signal],
          createTimeoutError: () => new WebRpcTimeoutError(),
          createAbortError: () => new WebRpcAbortError(),
          onTimeout: () => {
            const current = this.#resourceManager.getPingPending(taskId);
            if (!current) return;
            operationAbort.abort();
            current.settle(false);
          },
          onDiagnostic: (error) =>
            this.#emit({ name: 'failure', code: WebRpcErrorCode.internal, error })
        }).catch(() => {
          this.#resourceManager.getPingPending(taskId)?.settle(false);
        });
      }
      void (
        receiverOverride === undefined && discover
          ? this.#discoverTargetIfNeeded(targetId, remaining(), operationAbort.signal)
          : Promise.resolve()
      )
        .then(() =>
          receiverOverride === undefined
            ? this.#receiverForOperation(targetId, 'ping', remaining(), operationAbort.signal)
            : {
                receiverId: receiverOverride,
                verifiedPeerKey: this.#discovery.getRemoteBinding(
                  tupleKey(targetId, receiverOverride)
                )
              }
        )
        .then((selectedReceiver) => {
          this.#assertOperationActive(operationGeneration);
          if (operationAbort.signal.aborted || !this.#resourceManager.getPingPending(taskId))
            return;
          pending.receiverId = selectedReceiver.receiverId;
          pending.verifiedPeerKey = selectedReceiver.verifiedPeerKey;
          return this.#sendVariation(
            {
              kind: 'variation',
              variation: 'ping',
              taskId,
              senderId: this.#id,
              targetId,
              sentAt: Date.now(),
              receiverId: selectedReceiver.receiverId
            },
            true
          );
        })
        .catch(() => {
          const pending = this.#resourceManager.getPingPending(taskId);
          if (!pending) return;
          pending.settle(false);
        });
    });
  }
  async pingAll(): Promise<IWebRpcFanoutResult<boolean>> {
    this.#assertActive();
    const targets = this.#fanoutTargets();
    const deliveries = targets.flatMap<IWebRpcDelivery<TTargetId>>((target) => {
      const pinned = this.#discovery.getPin(target);
      const receivers = this.#getServerList(target).filter(
        (entry) =>
          entry.status === 'active' && (pinned === undefined || entry.receiverId === pinned)
      );
      if (pinned !== undefined && receivers.length === 0)
        return [{ target, receiverId: pinned, key: this.#fanoutDeliveryKey(target, pinned) }];
      return receivers.length
        ? receivers.map((entry) => ({
            target,
            receiverId: entry.receiverId,
            key: this.#fanoutDeliveryKey(target, entry.receiverId)
          }))
        : [{ target, receiverId: undefined, key: this.#fanoutDeliveryKey(target) }];
    });
    const results = await Promise.allSettled(
      deliveries.map(
        async ({ target, receiverId, key }) => [key, await this.ping(target, receiverId)] as const
      )
    );
    const lifecycleFailure = results.find(
      (result): result is PromiseRejectedResult =>
        result.status === 'rejected' && result.reason instanceof WebRpcLifecycleError
    );
    if (lifecycleFailure) throw lifecycleFailure.reason;
    const fulfilled = createSafeRecord<boolean>() as Partial<Record<string, boolean>>;
    const rejected = createSafeRecord<unknown>() as Partial<Record<string, unknown>>;
    results.forEach((result, index) => {
      const key = deliveries[index].key;
      if (result.status === 'fulfilled') fulfilled[key] = result.value[1];
      else rejected[key] = result.reason;
    });
    return { fulfilled, rejected };
  }
  async dispose(): Promise<void> {
    if (this.#disposePromise) return this.#disposePromise;
    this.#disposed = true;
    this.#disposePromise = this.#disposeInternal();
    return this.#disposePromise;
  }
  async #disposeInternal(): Promise<void> {
    this.#receiveGeneration += 1;
    this.#closing.abort();
    const releaseErrors: Array<{ readonly resource: string; readonly error: unknown }> = [];
    this.#manualQueryListeners.clear();
    for (const entry of this.#discovery.localSnapshot<IWebRpcServerMetadata<TTargetId>>()) {
      if (entry.status === 'active') {
        this.#emit({
          name: 'connect.server-unregistered',
          code: 'SERVER_UNREGISTERED',
          targetId: entry.targetId,
          receiverId: entry.receiverId
        });
      }
    }
    this.#peers.clear();
    this.#multipleReceiverSnapshots.clear();
    const resourceErrors = await this.#resourceManager.dispose();
    for (const entry of resourceErrors) {
      releaseErrors.push(entry);
      this.#emit({
        name: entry.resource === 'middleware' ? 'middleware.dispose.failure' : 'transport.failure',
        code: WebRpcErrorCode.internal,
        error: entry.error
      });
    }
    this.#hooks.clear();
    this.#runtime.capabilities.clear();
    if (releaseErrors.length) {
      throw new WebRpcLifecycleError(
        'Endpoint disposal completed with cleanup errors',
        undefined,
        releaseErrors
      );
    }
  }
  #assertActive(): void {
    if (this.#disposed) throw new WebRpcLifecycleError('Endpoint disposed');
    this.#resourceManager.purgeReplay();
  }
  #assertOperationActive(generation: number | undefined): void {
    if (generation !== undefined && generation !== this.#receiveGeneration)
      throw new WebRpcLifecycleError('Endpoint disposed');
    this.#assertActive();
  }
  #getServerList(targetId?: TTargetId): readonly IWebRpcServerMetadata<TTargetId>[] {
    this.#assertActive();
    const now = Date.now();
    return Object.freeze(
      this.#discovery
        .remoteSnapshot<IWebRpcServerMetadata<TTargetId>>()
        .map(([, entry]) => entry)
        .filter((entry) => targetId === undefined || entry.targetId === targetId)
        .sort((left, right) =>
          tupleKey(left.targetId, left.receiverId).localeCompare(
            tupleKey(right.targetId, right.receiverId)
          )
        )
        .map((entry) =>
          Object.freeze({
            ...entry,
            status:
              entry.status === 'active' &&
              this.#discovery.hasRemote(tupleKey(entry.targetId, entry.receiverId)) &&
              now - entry.lastSeenAt >= this.#receiverStaleAfterMs
                ? 'stale'
                : entry.status
          })
        )
    );
  }
  #pinReceiver(targetId: TTargetId, receiverId: string): void {
    this.#assertActive();
    this.#validateIdentifier(targetId, 'targetId');
    this.#validateIdentifier(receiverId, 'receiverId');
    if (
      this.#transportPlatform === 'BroadcastChannel' &&
      receiverId === String(targetId) &&
      this.#connect?.uniqueTargetId === undefined
    )
      throw new WebRpcError(
        WebRpcErrorCode.targetNotIdentifiable,
        `BroadcastChannel target is not individually identifiable: ${targetId}`
      );
    const entry = this.#discovery
      .remoteSnapshot<IWebRpcServerMetadata<TTargetId>>()
      .map(([, candidate]) => candidate)
      .find((candidate) => candidate.targetId === targetId && candidate.receiverId === receiverId);
    if (!entry || entry.receiverId !== receiverId || entry.status !== 'active')
      throw new WebRpcError(WebRpcErrorCode.targetUnknown, `Unknown receiver: ${receiverId}`);
    this.#discovery.pin(targetId, receiverId);
    this.#discovery.clearPinLost(targetId);
    const key = tupleKey(targetId, receiverId);
    this.#discovery.setRemote(key, { ...entry, pinned: true });
    this.#emit({
      name: 'connect.receiver-pinned',
      code: 'RECEIVER_PINNED',
      targetId,
      receiverId
    });
  }
  #unpinReceiver(targetId: TTargetId): void {
    this.#assertActive();
    this.#validateIdentifier(targetId, 'targetId');
    this.#discovery.unpin(targetId);
    this.#discovery.clearPinLost(targetId);
    for (const [key, remote] of this.#discovery.remoteSnapshot<
      IWebRpcServerMetadata<TTargetId>
    >()) {
      if (remote.targetId === targetId)
        this.#discovery.setRemote(key, { ...remote, pinned: false });
    }
    this.#emit({ name: 'connect.receiver-unpinned', code: 'RECEIVER_UNPINNED', targetId });
  }
  #ensureLocalReceiver(targetId: TTargetId): string {
    this.#assertActive();
    this.#validateIdentifier(targetId, 'targetId');
    const existing = this.#discovery.getLocal<IWebRpcServerMetadata<TTargetId>>(targetId);
    if (existing?.status === 'active') return existing.receiverId;
    const now = Math.max(Date.now(), (existing?.registeredAt ?? 0) + 1);
    // BroadcastChannel cannot prove tab-instance uniqueness. Treat it as one
    // logical broadcast group instead of manufacturing a realm-local identity.
    const receiverId =
      this.#transportPlatform === 'BroadcastChannel'
        ? this.#connect?.uniqueTargetId
          ? `${targetId}:${this.#connect.uniqueTargetId}`
          : String(targetId)
        : `${targetId}-${this.#id}-${++this.#nextReceiverId}-${++nextReceiverNonce}`;
    const entry: IWebRpcServerMetadata<TTargetId> = {
      targetId,
      receiverId,
      platform: this.#transportPlatform,
      origin: this.#transportOrigin,
      registeredAt: now,
      lastSeenAt: now,
      pinned: false,
      status: 'active'
    };
    this.#discovery.setLocal(targetId, entry);
    this.#emit({
      name: 'connect.receiver-registered',
      code: 'RECEIVER_REGISTERED',
      targetId,
      receiverId
    });
    return receiverId;
  }
  /** Counts remote receiver entries for one target before accepting another discovery record. */
  #receiverCount(targetId: string): number {
    let count = 0;
    for (const [, entry] of this.#discovery.remoteSnapshot<IWebRpcServerMetadata<TTargetId>>())
      if (entry.targetId === targetId && entry.status === 'active') count += 1;
    return count;
  }
  #isPlatform(value: unknown): value is IWebRpcPlatform {
    return (
      value === 'Worker' ||
      value === 'Iframe' ||
      value === 'BroadcastChannel' ||
      value === 'MessagePort' ||
      value === 'Memory' ||
      value === 'WebTransport' ||
      value === 'RTCDataChannel'
    );
  }
  #failTransport(error: unknown): void {
    if (this.#disposed) return;
    const failure = new WebRpcTransportError('Transport failure', error);
    for (const pending of this.#resourceManager.pending.values() as Iterable<IPendingTask>) {
      pending.settleReject(failure);
    }
    for (const taskId of this.#resourceManager.pingPending.keys())
      this.#resourceManager.getPingPending(taskId)?.settle(false);
    if (safeRead<unknown>(this.#transport, 'closed') === true) {
      // A terminal transport event closes endpoint admission as well as pending work.
      this.#disposed = true;
      this.#receiveGeneration += 1;
      this.#closing.abort();
      this.#peers.clear();
      void this.dispose().catch((disposeError: unknown) => {
        try {
          this.#emit({
            name: 'dispose.failure',
            code: WebRpcErrorCode.internal,
            error: disposeError
          });
        } catch {}
      });
    }
    this.#emit({ name: 'transport.failure', code: WebRpcErrorCode.transport, error });
  }

  #isCompletedTask(key: string): boolean {
    return this.#discoveryReplay.has(key);
  }

  /** Settles one verified inbound manual query through its opaque handle. */
  async #settleManualInboundQuery(
    key: string,
    accepted: boolean,
    data?: unknown,
    reason?: string
  ): Promise<boolean> {
    this.#assertActive();
    const query = this.#discovery.getInboundQuery<IManualInboundQuery>(key);
    if (!query) return false;
    if (reason !== undefined && typeof reason !== 'string')
      throw new WebRpcError(
        WebRpcErrorCode.invalidConfig,
        'query rejection reason must be a string'
      );
    this.#discovery.takeInboundQuery(key);
    this.#rememberCompletedTask(
      tupleKey('manual-query', query.verifiedPeerKey, query.senderId, query.queryId),
      query.verifiedPeerKey
    );
    const receiverId = accepted ? this.#ensureLocalReceiver(this.#id as TTargetId) : undefined;
    const acceptedData =
      data && typeof data === 'object' && !Array.isArray(data)
        ? Object.fromEntries(
            Object.entries(data as Record<string, unknown>).filter(
              ([name]) => name !== '__unique_id__'
            )
          )
        : data;
    const controlData =
      this.#connect?.uniqueTargetId === undefined
        ? acceptedData
        : {
            ...(acceptedData && typeof acceptedData === 'object'
              ? acceptedData
              : { value: acceptedData }),
            __unique_id__: this.#connect.uniqueTargetId
          };
    await this.#send({
      kind: 'discovery-response',
      taskId: query.queryId,
      senderId: this.#id,
      targetId: query.senderId,
      resolvedTargetId: this.#id,
      sentAt: Date.now(),
      manual: true,
      accepted,
      ...(accepted ? { data: controlData, platform: this.#transportPlatform, receiverId } : {}),
      ...(reason === undefined ? {} : { message: reason })
    });
    return true;
  }

  /** Admits a fresh automatic discovery query within bounded global and peer budgets. */
  #admitAutomaticDiscovery(peerKey: string, taskKey: string): boolean {
    this.#resourceManager.purgeReplay();
    if (this.#discovery.admissionSize() >= this.#maxAutomaticDiscoveryAdmissions) return false;
    let peerAdmissions = 0;
    for (const [, entry] of this.#discovery.admissionSnapshot())
      if (entry.peerKey === peerKey) peerAdmissions += 1;
    if (peerAdmissions >= this.#maxAutomaticDiscoveryAdmissionsPerPeer) return false;
    this.#discovery.setAdmission(taskKey, { peerKey, at: Date.now() });
    return true;
  }

  #rememberCompletedTask(key: string, peerKey: string): void {
    this.#discoveryReplay.admit(key, peerKey);
  }
  #emit(event: {
    readonly name: string;
    readonly code?: string;
    readonly error?: unknown;
    readonly contract?: unknown;
    readonly variation?: unknown;
    readonly targetId?: string;
    readonly receiverId?: string;
    readonly requesterId?: string;
    readonly receiverIds?: readonly string[];
    readonly ambiguous?: boolean;
    readonly responseCount?: number;
  }): void {
    const full = Object.freeze({
      ...event,
      ...(event.receiverIds === undefined
        ? {}
        : { receiverIds: Object.freeze([...event.receiverIds]) }),
      at: Date.now(),
      localId: this.#id
    });
    this.#hooks.emit(full, this.#hooksConfig.onHookError);
  }
  #receiverForTarget(targetId: TTargetId): {
    readonly receiverId?: string;
    readonly verifiedPeerKey?: string;
  } {
    const receiverId = this.#discovery.getPin(targetId);
    if (receiverId !== undefined) this.#assertReceiverAvailable(targetId, receiverId);
    return receiverId === undefined
      ? {}
      : {
          receiverId,
          verifiedPeerKey: this.#discovery.getRemoteBinding(tupleKey(targetId, receiverId))
        };
  }
  /** Chooses one receiver for a single-target operation without mutating discovery state. */
  async #receiverForOperation(
    targetId: TTargetId,
    operation: 'send' | 'dispatch' | 'ping',
    timeoutMs?: number | false,
    signal?: IWebRpcAbortSignal
  ): Promise<{ readonly receiverId?: string; readonly verifiedPeerKey?: string }> {
    const pinned = this.#discovery.getPin(targetId);
    if (pinned !== undefined) return this.#receiverForTarget(targetId);
    const selector = this.#connect?.receiverSelector;
    if (!selector) return this.#receiverForTarget(targetId);
    const serverList = this.#getServerList(targetId);
    const selected = await raceWithAsyncControl({
      operation: () =>
        Promise.resolve(selector(serverList, { endpointId: this.#id, targetId, operation })),
      timeoutMs,
      signals: [this.#closing.signal, ...(signal ? [signal] : [])],
      createTimeoutError: () => new WebRpcTimeoutError(),
      createAbortError: () => new WebRpcAbortError(),
      onDiagnostic: (error) =>
        this.#emit({ name: 'failure', code: WebRpcErrorCode.internal, error })
    });
    if (selected === undefined) return this.#receiverForTarget(targetId);
    if (typeof selected !== 'string')
      throw new WebRpcError(
        WebRpcErrorCode.targetUnknown,
        'receiverSelector returned an invalid receiver'
      );
    const entry = serverList.find(
      (candidate) => candidate.receiverId === selected && candidate.status === 'active'
    );
    if (!entry)
      throw new WebRpcError(
        WebRpcErrorCode.targetUnknown,
        `receiverSelector returned an unavailable receiver: ${selected}`
      );
    return {
      receiverId: selected,
      verifiedPeerKey: this.#discovery.getRemoteBinding(tupleKey(targetId, selected))
    };
  }
  /** Joins a discovery session while keeping timeout and abort ownership local to this caller. */
  #joinDiscoveryWaiter(
    targetId: TTargetId,
    waiter: IDiscoveryWaiter,
    timeoutMs: number | false,
    signal?: IWebRpcAbortSignal
  ): Promise<void> {
    if (waiter.references >= this.#maxDiscoveryWaitersPerSession)
      return Promise.reject(
        new WebRpcError(WebRpcErrorCode.overloaded, 'discovery session waiter limit exceeded')
      );
    waiter.references += 1;
    return raceWithAsyncControl({
      operation: () => waiter.promise,
      timeoutMs,
      signals: signal ? [signal] : [],
      createTimeoutError: () => new WebRpcTimeoutError(),
      createAbortError: () => new WebRpcAbortError()
    }).finally(() => {
      waiter.references -= 1;
      if (waiter.references > 0 || waiter.settled) return;
      const key = String(targetId);
      if (this.#discovery.getWaiter<IDiscoveryWaiter>(key) !== waiter) return;
      this.#deleteDiscoveryWaiter(key);
      if (waiter.taskId) this.#discovery.deleteTask(waiter.taskId);
      if (waiter.taskId) this.#discovery.deleteResponseCount(waiter.taskId);
      waiter.timer?.clear();
      if (waiter.taskId) this.#deleteDiscoveryTimer(waiter.taskId);
    });
  }
  /** Resolves an unknown target once, then lets the normal routing path use its DNS snapshot. */
  #discoverTargetIfNeeded(
    targetId: TTargetId,
    timeoutMs: number | false = 1000,
    signal?: IWebRpcAbortSignal
  ): Promise<void> {
    // An exclusive transport already represents one known physical peer. Requiring
    // that peer to answer a discovery query would make dedicated Worker/MessagePort
    // channels unusable when their remote side only implements the business protocol.
    if (
      this.#transportTopology === 'exclusive' &&
      this.#connect !== undefined &&
      this.#peers.has(targetId)
    )
      return Promise.resolve();
    if (this.#getServerList(targetId).some((entry) => entry.status === 'active'))
      return Promise.resolve();
    const existing = this.#discovery.getWaiter<IDiscoveryWaiter>(String(targetId));
    if (existing) {
      if (timeoutMs === false) {
        // Caller may wait without a deadline; session ownership remains bounded.
      } else {
        const deadline = Date.now() + timeoutMs;
        if (existing.sessionDeadlineAt === undefined || deadline > existing.sessionDeadlineAt) {
          existing.timer?.clear();
          existing.sessionDeadlineAt = deadline;
          const remaining = Math.max(0, deadline - Date.now());
          existing.timer = createRuntimeTimer(() => {
            existing.timer = undefined;
            if (existing.taskId) this.#deleteDiscoveryTimer(existing.taskId);
            this.#deleteDiscoveryWaiter(String(targetId));
            if (existing.taskId) {
              this.#discovery.deleteTask(existing.taskId);
              this.#discovery.deleteResponseCount(existing.taskId);
            }
            existing.reject(
              new WebRpcError(WebRpcErrorCode.targetUnknown, `Unknown target: ${targetId}`)
            );
          }, remaining);
          if (existing.taskId && existing.timer)
            this.#setDiscoveryTimer(existing.taskId, existing.timer);
        }
      }
      return this.#joinDiscoveryWaiter(targetId, existing, timeoutMs, signal);
    }
    const taskId = this.#makeId('variation', targetId);
    let resolveDiscovery: () => void = () => undefined;
    let rejectDiscovery: (error: unknown) => void = () => undefined;
    const promise = new Promise<void>((resolve, reject) => {
      resolveDiscovery = resolve;
      rejectDiscovery = reject;
    });
    const waiter: IDiscoveryWaiter = {
      promise,
      resolve: resolveDiscovery,
      reject: rejectDiscovery,
      references: 0,
      settled: false
    };
    void promise.then(
      () => {
        waiter.settled = true;
      },
      () => {
        waiter.settled = true;
      }
    );
    if (!this.#discovery.setWaiter(String(targetId), waiter)) {
      this.#resourceManager.releaseId(taskId);
      return Promise.reject(
        new WebRpcError(WebRpcErrorCode.overloaded, 'discovery waiter limit exceeded')
      );
    }
    const operation = this.#resourceManager.begin('discovery', taskId, true);
    this.#resourceManager.trackWaiter(String(targetId), () => {
      this.#discovery.deleteWaiter(String(targetId));
      if (waiter.taskId) this.#deleteDiscoveryTimer(waiter.taskId);
    });
    this.#discovery.setTask(taskId, String(targetId));
    waiter.taskId = taskId;
    this.#discovery.setResponseCount(taskId, 0);
    const sessionTimeoutMs = timeoutMs === false ? this.#discoverySessionTtlMs : timeoutMs;
    const timer = createRuntimeTimer(() => {
      this.#deleteDiscoveryTimer(taskId);
      waiter.timer = undefined;
      this.#discovery.deleteResponseCount(taskId);
      if (this.#discovery.deleteTask(taskId)) {
        this.#deleteDiscoveryWaiter(String(targetId));
        rejectDiscovery(
          new WebRpcError(WebRpcErrorCode.targetUnknown, `Unknown target: ${targetId}`)
        );
      }
    }, sessionTimeoutMs);
    waiter.sessionDeadlineAt = Date.now() + sessionTimeoutMs;
    waiter.timer = timer;
    if (timer) this.#setDiscoveryTimer(taskId, timer);
    void Promise.resolve()
      .then(() =>
        this.#send({
          kind: 'discovery-query',
          taskId,
          senderId: this.#id,
          targetId,
          sentAt: Date.now(),
          ...(this.#connect?.uniqueTargetId === undefined
            ? {}
            : { data: { __unique_id__: this.#connect.uniqueTargetId } })
        } satisfies IWebRpcDiscoveryQuery)
      )
      .catch((error: unknown) => {
        timer?.clear();
        this.#deleteDiscoveryTimer(taskId);
        this.#discovery.deleteResponseCount(taskId);
        if (this.#discovery.deleteTask(taskId)) {
          this.#deleteDiscoveryWaiter(String(targetId));
          rejectDiscovery(error);
        }
      });
    promise.then(
      () => {
        operation.release();
        // Keep collection timer alive briefly so broadcast-group responses can all
        // enrich the DNS snapshot after the first response releases the request.
      },
      () => {
        operation.release();
        timer?.clear();
        this.#deleteDiscoveryTimer(taskId);
        this.#discovery.deleteResponseCount(taskId);
      }
    );
    return this.#joinDiscoveryWaiter(targetId, waiter, timeoutMs, signal);
  }
  #assertReceiverAvailable(targetId: TTargetId, receiverId: string): void {
    if (this.#discovery.isPinLost(targetId))
      throw new WebRpcError(
        WebRpcErrorCode.targetUnknown,
        `Pinned receiver requires re-pin or unpin: ${receiverId}`
      );
    const entry = this.#getServerList(targetId).find(
      (candidate) => candidate.receiverId === receiverId
    );
    if (entry?.status === 'stale') {
      this.#discovery.markPinLost(targetId);
      this.#emit({
        name: 'connect.pinned-receiver-lost',
        code: 'PINNED_RECEIVER_LOST',
        targetId,
        receiverId
      });
    }
    if (entry?.status !== 'active')
      throw new WebRpcError(
        WebRpcErrorCode.targetUnknown,
        `Pinned receiver is unavailable: ${receiverId}`
      );
  }
  /** Executes manual discovery against the same authenticated query path without exposing internals. */
  async #manualQuery(
    targetId: TTargetId,
    options?: { readonly timeoutMs?: number; readonly signal?: IWebRpcAbortSignal }
  ): Promise<readonly IWebRpcDiscoveryCandidate<TTargetId>[]> {
    this.#assertActive();
    this.#validateIdentifier(targetId, 'targetId');
    const timeoutMs = options?.timeoutMs ?? 1000;
    if (!Number.isFinite(timeoutMs) || timeoutMs < 0)
      throw new WebRpcError(
        WebRpcErrorCode.invalidConfig,
        'discovery timeout must be finite and non-negative'
      );
    if (options?.signal?.aborted)
      throw new WebRpcError(WebRpcErrorCode.cancelled, 'Discovery aborted');
    const taskId = this.#makeId('variation', targetId);
    const operation = this.#resourceManager.begin('discovery', taskId, true);
    return new Promise((resolve, reject) => {
      const release = (): void => operation.release();
      const settleResolve = (value: readonly IWebRpcDiscoveryCandidate<TTargetId>[]): void => {
        release();
        resolve(value);
      };
      const settleReject = (error: unknown): void => {
        release();
        reject(error);
      };
      const timer = createRuntimeTimer(() => {
        this.#discovery.resolveManualWaiter(taskId);
      }, timeoutMs);
      const waiter: IManualDiscoveryWaiter<TTargetId> = {
        targetId,
        resolve: settleResolve,
        reject: settleReject,
        candidates: [],
        candidateKeys: new Set(),
        candidatePeerCounts: new Map(),
        timer,
        signal: options?.signal
      };
      this.#discovery.setManualWaiter(taskId, waiter);
      if (options?.signal) {
        const onAbort = (): void => {
          this.#discovery.rejectManualWaiter(
            taskId,
            new WebRpcError(WebRpcErrorCode.cancelled, 'Discovery aborted')
          );
        };
        (waiter as { onAbort?: () => void }).onAbort = onAbort;
        try {
          options.signal.addEventListener('abort', onAbort, { once: true });
        } catch (error) {
          this.#discovery.deleteManualWaiter(taskId);
          timer?.clear();
          settleReject(error);
          return;
        }
      }
      void Promise.resolve()
        .then(() => {
          if (this.#discovery.getManualWaiter(taskId) !== waiter) return;
          return this.#send({
            kind: 'discovery-query',
            taskId,
            senderId: this.#id,
            targetId,
            sentAt: Date.now(),
            ...(this.#connect?.uniqueTargetId === undefined
              ? {}
              : { data: { __unique_id__: this.#connect.uniqueTargetId } }),
            manual: true
          });
        })
        .catch((error) => {
          this.#discovery.rejectManualWaiter(taskId, error);
        });
    });
  }
  /** Adds an explicitly accepted manual candidate to remote discovery state. */
  #manualRegister(candidate: IWebRpcDiscoveryCandidate<TTargetId>): void {
    this.#assertActive();
    if (!candidate || typeof candidate !== 'object')
      throw new WebRpcError(WebRpcErrorCode.invalidConfig, 'discovery candidate is invalid');
    const candidateRecord = this.#discovery.getCandidate(candidate as object) as
      | { expiresAt: number; registered: boolean; revoked: boolean }
      | undefined;
    if (
      !candidateRecord ||
      candidateRecord.expiresAt <= Date.now() ||
      candidateRecord.revoked ||
      candidateRecord.registered
    )
      throw new WebRpcError(
        WebRpcErrorCode.targetUnknown,
        'discovery candidate was not produced by a verified manual query'
      );
    this.#validateIdentifier(candidate.targetId, 'targetId');
    if (typeof candidate.receiverId !== 'string')
      throw new WebRpcError(
        WebRpcErrorCode.invalidConfig,
        'discovery candidate receiverId is invalid'
      );
    try {
      this.#validateIdentifier(candidate.receiverId, 'receiverId');
    } catch {
      throw new WebRpcError(
        WebRpcErrorCode.invalidConfig,
        'discovery candidate receiverId is invalid'
      );
    }
    const uniqueTargetId = this.#discovery.getCandidateUniqueId(candidate as object);
    const key = tupleKey(candidate.targetId, candidate.receiverId);
    if (this.#discovery.isCandidateRevoked(key))
      throw new WebRpcError(WebRpcErrorCode.targetUnknown, 'discovery candidate was revoked');
    if (
      !this.#discovery.hasRemote(key) &&
      this.#receiverCount(candidate.targetId) >= this.#maxReceiversPerTarget
    ) {
      this.#emit({
        name: 'connect.receiver-announcement.failure',
        code: 'RECEIVER_LIMIT',
        targetId: candidate.targetId,
        receiverId: candidate.receiverId
      });
      throw new WebRpcError(WebRpcErrorCode.targetUnknown, 'receiver limit exceeded');
    }
    const now = Date.now();
    const previous = this.#discovery.getRemote<IWebRpcServerMetadata<TTargetId>>(key);
    const candidateProof = this.#discovery.getCandidate(candidate as object) as
      | { verifiedPeerKey?: string }
      | undefined;
    if (candidateProof?.verifiedPeerKey === undefined)
      throw new WebRpcError(
        WebRpcErrorCode.targetUnknown,
        'verified discovery binding is no longer available'
      );
    if (
      !this.#discovery.setRemoteWithBinding(
        key,
        {
          targetId: candidate.targetId,
          receiverId: candidate.receiverId,
          platform: candidate.platform,
          origin: candidate.origin,
          ...(uniqueTargetId === undefined ? {} : { uniqueTargetId }),
          registeredAt: now,
          lastSeenAt: now,
          pinned: previous?.pinned ?? false,
          status: 'active'
        },
        candidateProof.verifiedPeerKey
      )
    )
      throw new WebRpcError(
        WebRpcErrorCode.targetUnknown,
        'remote discovery target limit exceeded'
      );
    candidateRecord.registered = true;
    if (previous?.status !== 'active')
      this.#emit({
        name: 'connect.receiver-registered',
        code: 'RECEIVER_REGISTERED',
        targetId: candidate.targetId,
        receiverId: candidate.receiverId
      });
    this.#diagnoseMultipleReceivers(candidate.targetId);
  }
  /** Removes manually registered remote receiver state. */
  async #manualUnregister(targetId: TTargetId, receiverId?: string): Promise<void> {
    this.#assertActive();
    this.#validateIdentifier(targetId, 'targetId');
    if (receiverId !== undefined) this.#validateIdentifier(receiverId, 'receiverId');
    const keysToRevoke: string[] = [];
    for (const [key, entry] of this.#discovery.remoteSnapshot<IWebRpcServerMetadata<TTargetId>>()) {
      if (
        entry.targetId === targetId &&
        (receiverId === undefined || entry.receiverId === receiverId) &&
        !keysToRevoke.includes(key)
      )
        keysToRevoke.push(key);
    }
    for (const key of keysToRevoke)
      if (!this.#discovery.canRevokeCandidate(key, this.#maxManualRevokedCandidates))
        throw new WebRpcError(WebRpcErrorCode.overloaded, 'manual revocation capacity exceeded');
    const removed: IWebRpcServerMetadata<TTargetId>[] = [];
    for (const [key, entry] of this.#discovery.remoteSnapshot<IWebRpcServerMetadata<TTargetId>>()) {
      if (
        entry.targetId === targetId &&
        (receiverId === undefined || entry.receiverId === receiverId)
      ) {
        this.#discovery.deleteRemote(key);
        if (!this.#discovery.revokeCandidate(key, this.#maxManualRevokedCandidates))
          throw new WebRpcError(WebRpcErrorCode.overloaded, 'manual revocation capacity exceeded');
        removed.push(entry);
      }
    }
    for (const entry of removed) {
      if (entry.pinned) {
        this.#discovery.markPinLost(entry.targetId);
        this.#emit({
          name: 'connect.pinned-receiver-lost',
          code: 'PINNED_RECEIVER_LOST',
          targetId: entry.targetId,
          receiverId: entry.receiverId
        });
      }
      this.#emit({
        name: 'connect.server-unregistered',
        code: 'SERVER_UNREGISTERED',
        targetId: entry.targetId,
        receiverId: entry.receiverId
      });
    }
    this.#diagnoseMultipleReceivers(targetId);
  }
  /** Pings a manually selected receiver through normal authenticated routing. */
  async #manualPing(
    candidate: IWebRpcDiscoveryCandidate<TTargetId>,
    options?: { readonly timeoutMs?: number; readonly signal?: IWebRpcAbortSignal }
  ): Promise<boolean> {
    this.#assertActive();
    if (!candidate || typeof candidate !== 'object')
      throw new WebRpcError(
        WebRpcErrorCode.targetUnknown,
        'discovery candidate was not produced by a verified manual query'
      );
    if (typeof candidate.receiverId !== 'string')
      throw new WebRpcError(
        WebRpcErrorCode.invalidConfig,
        'discovery candidate receiverId is invalid'
      );
    const candidateRecord = this.#discovery.getCandidate(candidate as object) as
      | { expiresAt: number; registered: boolean; revoked: boolean }
      | undefined;
    if (
      !candidateRecord ||
      candidateRecord.expiresAt <= Date.now() ||
      candidateRecord.revoked ||
      this.#discovery.isCandidateRevoked(tupleKey(candidate.targetId, candidate.receiverId))
    )
      throw new WebRpcError(
        WebRpcErrorCode.targetUnknown,
        'discovery candidate was not produced by a verified manual query'
      );
    return this.#pingInternal(candidate.targetId, candidate.receiverId, options, false, true);
  }
  #touchRemoteReceiver(targetId: string, receiverId: string): void {
    const key = tupleKey(targetId, receiverId);
    const entry = this.#discovery.getRemote<IWebRpcServerMetadata<TTargetId>>(key);
    if (entry?.status === 'active')
      this.#discovery.setRemote(key, { ...entry, lastSeenAt: Date.now() });
  }
  #fanoutTargets(): TTargetId[] {
    const targets = new Set<TTargetId>(this.#peers.snapshot() as TTargetId[]);
    for (const entry of this.#getServerList())
      if (entry.status === 'active') targets.add(entry.targetId);
    return [...targets];
  }
  /** Creates tagged canonical keys for anonymous target and identified receiver domains. */
  #fanoutDeliveryKey(targetId: TTargetId, receiverId?: string): string {
    return receiverId === undefined
      ? JSON.stringify(['target', String(targetId)])
      : JSON.stringify(['receiver', String(targetId), receiverId]);
  }
  #ownsReceiver(targetId: string, receiverId: string): boolean {
    for (const entry of this.#discovery.localSnapshot<IWebRpcServerMetadata<TTargetId>>())
      if (entry.targetId === targetId && entry.receiverId === receiverId)
        return entry.status === 'active';
    return false;
  }
  #diagnoseMultipleReceivers(targetId: TTargetId): void {
    const receiverIds = this.#getServerList(targetId)
      .filter((entry) => entry.status === 'active')
      .map((entry) => entry.receiverId)
      .sort();
    if (receiverIds.length < 2) {
      this.#multipleReceiverSnapshots.delete(targetId);
      return;
    }
    const snapshot = tupleKey(...receiverIds);
    if (this.#multipleReceiverSnapshots.get(targetId) === snapshot) return;
    this.#multipleReceiverSnapshots.set(targetId, snapshot);
    this.#emit({
      name: 'connect.multiple-receivers',
      code: 'MULTIPLE_RECEIVERS',
      targetId,
      requesterId: this.#id,
      receiverIds: Object.freeze([...receiverIds])
    });
    try {
      const diagnostic = console.warn(
        `[web-rpc] requester ${this.#id} found multiple receivers for target ${targetId}: ` +
          `${receiverIds.join(', ')}. Pin one receiver or unregister stale receivers.`
      ) as unknown;
      if (
        diagnostic &&
        (typeof diagnostic === 'object' || typeof diagnostic === 'function') &&
        typeof (diagnostic as { then?: unknown }).then === 'function'
      )
        void Promise.resolve(diagnostic).catch(() => undefined);
    } catch {}
  }
  async #request<T>(request: IWebRpcRequest, options: ISendOptions): Promise<T> {
    this.#assertOperationActive((options as IInternalSendOptions).generation);
    return new Promise<T>((resolve, reject) => {
      if (options.signal?.aborted) {
        reject(new WebRpcAbortError());
        return;
      }
      if (options.signal && this.#features.abort !== true) {
        reject(
          new WebRpcError(WebRpcErrorCode.middlewareMissing, 'abort middleware is not installed')
        );
        return;
      }
      const operation = this.#resourceManager.begin('request', request.taskId, true);
      const pending: IPendingTask = {
        method: request.method,
        targetId: request.targetId,
        receiverId: request.receiverId,
        verifiedPeerKey: (options as IInternalSendOptions).verifiedPeerKey,
        resolve: (value) => resolve(value as T),
        reject,
        settleResolve: () => false,
        settleReject: () => false
      };
      let releaseTimeoutControl = (): void => undefined;
      const settlement = createSettlement<unknown>({
        cleanup: () => {
          this.#resourceManager.deletePending(request.taskId);
          operation.release();
          pending.abort?.();
          releaseTimeoutControl();
        },
        reportCleanupError: (error) =>
          this.#emit({ name: 'failure', code: WebRpcErrorCode.internal, error }),
        resolve: (value) => resolve(value as T),
        reject
      });
      pending.settleResolve = settlement.resolve;
      pending.settleReject = settlement.reject;
      const notifyRemoteAbort = (): void => {
        if (this.#features.abort !== true) return;
        const receiver = this.#receiverForTarget(request.targetId as TTargetId);
        void this.#sendVariation({
          kind: 'variation',
          variation: 'abort',
          taskId: request.taskId,
          senderId: this.#id,
          targetId: request.targetId,
          sentAt: Date.now(),
          ...(receiver.receiverId === undefined ? {} : { receiverId: receiver.receiverId })
        });
      };
      if (options.signal) {
        const abort = () => {
          if (pending.settleReject(new WebRpcAbortError())) notifyRemoteAbort();
        };
        try {
          options.signal.addEventListener('abort', abort, { once: true });
          pending.abort = () => options.signal?.removeEventListener('abort', abort);
          if (options.signal.aborted) abort();
        } catch (error) {
          try {
            options.signal.removeEventListener('abort', abort);
          } catch {}
          pending.settleReject(error);
          return;
        }
      }
      const timeoutMs = this.#timeout.resolveTimeout(options.timeoutMs);
      try {
        this.#assertValidTimeout(timeoutMs);
      } catch (error) {
        pending.settleReject(error);
        return;
      }
      if (timeoutMs !== undefined && timeoutMs !== false) {
        if (timeoutMs <= 0) {
          pending.settleReject(new WebRpcTimeoutError());
          notifyRemoteAbort();
          return;
        }
        let releaseControl!: () => void;
        const control = new Promise<void>((resolveControl) => {
          releaseControl = resolveControl;
        });
        releaseTimeoutControl = releaseControl;
        void raceWithAsyncControl({
          operation: () => control,
          timeoutMs,
          createTimeoutError: () => new WebRpcTimeoutError(),
          createAbortError: () => new WebRpcAbortError(),
          onTimeout: () => {
            if (pending.settleReject(new WebRpcTimeoutError())) notifyRemoteAbort();
          },
          onDiagnostic: (error) =>
            this.#emit({ name: 'failure', code: WebRpcErrorCode.internal, error })
        }).catch(() => undefined);
      }
      if (settlement.isSettled()) return;
      if (
        !this.#resourceManager.commitPending(request.taskId, pending, () => !settlement.isSettled())
      )
        return;
      Promise.resolve()
        .then(() => {
          if (settlement.isSettled()) return;
          return this.#send(request, options.transfer);
        })
        .catch((error) => {
          pending.settleReject(
            error instanceof WebRpcError
              ? error
              : new WebRpcTransportError('Transport send failed', error)
          );
        });
    });
  }
  async #receive(message: unknown): Promise<void> {
    const generation = this.#receiveGeneration;
    let inbound: IWebRpcInboundMessage<unknown> | undefined;
    const messageKind = safeRead<unknown>(message, 'kind');
    const messageData = safeRead<unknown>(message, 'data');
    const messagePeerId = safeRead<unknown>(message, 'peerId');
    const messageOrigin = safeRead<unknown>(message, 'origin');
    const messageSource = safeRead<unknown>(message, 'source');
    if (
      message &&
      typeof message === 'object' &&
      messageKind === undefined &&
      (messageData !== undefined ||
        messagePeerId !== undefined ||
        messageOrigin !== undefined ||
        messageSource !== undefined)
    ) {
      const candidate = {
        data: messageData,
        peerId: typeof messagePeerId === 'string' ? messagePeerId : undefined,
        origin: typeof messageOrigin === 'string' ? messageOrigin : undefined,
        source: messageSource
      };
      if (
        (candidate.peerId === undefined || typeof candidate.peerId === 'string') &&
        (candidate.origin === undefined || typeof candidate.origin === 'string')
      )
        inbound = candidate;
    }
    const source = inbound;
    if (inbound) message = inbound.data;
    let decoded: unknown;
    try {
      if (this.#authentication) {
        message = await this.#authentication.unprotect(
          message,
          Object.freeze({
            direction: 'inbound',
            endpointId: this.#id,
            platform: this.#transportPlatform
          })
        );
      }
      decoded = this.#protocol.decode(message);
    } catch (error) {
      if (error instanceof WebRpcAuthenticationError) {
        this.#emit({
          name: 'authentication.rejected',
          code: WebRpcErrorCode.authenticationFailed,
          error
        });
        return;
      }
      this.#emit({ name: 'failure', code: 'PAYLOAD_INVALID', error });
      return;
    }
    let envelope = normalizeWebRpcEnvelope(decoded);
    if (envelope?.kind === 'chunk') {
      const frame = envelope as IWebRpcChunkFrame;
      if (frame.targetId !== this.#id) return;
      if (!this.#validIdentifiers(frame)) return;
      const verifiedPeerKey = await this.#verifySource(frame, source, false, generation);
      if (!verifiedPeerKey || generation !== this.#receiveGeneration || this.#disposed) return;
      const assembled = this.#resourceManager.acceptChunk(frame, verifiedPeerKey);
      if (assembled === undefined) return;
      try {
        decoded = this.#protocol.decode(assembled);
      } catch (error) {
        this.#emit({ name: 'failure', code: 'PAYLOAD_INVALID', error });
        return;
      }
      envelope = normalizeWebRpcEnvelope(decoded);
    }
    if (!envelope) return;
    if (
      (envelope.kind === 'discovery-query' || envelope.kind === 'discovery-response') &&
      (envelope.sentAt < Date.now() - this.#maxClockSkewMs ||
        envelope.sentAt > Date.now() + this.#maxClockSkewMs)
    ) {
      this.#emit({ name: 'authentication.rejected', code: 'DISCOVERY_STALE' });
      return;
    }
    if (
      envelope.kind === 'variation' &&
      (envelope.sentAt < Date.now() - this.#maxClockSkewMs ||
        envelope.sentAt > Date.now() + this.#maxClockSkewMs)
    ) {
      this.#emit({ name: 'authentication.rejected', code: 'VARIATION_STALE' });
      return;
    }
    const receiverId = 'receiverId' in envelope ? envelope.receiverId : undefined;
    if (
      receiverId !== undefined &&
      envelope.kind !== 'response' &&
      envelope.kind !== 'discovery-response' &&
      !this.#ownsReceiver(envelope.targetId, receiverId) &&
      !(
        envelope.kind === 'variation' &&
        envelope.variation === 'pong' &&
        this.#resourceManager.getPingPending(envelope.taskId)?.receiverId === receiverId
      )
    )
      return;
    if (envelope.kind === 'chunk') return;
    if (
      envelope.kind !== 'variation' &&
      envelope.kind !== 'discovery-query' &&
      envelope.kind !== 'discovery-response' &&
      !this.#validContract(envelope)
    ) {
      this.#emit({ name: 'failure', code: 'CONTRACT_INVALID', contract: envelope });
      return;
    }
    if (envelope.kind === 'variation' && !this.#validIdentifiers(envelope)) return;
    if (envelope.targetId !== this.#id) return;
    const pendingResponse =
      envelope.kind === 'response'
        ? this.#resourceManager.getPending<IPendingTask>(envelope.taskId)
        : undefined;
    const pendingPong =
      envelope.kind === 'variation' && envelope.variation === 'pong'
        ? this.#resourceManager.getPingPending(envelope.taskId)
        : undefined;
    const requiresExistingUniqueBinding =
      this.#transportPlatform === 'BroadcastChannel' &&
      this.#connect?.uniqueTargetId !== undefined &&
      envelope.kind !== 'discovery-query' &&
      envelope.kind !== 'discovery-response';
    const requiresExistingBinding =
      requiresExistingUniqueBinding ||
      (envelope.kind === 'response' &&
        (pendingResponse === undefined || pendingResponse.verifiedPeerKey !== undefined)) ||
      (envelope.kind === 'variation' &&
        envelope.variation === 'pong' &&
        (pendingPong === undefined || pendingPong.verifiedPeerKey !== undefined));
    const verifiedPeerKey = await this.#verifySource(
      envelope,
      source,
      requiresExistingBinding,
      generation
    );
    if (!verifiedPeerKey || generation !== this.#receiveGeneration || this.#disposed) return;
    if (envelope.kind === 'discovery-query') {
      if (envelope.targetId !== this.#id) return;
      if (envelope.manual && this.#connect?.discoveryMode === 'manual') {
        const replayKey = tupleKey(
          'manual-query',
          verifiedPeerKey,
          envelope.senderId,
          envelope.taskId
        );
        if (this.#isCompletedTask(replayKey)) {
          this.#emit({ name: 'authentication.rejected', code: 'MANUAL_QUERY_REPLAY' });
          return;
        }
        const queryKey = tupleKey(
          'manual-query',
          verifiedPeerKey,
          envelope.senderId,
          envelope.taskId
        );
        if (this.#discovery.hasInboundQuery(queryKey)) {
          this.#emit({
            name: 'authentication.rejected',
            code: 'MANUAL_QUERY_COLLISION'
          });
          return;
        }
        if (this.#discovery.inboundQuerySize() >= this.#maxManualInboundQueries) {
          this.#emit({ name: 'failure', code: 'MANUAL_QUERY_LIMIT' });
          return;
        }
        if (!this.#discoveryReplay.admit(replayKey, verifiedPeerKey)) {
          this.#emit({ name: 'failure', code: 'DISCOVERY_QUERY_LIMIT' });
          return;
        }
        const queryData =
          envelope.data && typeof envelope.data === 'object' && !Array.isArray(envelope.data)
            ? Object.freeze(
                Object.fromEntries(
                  Object.entries(envelope.data as Record<string, unknown>).filter(
                    ([key]) => key !== '__unique_id__'
                  )
                )
              )
            : envelope.data;
        this.#discovery.setInboundQuery(queryKey, {
          queryId: envelope.taskId,
          senderId: envelope.senderId,
          targetId: envelope.targetId,
          verifiedPeerKey,
          data: queryData,
          platform: this.#transportPlatform,
          origin: source?.origin
        });
        this.#setInboundDiscoveryTimer(
          queryKey,
          createRuntimeTimer(() => {
            this.#deleteInboundDiscoveryTimer(queryKey);
            if (!this.#discovery.deleteInboundQuery(queryKey)) return;
            this.#rememberCompletedTask(replayKey, verifiedPeerKey);
            this.#emit({
              name: 'authentication.rejected',
              code: 'MANUAL_QUERY_EXPIRED'
            });
          }, this.#manualInboundQueryTtlMs)
        );
        const listener = this.#manualQueryListeners.values().next().value as
          | ((query: IWebRpcInboundDiscoveryQuery<TTargetId>) => void | Promise<void>)
          | undefined;
        if (listener) {
          const handle: IWebRpcInboundDiscoveryQuery<TTargetId> = Object.freeze({
            targetId: this.#id as TTargetId,
            data: queryData,
            platform: this.#transportPlatform,
            origin: source?.origin,
            accept: (data) => this.#settleManualInboundQuery(queryKey, true, data),
            reject: (reason) => this.#settleManualInboundQuery(queryKey, false, undefined, reason)
          });
          try {
            void Promise.resolve(listener(handle)).catch((error) =>
              this.#emit({ name: 'failure', code: WebRpcErrorCode.internal, error })
            );
          } catch (error) {
            this.#emit({ name: 'failure', code: WebRpcErrorCode.internal, error });
          }
        }
        return;
      }
      const replayKey = tupleKey(
        'automatic-query',
        verifiedPeerKey,
        envelope.senderId,
        envelope.taskId
      );
      if (this.#isCompletedTask(replayKey)) {
        this.#emit({ name: 'authentication.rejected', code: 'DISCOVERY_QUERY_REPLAY' });
        return;
      }
      if (!this.#discoveryReplay.canAdmit(replayKey, verifiedPeerKey)) {
        this.#emit({ name: 'failure', code: 'DISCOVERY_QUERY_LIMIT' });
        return;
      }
      if (!this.#admitAutomaticDiscovery(verifiedPeerKey, replayKey)) {
        this.#emit({ name: 'failure', code: 'DISCOVERY_QUERY_LIMIT' });
        return;
      }
      if (!this.#discoveryReplay.admit(replayKey, verifiedPeerKey)) {
        this.#discovery.deleteAdmission(replayKey);
        this.#emit({ name: 'failure', code: 'DISCOVERY_QUERY_LIMIT' });
        return;
      }
      const receiverId = this.#ensureLocalReceiver(this.#id as TTargetId);
      const response: IWebRpcDiscoveryResponse = {
        kind: 'discovery-response',
        taskId: envelope.taskId,
        senderId: this.#id,
        targetId: envelope.senderId,
        resolvedTargetId: this.#id,
        sentAt: Date.now(),
        ...(this.#connect?.uniqueTargetId === undefined
          ? {}
          : { data: { __unique_id__: this.#connect.uniqueTargetId } }),
        platform: this.#transportPlatform,
        receiverId
      };
      void Promise.resolve()
        .then(() => this.#send(response))
        .catch((error: unknown) =>
          this.#emit({ name: 'transport.failure', code: WebRpcErrorCode.transport, error })
        );
      return;
    }
    if (envelope.kind === 'discovery-response') {
      if (envelope.manual && envelope.operation === 'unregister') {
        // A requester may only forget its own remote DNS entry. It cannot
        // mutate the server's local ownership through a generic wire message.
        this.#emit({
          name: 'authentication.rejected',
          code: 'UNAUTHORIZED_MANUAL_UNREGISTER'
        });
        return;
      }
      if (envelope.manual) {
        const waiter = this.#discovery.getManualWaiter<IManualDiscoveryWaiter<TTargetId>>(
          envelope.taskId
        );
        if (!waiter || waiter.targetId !== envelope.resolvedTargetId) return;
        if (envelope.accepted !== true) return;
        if (typeof envelope.receiverId !== 'string') {
          this.#emit({ name: 'failure', code: WebRpcErrorCode.invalidConfig });
          return;
        }
        try {
          this.#validateIdentifier(envelope.receiverId, 'receiverId');
        } catch (error) {
          this.#emit({ name: 'failure', code: WebRpcErrorCode.invalidConfig, error });
          return;
        }
        const candidateUniqueId =
          envelope.data && typeof envelope.data === 'object'
            ? safeRead<unknown>(envelope.data, '__unique_id__')
            : undefined;
        if (candidateUniqueId !== undefined && typeof candidateUniqueId !== 'string') {
          this.#emit({
            name: 'failure',
            code: WebRpcErrorCode.invalidConfig,
            error: new WebRpcError(
              WebRpcErrorCode.invalidConfig,
              'discovery candidate uniqueTargetId must be a string'
            )
          });
          return;
        }
        if (candidateUniqueId !== undefined) {
          try {
            this.#validateIdentifier(candidateUniqueId, 'uniqueTargetId');
          } catch (error) {
            this.#emit({ name: 'failure', code: WebRpcErrorCode.invalidConfig, error });
            return;
          }
        }
        // Platform is adapter-owned metadata; a wire claim must never select
        // receiver validation rules or become part of the DNS snapshot.
        const candidatePlatform = this.#transportPlatform;
        if (
          candidatePlatform === 'BroadcastChannel' &&
          envelope.receiverId !==
            (candidateUniqueId === undefined
              ? envelope.resolvedTargetId
              : `${envelope.resolvedTargetId}:${candidateUniqueId}`)
        )
          return;
        const candidateKey = tupleKey(
          verifiedPeerKey,
          envelope.resolvedTargetId,
          envelope.receiverId
        );
        if (waiter.candidateKeys.has(candidateKey)) return;
        const peerCandidateCount = waiter.candidatePeerCounts.get(verifiedPeerKey) ?? 0;
        if (waiter.candidates.length >= this.#maxManualCandidatesPerQuery) {
          this.#emit({ name: 'failure', code: 'MANUAL_CANDIDATE_LIMIT' });
          return;
        }
        if (peerCandidateCount >= this.#maxManualCandidatesPerPeer) {
          this.#emit({ name: 'failure', code: 'MANUAL_CANDIDATE_PEER_LIMIT' });
          return;
        }
        const candidate = Object.freeze({
          queryId: envelope.taskId,
          targetId: envelope.resolvedTargetId as TTargetId,
          receiverId: envelope.receiverId,
          data: envelope.data,
          platform: candidatePlatform,
          origin: source?.origin
        });
        waiter.candidateKeys.add(candidateKey);
        waiter.candidatePeerCounts.set(verifiedPeerKey, peerCandidateCount + 1);
        waiter.candidates.push(candidate);
        this.#discovery.setCandidate(
          candidate,
          {
            expiresAt: Date.now() + this.#manualInboundQueryTtlMs,
            registered: false,
            revoked: false,
            verifiedPeerKey
          },
          candidateUniqueId
        );
        return;
      }
      const targetId = this.#discovery.getTask(envelope.taskId);
      if (targetId !== envelope.resolvedTargetId || envelope.targetId !== this.#id) return;
      if (typeof envelope.receiverId !== 'string') {
        this.#emit({ name: 'failure', code: WebRpcErrorCode.invalidConfig });
        return;
      }
      try {
        this.#validateIdentifier(envelope.receiverId, 'receiverId');
      } catch (error) {
        this.#emit({ name: 'failure', code: WebRpcErrorCode.invalidConfig, error });
        return;
      }
      const uniqueTargetId =
        envelope.data && typeof envelope.data === 'object'
          ? safeRead<unknown>(envelope.data, '__unique_id__')
          : undefined;
      if (uniqueTargetId !== undefined) {
        if (typeof uniqueTargetId !== 'string') {
          this.#emit({ name: 'failure', code: WebRpcErrorCode.invalidConfig });
          return;
        }
        try {
          this.#validateIdentifier(uniqueTargetId, 'uniqueTargetId');
        } catch (error) {
          this.#emit({ name: 'failure', code: WebRpcErrorCode.invalidConfig, error });
          return;
        }
      }
      // The response's platform claim is diagnostic-only. Route validation
      // must use the platform observed by this endpoint's adapter.
      const responsePlatform = this.#transportPlatform;
      if (
        responsePlatform === 'BroadcastChannel' &&
        envelope.receiverId !==
          (uniqueTargetId === undefined
            ? envelope.resolvedTargetId
            : `${envelope.resolvedTargetId}:${uniqueTargetId}`)
      )
        return;
      const receiverId = envelope.receiverId;
      const responseCount = (this.#discovery.getResponseCount(envelope.taskId) ?? 0) + 1;
      this.#discovery.setResponseCount(envelope.taskId, responseCount);
      if (
        responseCount === 2 &&
        responsePlatform === 'BroadcastChannel' &&
        uniqueTargetId === undefined
      )
        this.#emit({
          name: 'connect.multiple-receivers',
          code: 'MULTIPLE_RECEIVERS',
          targetId: envelope.resolvedTargetId,
          requesterId: this.#id,
          receiverIds: Object.freeze([String(envelope.resolvedTargetId)]),
          ambiguous: true,
          responseCount
        });
      const remoteKey = tupleKey(envelope.resolvedTargetId, receiverId);
      const now = Date.now();
      this.#discovery.purgeRemote<IWebRpcServerMetadata<TTargetId>>(
        (entry) =>
          entry.status === 'active' && now - entry.lastSeenAt >= this.#receiverStaleAfterMs,
        (entry) => entry.pinned || this.#discovery.getPin(entry.targetId) === entry.receiverId
      );
      if (
        !this.#discovery.hasRemote(remoteKey) &&
        this.#receiverCount(envelope.resolvedTargetId) >= this.#maxReceiversPerTarget
      ) {
        this.#emit({
          name: 'connect.receiver-announcement.failure',
          code: 'RECEIVER_LIMIT',
          targetId: envelope.resolvedTargetId,
          receiverId
        });
        return;
      }
      const previousRemote = this.#discovery.getRemote<IWebRpcServerMetadata<TTargetId>>(remoteKey);
      if (
        !this.#discovery.setRemoteWithBinding(
          remoteKey,
          {
            targetId: envelope.resolvedTargetId as TTargetId,
            receiverId,
            ...(typeof uniqueTargetId === 'string' ? { uniqueTargetId } : {}),
            platform: responsePlatform,
            origin: source?.origin,
            registeredAt: previousRemote?.registeredAt ?? now,
            lastSeenAt: now,
            pinned:
              previousRemote?.pinned ??
              this.#discovery.getPin(envelope.resolvedTargetId as TTargetId) === receiverId,
            status: 'active'
          },
          verifiedPeerKey
        )
      ) {
        this.#emit({ name: 'connect.receiver-announcement.failure', code: 'DISCOVERY_LIMIT' });
        return;
      }
      this.#diagnoseMultipleReceivers(envelope.resolvedTargetId as TTargetId);
      this.#discovery.resolveAutomatic(targetId, (onExpire) => createRuntimeTimer(onExpire, 1000));
      return;
    }
    this.#peers.add(envelope.senderId as TTargetId);
    if (envelope.kind === 'response') {
      this.#settle(envelope, verifiedPeerKey);
      return;
    }
    if (envelope.kind === 'variation') {
      return this.#handleVariation(envelope, verifiedPeerKey);
    }
    await this.#handleRequest(envelope, verifiedPeerKey);
  }

  /** Handles one inbound control variation under a manager-owned terminal scope. */
  async #handleVariation(
    envelope: Extract<IWebRpcEnvelope, { kind: 'variation' }>,
    verifiedPeerKey: string
  ): Promise<void> {
    const operation = this.#resourceManager.begin(
      'variation',
      tupleKey(verifiedPeerKey, envelope.senderId, envelope.taskId, envelope.variation),
      true
    );
    try {
      if (envelope.variation === 'ping' || envelope.variation === 'abort') {
        const variationReplayKey = tupleKey(
          'variation',
          verifiedPeerKey,
          envelope.senderId,
          envelope.taskId,
          envelope.variation
        );
        if (!this.#controlTasks.admitControl(verifiedPeerKey, variationReplayKey)) {
          this.#emit({ name: 'failure', code: 'VARIATION_LIMIT' });
          return;
        }
      }
      if (this.#features.abort === true && envelope.variation === 'abort' && envelope.taskId) {
        const abortKey = tupleKey(verifiedPeerKey, envelope.senderId, envelope.taskId);
        const controller = this.#activeControllers.get(abortKey);
        if (controller) controller.abort();
        else if (this.#controlTasks.rememberAbort(abortKey, Date.now() + this.#maxClockSkewMs)) {
          // The control registry owns the pending-abort state.
        } else this.#emit({ name: 'failure', code: 'ABORT_LIMIT' });
        return;
      }
      if (this.#features.ping === true && envelope.variation === 'ping')
        void this.#sendVariation({
          kind: 'variation',
          variation: 'pong',
          taskId: envelope.taskId,
          senderId: this.#id,
          targetId: envelope.senderId,
          sentAt: Date.now(),
          ...(envelope.receiverId === undefined ? {} : { receiverId: envelope.receiverId })
        });
      if (envelope.variation === 'pong' && envelope.taskId) {
        const pending = this.#resourceManager.getPingPending(envelope.taskId);
        if (
          pending &&
          pending.targetId === envelope.senderId &&
          (pending.verifiedPeerKey === undefined || pending.verifiedPeerKey === verifiedPeerKey)
        ) {
          if (envelope.receiverId !== undefined)
            this.#touchRemoteReceiver(pending.targetId, envelope.receiverId);
          pending.settle(true);
        } else if (pending)
          this.#emit({ name: 'variation.unmatched', code: WebRpcErrorCode.internal });
      }
    } finally {
      operation.release();
    }
  }
  async #verifySource(
    envelope: { senderId: string; targetId: string; data?: unknown },
    source?: IWebRpcInboundMessage<unknown>,
    requireExisting = false,
    generation = this.#receiveGeneration
  ): Promise<string | false> {
    // Keep object identity in binding even when peerId/origin also exist: same-origin
    // windows are distinct peers and must not collapse into one verified binding.
    const uniqueBroadcastBinding =
      this.#transportPlatform === 'BroadcastChannel' && this.#connect?.uniqueTargetId !== undefined;
    const sourceToken = uniqueBroadcastBinding ? '' : this.#sourceToken(source?.source);
    const peerId = source?.peerId;
    const origin = source?.origin;
    const bindingPeerId = uniqueBroadcastBinding ? undefined : (peerId ?? this.#connectPeerId);
    const bindingOrigin = uniqueBroadcastBinding ? undefined : (origin ?? this.#connectOrigin);
    if (this.#transport.sourceProof && !this.#transport.sourceProof(source?.source, origin)) {
      this.#emit({ name: 'authentication.rejected', code: 'SOURCE_MISMATCH' });
      return false;
    }
    if (
      this.#transportTopology !== 'multiplexed' &&
      this.#transportTopology !== 'broadcast' &&
      !(this.#transportTopology === undefined && this.#transportPlatform === 'Worker') &&
      this.#transportPlatform !== 'BroadcastChannel' &&
      this.#transportPlatform !== 'Iframe'
    ) {
      if (this.#exclusiveSenderId !== undefined && this.#exclusiveSenderId !== envelope.senderId) {
        this.#emit({ name: 'authentication.rejected', code: 'EXCLUSIVE_BINDING_CONFLICT' });
        return false;
      }
    }
    if (requireExisting) {
      if (
        !this.#resourceManager.hasPeer(envelope.senderId, bindingPeerId, bindingOrigin, sourceToken)
      ) {
        this.#emit({ name: 'authentication.rejected', code: 'UNAUTHENTICATED' });
        return false;
      }
      const existingToken = this.#resourceManager.registerPeer(
        envelope.senderId,
        bindingPeerId,
        bindingOrigin,
        sourceToken
      );
      if (existingToken) return existingToken;
      this.#emit({ name: 'authentication.rejected', code: 'UNAUTHENTICATED' });
      return false;
    }
    if (!this.#connect) {
      if (!this.#commitExclusiveSender(envelope.senderId)) return false;
      const token = this.#resourceManager.registerPeer(
        envelope.senderId,
        bindingPeerId,
        bindingOrigin,
        sourceToken
      );
      if (!token) {
        this.#emit({ name: 'failure', code: WebRpcErrorCode.overloaded });
        return false;
      }
      return token;
    }
    try {
      const verified = await this.#connect.verify({
        senderId: envelope.senderId,
        targetId: envelope.targetId,
        peerId: source?.peerId ?? this.#connectPeerId,
        origin: source?.origin ?? this.#connectOrigin,
        source: source?.source,
        platform: this.#transportPlatform,
        topology: this.#transportTopology,
        ...(envelope.data === undefined ? {} : { data: envelope.data })
      });
      if (!verified) this.#emit({ name: 'authentication.rejected', code: 'UNAUTHENTICATED' });
      if (generation !== this.#receiveGeneration || this.#disposed) return false;
      if (!verified) return false;
      if (!this.#commitExclusiveSender(envelope.senderId)) return false;
      const token = this.#resourceManager.registerPeer(
        envelope.senderId,
        bindingPeerId,
        bindingOrigin,
        sourceToken
      );
      if (!token) {
        this.#emit({ name: 'failure', code: WebRpcErrorCode.overloaded });
        return false;
      }
      return token;
    } catch (error) {
      this.#emit({ name: 'receive.failure', code: WebRpcErrorCode.transport, error });
      return false;
    }
  }
  #sourceToken(source: unknown): string {
    let sourceToken = '';
    if (source && (typeof source === 'object' || typeof source === 'function')) {
      const objectSource = source as object;
      sourceToken = this.#sourceTokens.get(objectSource) ?? `source-${++this.#nextSourceToken}`;
      this.#sourceTokens.set(objectSource, sourceToken);
    }
    return sourceToken;
  }
  /** Atomically commits the first verified sender for an exclusive connection. */
  #commitExclusiveSender(senderId: string): boolean {
    if (
      this.#transportTopology === 'multiplexed' ||
      this.#transportTopology === 'broadcast' ||
      (this.#transportTopology === undefined && this.#transportPlatform === 'Worker') ||
      this.#transportPlatform === 'BroadcastChannel' ||
      this.#transportPlatform === 'Iframe'
    )
      return true;
    if (this.#exclusiveSenderId !== undefined && this.#exclusiveSenderId !== senderId) {
      this.#emit({ name: 'authentication.rejected', code: 'EXCLUSIVE_BINDING_CONFLICT' });
      return false;
    }
    this.#exclusiveSenderId ??= senderId;
    return true;
  }
  #settle(response: IWebRpcResponse, verifiedPeerKey: string): void {
    const pending = this.#resourceManager.getPending<IPendingTask>(response.taskId);
    if (!pending) return;
    if (
      response.method !== pending.method ||
      response.senderId !== pending.targetId ||
      response.targetId !== this.#id ||
      (pending.receiverId !== undefined && response.receiverId !== pending.receiverId) ||
      (pending.verifiedPeerKey !== undefined && pending.verifiedPeerKey !== verifiedPeerKey)
    ) {
      this.#emit({ name: 'response.unmatched', code: WebRpcErrorCode.internal });
      return;
    }
    if (response.receiverId !== undefined)
      this.#touchRemoteReceiver(pending.targetId, response.receiverId);
    if (response.ok) {
      try {
        this.#validateData(response.method ?? '', 'result', response.data);
        pending.settleResolve(response.data);
      } catch (error) {
        pending.settleReject(error);
      }
    } else if (response.code === WebRpcErrorCode.schemaInvalid)
      pending.settleReject(
        new WebRpcSchemaValidationError(
          response.message ?? 'Schema validation failed',
          response.data
        )
      );
    else
      pending.settleReject(
        new WebRpcRemoteError(
          response.code ?? WebRpcErrorCode.internal,
          response.message ?? 'Remote provider failed',
          response.data
        )
      );
  }
  async #handleRequest(request: IWebRpcRequest, verifiedPeerKey = ''): Promise<void> {
    const operation = this.#resourceManager.begin(
      'provider',
      tupleKey(verifiedPeerKey, request.senderId, request.taskId),
      true
    );
    try {
      await this.#providerExecutor.execute(request, verifiedPeerKey);
    } finally {
      operation.release();
    }
  }
  #validateData(method: string, side: 'params' | 'result', data: unknown): void {
    this.#contract.validateData(method, side, data);
  }
  #validContract(message: IWebRpcRequest | IWebRpcResponse): boolean {
    const now = Date.now();
    return (
      this.#acceptedVersions.includes(message.version) &&
      Number.isSafeInteger(message.sentAt) &&
      message.sentAt >= now - this.#maxClockSkewMs &&
      message.sentAt <= now + this.#maxClockSkewMs &&
      message.senderId.length > 0 &&
      message.senderId.length <= this.#maxIdentifierLength &&
      message.targetId.length > 0 &&
      message.targetId.length <= this.#maxIdentifierLength &&
      message.taskId.length > 0 &&
      message.taskId.length <= this.#maxIdentifierLength &&
      message.method.length > 0 &&
      message.method.length <= this.#maxIdentifierLength &&
      (message.receiverId === undefined ||
        (message.receiverId.length > 0 && message.receiverId.length <= this.#maxIdentifierLength))
    );
  }
  #validIdentifiers(message: {
    senderId: string;
    targetId: string;
    taskId?: string;
    messageId?: string;
    receiverId?: string;
  }): boolean {
    try {
      this.#validateIdentifier(message.senderId, 'senderId');
      this.#validateIdentifier(message.targetId, 'targetId');
      if (message.taskId !== undefined) this.#validateIdentifier(message.taskId, 'taskId');
      if (message.messageId !== undefined) this.#validateIdentifier(message.messageId, 'messageId');
      if (message.receiverId !== undefined)
        this.#validateIdentifier(message.receiverId, 'receiverId');
      return true;
    } catch {
      this.#emit({ name: 'failure', code: 'CONTRACT_INVALID' });
      return false;
    }
  }

  #validateIdentifier(value: string, label: string): void {
    if (typeof value !== 'string' || value.length === 0 || value.length > this.#maxIdentifierLength)
      throw new WebRpcContractError(`${label} must be a non-empty identifier within the limit`);
  }
  #setDiscoveryTimer(key: string, timer: { readonly clear: () => void }): void {
    this.#resourceManager.trackTimer(key, timer);
    this.#discovery.setTimer(key, timer);
  }
  #deleteDiscoveryTimer(key: string): void {
    this.#resourceManager.releaseTimer(key);
    this.#discovery.deleteTimer(key);
  }
  #setInboundDiscoveryTimer(key: string, timer: { readonly clear: () => void }): void {
    this.#resourceManager.trackTimer(key, timer);
    this.#discovery.setInboundTimer(key, timer);
  }
  #deleteInboundDiscoveryTimer(key: string): void {
    this.#resourceManager.releaseTimer(key);
    this.#discovery.deleteInboundTimer(key);
  }
  #deleteDiscoveryWaiter(key: string): void {
    this.#resourceManager.releaseWaiter(key);
    this.#discovery.deleteWaiter(key);
  }
  #assertValidTimeout(timeoutMs: number | false | undefined): void {
    if (
      timeoutMs !== undefined &&
      timeoutMs !== false &&
      (!Number.isFinite(timeoutMs) || timeoutMs < 0)
    )
      throw new WebRpcContractError('timeoutMs must be false or a non-negative finite number');
  }
  #send(message: unknown, transfer?: readonly unknown[]): void | Promise<void> {
    const targetId = (message as { targetId: TTargetId }).targetId;
    return this.#pipeline.send(message, (target) => this.#makeId('message', target ?? targetId), {
      transfer
    });
  }
  #sendVariation(message: unknown, rejectOnFailure = false): Promise<void> {
    return this.#pipeline.sendVariation(message, rejectOnFailure);
  }
  #makeId(variation: 'task' | 'message' | 'variation', targetId: TTargetId): string {
    const id = allocateRpcId(
      this.#uuid,
      variation,
      this.#id,
      String(targetId),
      (id) =>
        this.#resourceManager.getPending<IPendingTask>(id) !== undefined ||
        this.#resourceManager.getPingPending(id) !== undefined ||
        this.#resourceManager.hasReservedId(id)
    );
    this.#validateIdentifier(id, `${variation} id`);
    if (!this.#resourceManager.reserveId(id))
      throw new WebRpcError(WebRpcErrorCode.overloaded, 'Outbound identifier ledger is full');
    return id;
  }
}
