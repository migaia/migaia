export const WebRpcErrorCode = {
  invalidConfig: 'INVALID_CONFIG',
  providerDuplicated: 'PROVIDER_DUPLICATED',
  providerNotSettled: 'PROVIDER_NOT_SETTLED',
  internal: 'INTERNAL',
  targetUnknown: 'TARGET_UNKNOWN',
  endpointDisposed: 'ENDPOINT_DISPOSED',
  cancelled: 'CANCELLED',
  deadlineExceeded: 'DEADLINE_EXCEEDED',
  contextExpired: 'PROVIDER_CONTEXT_EXPIRED',
  transport: 'TRANSPORT',
  schemaInvalid: 'SCHEMA_INVALID'
} as const;
export type IWebRpcErrorCode = (typeof WebRpcErrorCode)[keyof typeof WebRpcErrorCode];
export type IWebRpcError = { readonly code: string; readonly cause?: unknown };
export class WebRpcError extends Error implements IWebRpcError {
  readonly code: string;
  readonly cause?: unknown;
  constructor(code: string, message: string, cause?: unknown) {
    super(message);
    this.name = 'WebRpcError';
    this.code = code;
    this.cause = cause;
  }
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
export class WebRpcLifecycleError extends WebRpcError {
  constructor(message: string, cause?: unknown) {
    super(WebRpcErrorCode.endpointDisposed, message, cause);
    this.name = 'WebRpcLifecycleError';
  }
}
export class WebRpcSerializationError extends WebRpcError {
  constructor(message: string, cause?: unknown) {
    super(WebRpcErrorCode.transport, message, cause);
    this.name = 'WebRpcSerializationError';
  }
}
export class WebRpcProtocolError extends WebRpcError {
  constructor(message: string, cause?: unknown) {
    super(WebRpcErrorCode.internal, message, cause);
    this.name = 'WebRpcProtocolError';
  }
}
export class WebRpcContractError extends WebRpcError {
  constructor(message: string, cause?: unknown) {
    super(WebRpcErrorCode.internal, message, cause);
    this.name = 'WebRpcContractError';
  }
}
export class WebRpcTransportError extends WebRpcError {
  constructor(message: string, cause?: unknown) {
    super(WebRpcErrorCode.transport, message, cause);
    this.name = 'WebRpcTransportError';
  }
}
export class WebRpcChunkError extends WebRpcError {
  constructor(message: string, cause?: unknown) {
    super(WebRpcErrorCode.transport, message, cause);
    this.name = 'WebRpcChunkError';
  }
}
export class WebRpcRemoteError extends WebRpcError {
  constructor(code: string, message: string, data?: unknown, cause?: unknown) {
    super(code, message, cause);
    this.name = 'WebRpcRemoteError';
    this.data = data;
  }
  readonly data?: unknown;
}
export class WebRpcAbortError extends WebRpcError {
  constructor(message = 'Web RPC request cancelled') {
    super(WebRpcErrorCode.cancelled, message);
    this.name = 'WebRpcAbortError';
  }
}
export class WebRpcTimeoutError extends WebRpcError {
  constructor(message = 'Web RPC request deadline exceeded') {
    super(WebRpcErrorCode.deadlineExceeded, message);
    this.name = 'WebRpcTimeoutError';
  }
}
export const isWebRpcError = (value: unknown): value is IWebRpcError =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as { code?: unknown }).code === 'string';
