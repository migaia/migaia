import { WebRpcErrorCode, type IWebRpcErrorCode } from './error-code.js';
export { WebRpcErrorCode, type IWebRpcErrorCode };

/** `source` value stamped onto every error this package throws locally. */
export const WEBRPC_SOURCE = '@migaia/web-rpc';

export type IWebRpcCleanupError = { readonly resource: string; readonly error: unknown };
export type IWebRpcError = {
  readonly source: string;
  readonly code: IWebRpcErrorCode;
  readonly cause?: unknown;
};
export class WebRpcError extends Error implements IWebRpcError {
  readonly source: string;
  readonly code: IWebRpcErrorCode;
  readonly cause?: unknown;
  readonly cleanupErrors?: readonly IWebRpcCleanupError[];
  constructor(code: IWebRpcErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = 'WebRpcError';
    this.source = WEBRPC_SOURCE;
    this.code = code;
    this.cause = cause;
  }
}

/**
 * 给已构造的错误对象（`TypeError`/`RangeError` 等）补上 `(source, code)`，不触碰
 * `message`/`name`/`stack`/构造函数带来的其它字段—— 用于入参校验这类必须保持原生类型（调用方按 `instanceof TypeError`
 * 分支）的场景（`docs/contracts/error-codes.md` §2.2）。
 */
export function tagWebRpcError<E extends Error>(
  error: E,
  code: IWebRpcErrorCode
): E & Pick<IWebRpcError, 'source' | 'code'> {
  Object.defineProperty(error, 'source', { value: WEBRPC_SOURCE, enumerable: true });
  Object.defineProperty(error, 'code', { value: code, enumerable: true });
  return error as E & Pick<IWebRpcError, 'source' | 'code'>;
}
export class WebRpcSchemaValidationError extends WebRpcError {
  readonly data: unknown;
  constructor(message: string, data: unknown, cause?: unknown) {
    super(WebRpcErrorCode.schemaInvalid, message, cause);
    this.name = 'WebRpcSchemaValidationError';
    this.data = data;
  }
}
export class WebRpcConfigurationError extends WebRpcError {
  constructor(message: string, cause?: unknown) {
    super(WebRpcErrorCode.invalidConfig, message, cause);
    this.name = 'WebRpcConfigurationError';
  }
}
export class WebRpcConstructionError extends WebRpcConfigurationError {
  readonly cleanupErrors: readonly IWebRpcCleanupError[];
  readonly cleanupPromise?: Promise<readonly IWebRpcCleanupError[]>;
  constructor(
    message: string,
    cause: unknown,
    cleanupErrors: readonly IWebRpcCleanupError[],
    cleanupPromise?: Promise<readonly IWebRpcCleanupError[]>
  ) {
    super(message, cause);
    this.name = 'WebRpcConstructionError';
    this.cleanupErrors = cleanupErrors;
    this.cleanupPromise = cleanupPromise;
  }
}
export class WebRpcLifecycleError extends WebRpcError {
  readonly cleanupErrors?: readonly IWebRpcCleanupError[];
  constructor(message: string, cause?: unknown, cleanupErrors?: readonly IWebRpcCleanupError[]) {
    super(WebRpcErrorCode.endpointDisposed, message, cause);
    this.name = 'WebRpcLifecycleError';
    this.cleanupErrors = cleanupErrors;
  }
}
export class WebRpcSerializationError extends WebRpcError {
  constructor(message: string, cause?: unknown) {
    super(WebRpcErrorCode.payloadInvalid, message, cause);
    this.name = 'WebRpcSerializationError';
  }
}
export class WebRpcProtocolError extends WebRpcError {
  constructor(message: string, cause?: unknown) {
    super(WebRpcErrorCode.protocolInvalid, message, cause);
    this.name = 'WebRpcProtocolError';
  }
}
export class WebRpcContractError extends WebRpcError {
  constructor(message: string, cause?: unknown) {
    super(WebRpcErrorCode.contractInvalid, message, cause);
    this.name = 'WebRpcContractError';
  }
}
export class WebRpcTransportError extends WebRpcError {
  constructor(message: string, cause?: unknown) {
    super(WebRpcErrorCode.transport, message, cause);
    this.name = 'WebRpcTransportError';
  }
}
export class WebRpcAuthenticationError extends WebRpcError {
  constructor(message: string, cause?: unknown) {
    super(WebRpcErrorCode.authenticationFailed, message, cause);
    this.name = 'WebRpcAuthenticationError';
  }
}
export class WebRpcChunkError extends WebRpcError {
  constructor(message: string, cause?: unknown) {
    super(WebRpcErrorCode.chunkInvalid, message, cause);
    this.name = 'WebRpcChunkError';
  }
}
export class WebRpcRemoteError extends Error {
  readonly source: string;
  readonly code: string;
  readonly data?: unknown;
  readonly cause?: unknown;
  constructor(code: string, message: string, data?: unknown, cause?: unknown) {
    super(message);
    this.name = 'WebRpcRemoteError';
    this.source = WEBRPC_SOURCE;
    this.code = code;
    this.data = data;
    this.cause = cause;
  }
}
export class WebRpcAbortError extends WebRpcError {
  readonly cleanupPromise?: Promise<readonly IWebRpcCleanupError[]>;
  constructor(
    message = 'Web RPC request cancelled',
    cleanupPromise?: Promise<readonly IWebRpcCleanupError[]>
  ) {
    super(WebRpcErrorCode.cancelled, message);
    // 按 web-rpc.sdd.md §5.5：name 用标准 `AbortError`，供调用方与跨 realm 复原按 `name` 判定取消语义。
    this.name = 'AbortError';
    this.cleanupPromise = cleanupPromise;
  }
}
export class WebRpcTimeoutError extends WebRpcError {
  readonly cleanupPromise?: Promise<readonly IWebRpcCleanupError[]>;
  constructor(
    message = 'Web RPC request deadline exceeded',
    cleanupPromise?: Promise<readonly IWebRpcCleanupError[]>
  ) {
    super(WebRpcErrorCode.deadlineExceeded, message);
    // 按 web-rpc.sdd.md §5.5：name 用标准 `TimeoutError`，供调用方与跨 realm 复原按 `name` 判定超时语义。
    this.name = 'TimeoutError';
    this.cleanupPromise = cleanupPromise;
  }
}
export const isWebRpcError = (value: unknown): value is IWebRpcError =>
  typeof value === 'object' && value !== null && typeof safeRead(value, 'code') === 'string';
import { safeRead } from './internal/safe-value.js';
