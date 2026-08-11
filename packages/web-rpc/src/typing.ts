import type { IWebRpcError } from './errors';
import type { IWebRpcTransport } from './transport';

export type IWebRpcProviderResult =
  | { readonly ok: true; readonly data?: unknown; readonly transfer?: readonly unknown[] }
  | { readonly ok: false; readonly message: string; readonly code: string };
export type IWebRpcContext = {
  readonly data: unknown;
  readonly signal: IWebRpcAbortSignal;
  success(
    data?: unknown,
    options?: { readonly transfer?: readonly unknown[] }
  ): IWebRpcProviderResult;
  failed(message: string, code: string): IWebRpcProviderResult;
  dispatchTo(input: {
    readonly id?: string;
    readonly method: string;
    readonly data: unknown;
  }): void;
};
export type IWebRpcProvider = (
  context: IWebRpcContext
) => IWebRpcProviderResult | Promise<IWebRpcProviderResult>;
export type IWebRpcEventListener = (context: IWebRpcContext) => void | Promise<void>;
export type ISendOptions = {
  readonly signal?: IWebRpcAbortSignal;
  readonly timeoutMs?: number | false;
  readonly transfer?: readonly unknown[];
};
export type IWebRpcHookEvent = {
  readonly name: string;
  readonly at: number;
  readonly localId: string;
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
};
export type IWebRpcHook = (event: IWebRpcHookEvent) => void | Promise<void>;
export type IWebRpcSchemaIssue = {
  readonly path: readonly (string | number)[];
  readonly message: string;
  readonly code?: string;
};
export type IWebRpcSchema<T = unknown> = { parse(value: unknown): T };
export type IWebRpcMethodSchema = {
  readonly params: IWebRpcSchema;
  readonly result: IWebRpcSchema;
};
export type IWebRpcContractConfig = {
  readonly version?: string;
  readonly acceptVersions?: readonly string[];
  readonly maxIdentifierLength?: number;
  readonly schemas?: Readonly<Record<string, IWebRpcMethodSchema>>;
};
/** Executable contract capability installed by contract middleware. */
export type IWebRpcContractCapability = IWebRpcContractConfig & {
  readonly validateData: (method: string, side: 'params' | 'result', data: unknown) => void;
};
export type IWebRpcUuidContext = {
  readonly variation: 'task' | 'message' | 'variation';
  readonly senderId: string;
  readonly targetId?: string;
};
export type IWebRpcUuidConfig = { readonly generate?: (context: IWebRpcUuidContext) => string };
export type IWebRpcProtocolConfig = {
  readonly encode?: (value: unknown) => unknown;
  readonly decode?: (value: unknown) => unknown;
  readonly encodedType?: 'any' | 'string' | 'uint8array';
};
/** Normalized protocol capability installed by protocol middleware. */
export type IWebRpcProtocolCapability = {
  readonly encode: (value: unknown) => unknown;
  readonly decode: (value: unknown) => unknown;
  readonly encodedType?: 'any' | 'string' | 'uint8array';
  readonly identity?: boolean;
};
export type IWebRpcAuthenticationContext = {
  readonly direction: 'outbound' | 'inbound';
  readonly endpointId: string;
  readonly platform: IWebRpcPlatform;
};
export type IWebRpcAuthenticationTransform = (
  value: unknown,
  context: IWebRpcAuthenticationContext
) => unknown | Promise<unknown>;
export type IWebRpcAuthenticationConfig = {
  readonly encrypt?: IWebRpcAuthenticationTransform;
  readonly decrypt?: IWebRpcAuthenticationTransform;
  readonly sign?: IWebRpcAuthenticationTransform;
  readonly verify?: IWebRpcAuthenticationTransform;
  readonly encodedType?: 'any' | 'string' | 'uint8array';
};
/** Executable per-frame protection installed by authentication middleware. */
export type IWebRpcAuthenticationCapability = {
  readonly enabled: true;
  readonly encodedType: 'any' | 'string' | 'uint8array';
  readonly protect: IWebRpcAuthenticationTransform;
  readonly unprotect: IWebRpcAuthenticationTransform;
};
export type IWebRpcRetryContext = {
  readonly attempt: number;
  readonly error: unknown;
  readonly targetId: string;
  readonly method: string;
  readonly data: unknown;
};
export type IWebRpcRetryConfig = {
  readonly maxAttempts?: number;
  readonly shouldRetry?: (context: IWebRpcRetryContext) => boolean | Promise<boolean>;
  readonly delay?: (
    context: IWebRpcRetryContext
  ) => number | false | null | Promise<number | false | null>;
};
export type IWebRpcTimeoutConfig = {
  readonly timeoutMs?: number | false;
  readonly retry?: IWebRpcRetryConfig;
};
/** Executable timeout capability installed by timeout middleware. */
export type IWebRpcTimeoutCapability = IWebRpcTimeoutConfig & {
  readonly resolveTimeout: (override?: number | false) => number | false | undefined;
};
export type IWebRpcHooksConfig = {
  readonly listeners?: IWebRpcHook | readonly IWebRpcHook[];
  readonly onHookError?: (error: unknown, event: IWebRpcHookEvent) => void;
};
export type IWebRpcChunkConfig = {
  readonly chunkSize?: number;
  readonly maxMessageBytes?: number;
  readonly maxConcurrentMessages?: number;
  readonly maxConcurrentMessagesPerPeer?: number;
  readonly maxBufferedBytes?: number;
  readonly maxChunksPerMessage?: number;
  readonly maxChunkBytes?: number;
  readonly assemblyTimeoutMs?: number;
  readonly byteLength?: (value: string) => number;
  readonly split?: (value: string, maxBytes: number) => readonly string[];
};
/** Normalized chunk capability installed by chunk middleware. */
export type IWebRpcChunkCapability = IWebRpcChunkConfig & {
  readonly byteLength: (value: string) => number;
  readonly split: (value: string, maxBytes: number) => readonly string[];
};
export type IWebRpcConnectContext = {
  readonly senderId: string;
  readonly targetId: string;
  readonly peerId?: string;
  readonly origin?: string;
  readonly source?: unknown;
  readonly data?: unknown;
  readonly platform?: IWebRpcPlatform;
  readonly topology?: 'exclusive' | 'multiplexed' | 'broadcast';
};
export type IWebRpcUniqueTargetIdContext = {
  readonly endpointId: string;
  readonly platform: IWebRpcPlatform;
};
export type IWebRpcConnectConfig = {
  /** Optional when factory.transport supplies the canonical transport. */
  readonly transport?: IWebRpcTransport;
  readonly useBaseIdVerifyOnly?: boolean;
  readonly uniqueTargetId?:
    | string
    | ((context: IWebRpcUniqueTargetIdContext) => string | Promise<string>);
  readonly discoveryMode?: 'automatic' | 'manual';
  readonly identifier?: (context: IWebRpcConnectContext) => boolean | Promise<boolean>;
  readonly receiverSelector?: (
    serverList: readonly IWebRpcServerMetadata[],
    context: {
      readonly endpointId: string;
      readonly targetId: string;
      readonly operation: 'send' | 'dispatch' | 'ping';
    }
  ) => string | undefined | Promise<string | undefined>;
};
export type IWebRpcAutomaticConnectControl<TTargetId extends string = string> = Pick<
  IWebRpcConnectControl<TTargetId>,
  'getServerList' | 'pinReceiver' | 'unpinReceiver'
>;
export type IWebRpcManualConnectControl<TTargetId extends string = string> =
  IWebRpcAutomaticConnectControl<TTargetId> &
    Required<
      Pick<
        IWebRpcConnectControl<TTargetId>,
        'query' | 'onQuery' | 'register' | 'unregister' | 'ping'
      >
    >;
export type IWebRpcDiscoveryMode = 'automatic' | 'manual';
export type IWebRpcConnectControlForMode<
  TTargetId extends string,
  TMode extends IWebRpcDiscoveryMode
> = TMode extends 'manual'
  ? IWebRpcManualConnectControl<TTargetId>
  : IWebRpcAutomaticConnectControl<TTargetId>;
/** Executable peer-verification capability installed by connect middleware. */
export type IWebRpcConnectCapability = Omit<IWebRpcConnectConfig, 'uniqueTargetId'> & {
  readonly uniqueTargetId?: string;
  readonly uniqueTargetIdFactory?: (
    context: IWebRpcUniqueTargetIdContext
  ) => string | Promise<string>;
  readonly verify: (context: IWebRpcConnectContext) => boolean | Promise<boolean>;
};
export type IWebRpcPlatform =
  | 'Worker'
  | 'Iframe'
  | 'BroadcastChannel'
  | 'MessagePort'
  | 'Memory'
  | 'WebTransport'
  | 'RTCDataChannel';
export type IWebRpcServerMetadata<TTargetId extends string = string> = {
  readonly targetId: TTargetId;
  readonly receiverId: string;
  readonly uniqueTargetId?: string;
  readonly platform: IWebRpcPlatform;
  readonly origin?: string;
  readonly registeredAt: number;
  readonly lastSeenAt: number;
  readonly pinned: boolean;
  readonly status: 'active' | 'stale' | 'unregistered';
};
export type IWebRpcConnectControl<TTargetId extends string = string> = {
  readonly getServerList: (targetId?: TTargetId) => readonly IWebRpcServerMetadata<TTargetId>[];
  readonly pinReceiver: (targetId: TTargetId, receiverId: string) => void;
  readonly unpinReceiver: (targetId: TTargetId) => void;
  query?: (
    targetId: TTargetId,
    options?: { readonly timeoutMs?: number; readonly signal?: IWebRpcAbortSignal }
  ) => Promise<readonly IWebRpcDiscoveryCandidate<TTargetId>[]>;
  onQuery?: (
    listener: (query: IWebRpcInboundDiscoveryQuery<TTargetId>) => void | Promise<void>
  ) => () => void;
  register?: (candidate: IWebRpcDiscoveryCandidate<TTargetId>) => void;
  unregister?: (targetId: TTargetId, receiverId?: string) => Promise<void>;
  ping?: (
    candidate: IWebRpcDiscoveryCandidate<TTargetId>,
    options?: { readonly timeoutMs?: number; readonly signal?: IWebRpcAbortSignal }
  ) => Promise<boolean>;
};
export type IWebRpcInboundDiscoveryQuery<TTargetId extends string = string> = {
  readonly targetId: TTargetId;
  readonly data: unknown;
  readonly platform: IWebRpcPlatform;
  readonly origin?: string;
  readonly accept: (data?: unknown) => Promise<boolean>;
  readonly reject: (reason?: string) => Promise<boolean>;
};
export type IWebRpcDiscoveryCandidate<TTargetId extends string = string> = {
  readonly queryId: string;
  readonly targetId: TTargetId;
  readonly receiverId?: string;
  readonly data: unknown;
  readonly platform: IWebRpcPlatform;
  readonly origin?: string;
};
export type IWebRpcDiscoveryControl<TTargetId extends string = string> = {
  readonly getServerList: (targetId?: TTargetId) => readonly IWebRpcServerMetadata<TTargetId>[];
  readonly pinReceiver: (targetId: TTargetId, receiverId: string) => void;
  readonly unpinReceiver: (targetId: TTargetId) => void;
};
export type IWebRpcFeatureConfig = { readonly abort?: boolean; readonly ping?: boolean };
export type IWebRpcAbortCapability = { readonly enabled: true };
export type IWebRpcPingCapability = { readonly enabled: true };
export type IWebRpcFanoutResult<TResult> = {
  readonly fulfilled: Partial<Record<string, TResult>>;
  readonly rejected: Partial<Record<string, unknown>>;
};

export type IWebRpcMiddlewareContext = {
  readonly id: string;
  /**
   * Aborts when factory construction is cancelled or reaches its deadline. Factory installs always
   * provide it.
   */
  readonly signal?: IWebRpcAbortSignal;
  readonly transport: IWebRpcTransport;
  readonly hooks: (event: IWebRpcHookEvent) => void;
  readonly capabilities: {
    set<T>(key: string, value: T): void;
    get<T>(key: string): T | undefined;
  };
};
export type IWebRpcMiddleware = {
  readonly name: string;
  readonly discoveryMode?: IWebRpcDiscoveryMode;
  readonly pingCapability?: true;
  readonly transport?: IWebRpcTransport;
  readonly install: (
    context: IWebRpcMiddlewareContext
  ) => void | (() => void) | Promise<void | (() => void)>;
};
export type IWebRpcFactoryConfig<
  TTargetId extends string = string,
  TMiddlewares extends readonly IWebRpcMiddleware[] = readonly IWebRpcMiddleware[]
> = {
  readonly id: string;
  readonly targetIds?: readonly TTargetId[];
  readonly transport?: IWebRpcTransport;
  readonly provider?: Readonly<Record<string, IWebRpcProvider>>;
  readonly middlewares: TMiddlewares;
  readonly construction?: {
    readonly signal?: IWebRpcAbortSignal;
    readonly timeoutMs?: number | false;
  };
};
export type IFactoryDiscoveryMode<TMiddlewares extends readonly IWebRpcMiddleware[]> = [
  Extract<TMiddlewares[number], { readonly discoveryMode: 'manual' }>
] extends [never]
  ? 'automatic'
  : 'manual';
export type IFactoryPingCapability<TMiddlewares extends readonly IWebRpcMiddleware[]> = [
  Extract<TMiddlewares[number], { readonly pingCapability: true }>
] extends [never]
  ? false
  : true;
export type IWebRpcPingEndpointSurface<TPing extends boolean> = boolean extends TPing
  ? {
      ping(targetId: string): Promise<boolean>;
      pingAll(): Promise<IWebRpcFanoutResult<boolean>>;
    }
  : TPing extends true
    ? {
        ping(targetId: string): Promise<boolean>;
        pingAll(): Promise<IWebRpcFanoutResult<boolean>>;
      }
    : {};
export type IWebRpcEndpoint<
  TTargetId extends string = string,
  TMode extends IWebRpcDiscoveryMode = 'automatic',
  TPing extends boolean = boolean
> = {
  provide(method: string, provider: IWebRpcProvider): IWebRpcEndpoint<TTargetId, TMode, TPing>;
  on(event: string, listener: IWebRpcEventListener): () => void;
  send<T>(targetId: TTargetId, method: string, data: unknown, options?: ISendOptions): Promise<T>;
  sendAll<T>(
    method: string,
    data: unknown,
    options?: ISendOptions
  ): Promise<IWebRpcFanoutResult<T>>;
  dispatch(targetId: TTargetId, method: string, data: unknown): void;
  dispatchAll(method: string, data: unknown): void;
  readonly connect: IWebRpcConnectControlForMode<TTargetId, TMode>;
  readonly discovery: IWebRpcDiscoveryControl<TTargetId>;
  readonly hooks: { on(listener: IWebRpcHook): () => void };
  dispose(): Promise<void>;
} & IWebRpcPingEndpointSurface<TPing>;
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
>;
export type IWebRpcPublicError = IWebRpcError;
/** Structural cancellation signal used by the public API without requiring DOM typings. */
export type IWebRpcAbortSignal = {
  readonly aborted: boolean;
  addEventListener(
    type: 'abort',
    listener: () => void,
    options?: { readonly once?: boolean }
  ): void;
  removeEventListener(type: 'abort', listener: () => void): void;
  readonly throwIfAborted?: () => void;
};
