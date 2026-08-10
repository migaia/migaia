import type { IWebRpcError } from './errors';
import type { IWebRpcTransport } from './transport';

export type IWebRpcProviderResult =
  | { readonly ok: true; readonly data?: unknown }
  | { readonly ok: false; readonly message: string; readonly code: string };
export type IWebRpcContext = {
  readonly data: unknown;
  readonly signal: AbortSignal;
  success(data?: unknown): IWebRpcProviderResult;
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
export type ISendOptions = { readonly signal?: AbortSignal; readonly timeoutMs?: number | false };
export type IWebRpcHookEvent = {
  readonly name: string;
  readonly at: number;
  readonly localId: string;
  readonly code?: string;
  readonly error?: unknown;
  readonly contract?: unknown;
  readonly variation?: unknown;
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
export type IWebRpcUuidContext = {
  readonly variation: 'task' | 'message' | 'variation';
  readonly senderId: string;
  readonly targetId?: string;
};
export type IWebRpcUuidConfig = { readonly generate?: (context: IWebRpcUuidContext) => string };
export type IWebRpcProtocolConfig = {
  readonly encode?: (value: unknown) => unknown;
  readonly decode?: (value: unknown) => unknown;
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
export type IWebRpcHooksConfig = {
  readonly listeners?: IWebRpcHook | readonly IWebRpcHook[];
  readonly onHookError?: (error: unknown, event: IWebRpcHookEvent) => void;
};
export type IWebRpcChunkConfig = { readonly chunkSize?: number; readonly maxMessageBytes?: number };
export type IWebRpcConnectContext = {
  readonly senderId: string;
  readonly targetId: string;
  readonly peerId?: string;
  readonly origin?: string;
};
export type IWebRpcConnectConfig = {
  readonly transport: IWebRpcTransport;
  readonly identifier?: (context: IWebRpcConnectContext) => boolean | Promise<boolean>;
};

export type IWebRpcMiddlewareContext = {
  readonly id: string;
  readonly transport: IWebRpcTransport;
  readonly hooks: (event: IWebRpcHookEvent) => void;
};
export type IWebRpcMiddleware = {
  readonly name: string;
  readonly transport?: IWebRpcTransport;
  readonly contract?: IWebRpcContractConfig;
  readonly uuid?: IWebRpcUuidConfig;
  readonly protocol?: IWebRpcProtocolConfig;
  readonly timeout?: IWebRpcTimeoutConfig;
  readonly hooks?: IWebRpcHooksConfig;
  readonly chunk?: IWebRpcChunkConfig;
  readonly connect?: IWebRpcConnectConfig;
  readonly install: (
    context: IWebRpcMiddlewareContext
  ) => void | (() => void) | Promise<void | (() => void)>;
};
export type IWebRpcFactoryConfig<TTargetId extends string = string> = {
  readonly id: string;
  readonly targetIds?: readonly TTargetId[];
  readonly transport?: IWebRpcTransport;
  readonly provider?: Readonly<Record<string, IWebRpcProvider>>;
  readonly middlewares: readonly IWebRpcMiddleware[];
};
export type IWebRpcEndpoint<TTargetId extends string = string> = {
  provide(method: string, provider: IWebRpcProvider): IWebRpcEndpoint<TTargetId>;
  on(event: string, listener: IWebRpcEventListener): () => void;
  send<T>(targetId: TTargetId, method: string, data: unknown, options?: ISendOptions): Promise<T>;
  sendAll<T>(method: string, data: unknown, options?: ISendOptions): Promise<Record<TTargetId, T>>;
  dispatch(targetId: TTargetId, method: string, data: unknown): void;
  dispatchAll(method: string, data: unknown): void;
  ping(targetId: TTargetId): Promise<boolean>;
  pingAll(): Promise<Record<TTargetId, boolean>>;
  readonly hooks?: { on(listener: IWebRpcHook): () => void };
  dispose(): Promise<void>;
};
export type IWebRpcEndpointFactory = <TTargetId extends string = string>(
  config: IWebRpcFactoryConfig<TTargetId>
) => Promise<IWebRpcEndpoint<TTargetId>>;
export type IWebRpcPublicError = IWebRpcError;
