import { RpcCoreErrorText } from './error-text.js'
import { ERROR_SOURCE, RpcCoreErrorCode, type IRpcCoreErrorCode } from './error-code.js'
import { attachErrorIdentity } from '@migaia/utils/error'
export { RpcCoreErrorCode, type IRpcCoreErrorCode }

/** Core-layer `source` stamped onto each locally thrown Rpc error. */
export const RPC_CORE_ERROR_SOURCE = ERROR_SOURCE

export type IRpcCleanupError = { readonly resource: string; readonly error: unknown }
export type IRpcError = {
  readonly source: string
  readonly code: IRpcCoreErrorCode
  readonly cause?: unknown
}
export class RpcError extends Error implements IRpcError {
  readonly source: string
  readonly code: IRpcCoreErrorCode
  readonly cause?: unknown
  readonly cleanupErrors?: readonly IRpcCleanupError[]
  constructor(code: IRpcCoreErrorCode, message: string, cause?: unknown) {
    super(message)
    this.name = 'RpcError'
    this.source = RPC_CORE_ERROR_SOURCE
    this.code = code
    this.cause = cause
  }
}

/**
 * 给已构造的错误对象（`TypeError`/`RangeError` 等）补上 `(source, code)`，不触碰
 * `message`/`name`/`stack`/构造函数带来的其它字段—— 用于入参校验这类必须保持原生类型（调用方按 `instanceof TypeError`
 * 分支）的场景（`docs/contracts/error-codes.md` §2.2）。
 */
export function tagRpcError<E extends Error>(
  error: E,
  code: IRpcCoreErrorCode
): E & Pick<IRpcError, 'source' | 'code'> {
  return attachErrorIdentity(error, { source: RPC_CORE_ERROR_SOURCE, code }) as E &
    Pick<IRpcError, 'source' | 'code'>
}
export class RpcSchemaValidationError extends RpcError {
  readonly data: unknown
  constructor(message: string, data: unknown, cause?: unknown) {
    super(RpcCoreErrorCode.schemaInvalid, message, cause)
    this.name = 'RpcSchemaValidationError'
    this.data = data
  }
}
export class RpcConfigurationError extends RpcError {
  constructor(message: string, cause?: unknown) {
    super(RpcCoreErrorCode.invalidConfig, message, cause)
    this.name = 'RpcConfigurationError'
  }
}
export class RpcConstructionError extends RpcConfigurationError {
  readonly cleanupErrors: readonly IRpcCleanupError[]
  readonly cleanupPromise?: Promise<readonly IRpcCleanupError[]>
  constructor(
    message: string,
    cause: unknown,
    cleanupErrors: readonly IRpcCleanupError[],
    cleanupPromise?: Promise<readonly IRpcCleanupError[]>
  ) {
    super(message, cause)
    this.name = 'RpcConstructionError'
    this.cleanupErrors = cleanupErrors
    this.cleanupPromise = cleanupPromise
  }
}
export class RpcLifecycleError extends RpcError {
  readonly cleanupErrors?: readonly IRpcCleanupError[]
  constructor(message: string, cause?: unknown, cleanupErrors?: readonly IRpcCleanupError[]) {
    super(RpcCoreErrorCode.endpointDisposed, message, cause)
    this.name = 'RpcLifecycleError'
    this.cleanupErrors = cleanupErrors
  }
}
export class RpcSerializationError extends RpcError {
  constructor(message: string, cause?: unknown) {
    super(RpcCoreErrorCode.payloadInvalid, message, cause)
    this.name = 'RpcSerializationError'
  }
}
export class RpcProtocolError extends RpcError {
  constructor(message: string, cause?: unknown) {
    super(RpcCoreErrorCode.protocolInvalid, message, cause)
    this.name = 'RpcProtocolError'
  }
}
export class RpcContractError extends RpcError {
  constructor(message: string, cause?: unknown) {
    super(RpcCoreErrorCode.contractInvalid, message, cause)
    this.name = 'RpcContractError'
  }
}
export class RpcTransportError extends RpcError {
  constructor(message: string, cause?: unknown) {
    super(RpcCoreErrorCode.transport, message, cause)
    this.name = 'RpcTransportError'
  }
}
export class RpcAuthenticationError extends RpcError {
  constructor(message: string, cause?: unknown) {
    super(RpcCoreErrorCode.authenticationFailed, message, cause)
    this.name = 'RpcAuthenticationError'
  }
}
export class RpcChunkError extends RpcError {
  constructor(message: string, cause?: unknown) {
    super(RpcCoreErrorCode.chunkInvalid, message, cause)
    this.name = 'RpcChunkError'
  }
}
export class RpcRemoteError extends Error {
  readonly source: string
  readonly code: string
  readonly data?: unknown
  readonly cause?: unknown
  constructor(code: string, message: string, data?: unknown, cause?: unknown) {
    super(message)
    this.name = 'RpcRemoteError'
    this.source = RPC_CORE_ERROR_SOURCE
    this.code = code
    this.data = data
    this.cause = cause
  }
}
export class RpcAbortError extends RpcError {
  readonly cleanupPromise?: Promise<readonly IRpcCleanupError[]>
  constructor(
    message = RpcCoreErrorText.webRPCRequestCancelled,
    cleanupPromise?: Promise<readonly IRpcCleanupError[]>,
    cause?: unknown
  ) {
    super(RpcCoreErrorCode.cancelled, message, cause)
    // 按 web-rpc.sdd.md §5.5：name 用标准 `AbortError`，供调用方与跨 realm 复原按 `name` 判定取消语义。
    this.name = 'AbortError'
    this.cleanupPromise = cleanupPromise
  }
}
export class RpcTimeoutError extends RpcError {
  readonly cleanupPromise?: Promise<readonly IRpcCleanupError[]>
  constructor(
    message = RpcCoreErrorText.webRPCRequestDeadlineExceeded,
    cleanupPromise?: Promise<readonly IRpcCleanupError[]>
  ) {
    super(RpcCoreErrorCode.deadlineExceeded, message)
    // 按 web-rpc.sdd.md §5.5：name 用标准 `TimeoutError`，供调用方与跨 realm 复原按 `name` 判定超时语义。
    this.name = 'TimeoutError'
    this.cleanupPromise = cleanupPromise
  }
}
export const isRpcError = (value: unknown): value is IRpcError =>
  typeof value === 'object' && value !== null && typeof safeRead(value, 'code') === 'string'
import { safeRead } from './internal/safe-value.js'
