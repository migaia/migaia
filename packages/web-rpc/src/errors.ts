export const WebRpcErrorCode = {
  middlewareDuplicated: 'MIDDLEWARE_DUPLICATED',
  middlewareMissing: 'MIDDLEWARE_MISSING',
  invalidConfig: 'INVALID_CONFIG',
  providerDuplicated: 'PROVIDER_DUPLICATED',
  uuidUnavailable: 'UUID_UNAVAILABLE',
  uuidInvalid: 'UUID_INVALID',
  uuidConflict: 'UUID_CONFLICT',
  protocolInvalid: 'PROTOCOL_INVALID',
  protocolUnsupported: 'PROTOCOL_UNSUPPORTED',
  protocolDecryptFailed: 'PROTOCOL_DECRYPT_FAILED',
  contractInvalid: 'CONTRACT_INVALID',
  contractVersionUnsupported: 'CONTRACT_VERSION_UNSUPPORTED',
  payloadInvalid: 'PAYLOAD_INVALID',
  payloadTooLarge: 'PAYLOAD_TOO_LARGE',
  methodNotFound: 'METHOD_NOT_FOUND',
  providerNotSettled: 'PROVIDER_NOT_SETTLED',
  internal: 'INTERNAL',
  targetUnknown: 'TARGET_UNKNOWN',
  targetNotIdentifiable: 'TARGET_NOT_IDENTIFIABLE',
  endpointDisposed: 'ENDPOINT_DISPOSED',
  cancelled: 'CANCELLED',
  deadlineExceeded: 'DEADLINE_EXCEEDED',
  contextExpired: 'PROVIDER_CONTEXT_EXPIRED',
  transport: 'TRANSPORT',
  authenticationFailed: 'AUTHENTICATION_FAILED',
  unauthenticated: 'UNAUTHENTICATED',
  forbidden: 'FORBIDDEN',
  unavailable: 'UNAVAILABLE',
  schemaInvalid: 'SCHEMA_INVALID',
  capabilityConflict: 'CAPABILITY_CONFLICT',
  overloaded: 'OVERLOADED',
  chunkInvalid: 'CHUNK_INVALID',
  chunkTooLarge: 'CHUNK_TOO_LARGE',
  chunkCapacityExceeded: 'CHUNK_CAPACITY_EXCEEDED',
  chunkReceiveTimeout: 'CHUNK_RECEIVE_TIMEOUT',
  chunkAckTimeout: 'CHUNK_ACK_TIMEOUT'
} as const;
export type IWebRpcErrorCode = (typeof WebRpcErrorCode)[keyof typeof WebRpcErrorCode];
export type IWebRpcCleanupError = { readonly resource: string; readonly error: unknown };
export type IWebRpcError = { readonly code: string; readonly cause?: unknown };
export class WebRpcError extends Error implements IWebRpcError {
  readonly code: string;
  readonly cause?: unknown;
  readonly cleanupErrors?: readonly IWebRpcCleanupError[];
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
export class WebRpcRemoteError extends WebRpcError {
  constructor(code: string, message: string, data?: unknown, cause?: unknown) {
    super(code, message, cause);
    this.name = 'WebRpcRemoteError';
    this.data = data;
  }
  readonly data?: unknown;
}
export class WebRpcAbortError extends WebRpcError {
  readonly cleanupPromise?: Promise<readonly IWebRpcCleanupError[]>;
  constructor(
    message = 'Web RPC request cancelled',
    cleanupPromise?: Promise<readonly IWebRpcCleanupError[]>
  ) {
    super(WebRpcErrorCode.cancelled, message);
    this.name = 'WebRpcAbortError';
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
    this.name = 'WebRpcTimeoutError';
    this.cleanupPromise = cleanupPromise;
  }
}
export const isWebRpcError = (value: unknown): value is IWebRpcError =>
  typeof value === 'object' && value !== null && typeof safeRead(value, 'code') === 'string';
import { safeRead } from './internal/safe-value';
