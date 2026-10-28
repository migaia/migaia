/** Native RPC diagnostics and pure classification; mutable local control provenance belongs to host. */
import { RpcErrorFamily } from './family.ts'
import { RpcCoreErrorText } from './text.ts'
import { safeRead } from './property.ts'
import {
  RPC_ENDPOINT_ERROR_SOURCE as RPC_CORE_ERROR_SOURCE,
  RpcCoreErrorCode,
  type IRpcCoreErrorCode
} from '../error-code.ts'
import {
  attachErrorIdentity,
  attachSecondaryErrors,
  isNativeErrorValue,
  toError,
  tryReadProperty
} from '@migaia/utils/error'
export { RpcCoreErrorCode, type IRpcCoreErrorCode, RPC_CORE_ERROR_SOURCE }

/** One failed resource release; the original value remains available for diagnosis. */
export type IRpcCleanupError = {
  /** Resource whose release failed. */
  readonly resource: string
  /** Original release failure. */
  readonly error: unknown
}
/** Public diagnostic identity; structural matching does not grant local operation authority. */
export type IRpcError = {
  readonly source: string
  readonly code: IRpcCoreErrorCode
  readonly cause?: unknown
}
/** Core failure diagnostics carrying the package source, semantic code and original cause. */
export class RpcError extends Error implements IRpcError {
  /** Canonical package diagnostic source. */
  readonly source: string
  /** Semantic diagnostic code; received remote codes remain unrestricted strings. */
  readonly code: IRpcCoreErrorCode
  /** Original failure, when one caused this diagnostic. */
  readonly cause?: unknown
  /** Original resource release failures retained alongside the primary failure. */
  readonly cleanupErrors?: readonly IRpcCleanupError[]
  /** Construct diagnostics without minting an owner-created operation identity. */
  constructor(code: IRpcCoreErrorCode, message: string, cause?: unknown) {
    super(message)
    this.name = RpcErrorFamily.rpc
    this.source = RPC_CORE_ERROR_SOURCE
    this.code = code
    this.cause = cause
  }
}

/**
 * Attaches `(source, code)` to an existing error such as `TypeError` or `RangeError`. Preserves
 * `message`, `name`, `stack`, and other fields supplied by the constructor. Use it for argument
 * validation that must preserve the native error type for `instanceof TypeError` checks. Diagnostic
 * tagging alone grants no Core control identity.
 */
export function tagRpcError<E extends Error>(
  error: E,
  code: IRpcCoreErrorCode
): E & Pick<IRpcError, 'source' | 'code'> {
  /** Tagging diagnostics cannot grant control identity through public listener helpers. */
  return attachErrorIdentity(error, { source: RPC_CORE_ERROR_SOURCE, code }) as E &
    Pick<IRpcError, 'source' | 'code'>
}

/** Read the existing diagnostic identity once, in the same source-then-code order for every error. */
function hasSemanticIdentity(error: object): boolean {
  /** A complete semantic identity remains owned by the package that supplied it. */
  const source = tryReadProperty(error as { source?: unknown }, 'source')
  /** Numeric native DOM codes alone do not constitute a semantic package identity. */
  const existingCode = tryReadProperty(error as { code?: unknown }, 'code')
  return (
    !source.threw &&
    !existingCode.threw &&
    typeof source.value === 'string' &&
    source.value.length > 0 &&
    typeof existingCode.value === 'string' &&
    existingCode.value.length > 0
  )
}

/** Classify one boundary failure without replacing a native error or complete coded error-like. */
export function identifyRpcBoundaryFailure(
  error: unknown,
  code: IRpcCoreErrorCode,
  message: string
): Error {
  if (isNativeErrorValue(error)) {
    if (hasSemanticIdentity(error)) return error
    try {
      return tagRpcError(error, code)
    } catch (attachmentError) {
      return attachSecondaryErrors(new RpcError(code, message, error), [attachmentError]) as Error
    }
  }
  if (error !== null && typeof error === 'object' && hasSemanticIdentity(error)) {
    /** Utils owns complete error-like detection and contains hostile presentation getters. */
    const errorLike = toError(error)
    if (errorLike === error) return errorLike
  }
  return new RpcError(code, message, error)
}
/** Schema rejection with validation detail in data. */
export class RpcSchemaValidationError extends RpcError {
  /** Failure-specific validation or remote application detail. */
  readonly data: unknown
  /** Construct diagnostics without minting an owner-created operation identity. */
  constructor(message: string, data: unknown, cause?: unknown) {
    super(RpcCoreErrorCode.schemaInvalid, message, cause)
    this.name = RpcErrorFamily.schema
    this.data = data
  }
}
/** Invalid endpoint or middleware configuration. */
export class RpcConfigurationError extends RpcError {
  /** Construct diagnostics without minting an owner-created operation identity. */
  constructor(message: string, cause?: unknown) {
    super(RpcCoreErrorCode.invalidConfig, message, cause)
    this.name = RpcErrorFamily.configuration
  }
}
/** Construction failure retaining rollback errors and any outstanding cleanup Promise. */
export class RpcConstructionError extends RpcConfigurationError {
  /** Original resource release failures retained alongside the primary failure. */
  readonly cleanupErrors: readonly IRpcCleanupError[]
  /** Pending rollback settlement; await it to observe later resource release results. */
  readonly cleanupPromise?: Promise<readonly IRpcCleanupError[]>
  /** Construct diagnostics without minting an owner-created operation identity. */
  constructor(
    message: string,
    cause: unknown,
    cleanupErrors: readonly IRpcCleanupError[],
    cleanupPromise?: Promise<readonly IRpcCleanupError[]>
  ) {
    super(message, cause)
    this.name = RpcErrorFamily.construction
    this.cleanupErrors = cleanupErrors
    this.cleanupPromise = cleanupPromise
  }
}
/** Endpoint retirement failure, including secondary resource release diagnostics. */
export class RpcLifecycleError extends RpcError {
  /** Core cleanup translation exposes secondary failures through the standard error graph. */
  declare readonly errors?: readonly unknown[]
  /** Original resource release failures retained alongside the primary failure. */
  readonly cleanupErrors?: readonly IRpcCleanupError[]
  /** Construct diagnostics without minting an owner-created operation identity. */
  constructor(message: string, cause?: unknown, cleanupErrors?: readonly IRpcCleanupError[]) {
    super(RpcCoreErrorCode.endpointDisposed, message, cause)
    this.name = RpcErrorFamily.lifecycle
    this.cleanupErrors = cleanupErrors
  }
}
/** Payload encoding or portable-value failure. */
export class RpcSerializationError extends RpcError {
  /** Construct diagnostics without minting an owner-created operation identity. */
  constructor(message: string, cause?: unknown) {
    super(RpcCoreErrorCode.payloadInvalid, message, cause)
    this.name = RpcErrorFamily.serialization
  }
}
/** Invalid protocol or envelope interpretation. */
export class RpcProtocolError extends RpcError {
  /** Construct diagnostics without minting an owner-created operation identity. */
  constructor(message: string, cause?: unknown) {
    super(RpcCoreErrorCode.protocolInvalid, message, cause)
    this.name = RpcErrorFamily.protocol
  }
}
/** Rejected application contract or correlation. */
export class RpcContractError extends RpcError {
  /** Construct diagnostics without minting an owner-created operation identity. */
  constructor(message: string, cause?: unknown) {
    super(RpcCoreErrorCode.contractInvalid, message, cause)
    this.name = RpcErrorFamily.contract
  }
}
/** Physical transport failure; the diagnostic alone does not establish whether remote work executed. */
export class RpcTransportError extends RpcError {
  /** Construct diagnostics without minting an owner-created operation identity. */
  constructor(message: string, cause?: unknown) {
    super(RpcCoreErrorCode.transport, message, cause)
    this.name = RpcErrorFamily.transport
  }
}
/** Per-frame protection or verification failure. */
export class RpcAuthenticationError extends RpcError {
  /** Construct diagnostics without minting an owner-created operation identity. */
  constructor(message: string, cause?: unknown) {
    super(RpcCoreErrorCode.authenticationFailed, message, cause)
    this.name = RpcErrorFamily.authentication
  }
}
/** Rejected chunk or reassembly input. */
export class RpcChunkError extends RpcError {
  /** Construct diagnostics without minting an owner-created operation identity. */
  constructor(message: string, cause?: unknown) {
    super(RpcCoreErrorCode.chunkInvalid, message, cause)
    this.name = RpcErrorFamily.chunk
  }
}
/**
 * Received application failure; its code belongs to the remote domain and grants no local retry
 * authority.
 */
export class RpcRemoteError extends Error {
  /** Canonical package diagnostic source. */
  readonly source: string
  /** Semantic diagnostic code; received remote codes remain unrestricted strings. */
  readonly code: string
  /** Failure-specific validation or remote application detail. */
  readonly data?: unknown
  /** Original failure, when one caused this diagnostic. */
  readonly cause?: unknown
  /** Construct diagnostics without minting an owner-created operation identity. */
  constructor(code: string, message: string, data?: unknown, cause?: unknown) {
    super(message)
    this.name = RpcErrorFamily.remote
    this.source = RPC_CORE_ERROR_SOURCE
    this.code = code
    this.data = data
    this.cause = cause
  }
}
/** Local cancellation with standard AbortError name and optional remaining construction cleanup. */
export class RpcAbortError extends RpcError {
  /** Pending rollback settlement; await it to observe later resource release results. */
  readonly cleanupPromise?: Promise<readonly IRpcCleanupError[]>
  /** Construct diagnostics without minting an owner-created operation identity. */
  constructor(
    message = RpcCoreErrorText.webRPCRequestCancelled,
    cleanupPromise?: Promise<readonly IRpcCleanupError[]>,
    cause?: unknown
  ) {
    super(RpcCoreErrorCode.cancelled, message, cause)
    // 按：name 用标准 `AbortError`，供调用方与跨 realm 复原按 `name` 判定取消语义。
    this.name = RpcErrorFamily.abort
    this.cleanupPromise = cleanupPromise
  }
}
/**
 * Local deadline expiry with standard TimeoutError name and optional remaining construction
 * cleanup.
 */
export class RpcTimeoutError extends RpcError {
  /** Pending rollback settlement; await it to observe later resource release results. */
  readonly cleanupPromise?: Promise<readonly IRpcCleanupError[]>
  /** Construct diagnostics without minting an owner-created operation identity. */
  constructor(
    message = RpcCoreErrorText.webRPCRequestDeadlineExceeded,
    cleanupPromise?: Promise<readonly IRpcCleanupError[]>
  ) {
    super(RpcCoreErrorCode.deadlineExceeded, message)
    // 按：name 用标准 `TimeoutError`，供调用方与跨 realm 复原按 `name` 判定超时语义。
    this.name = RpcErrorFamily.timeout
    this.cleanupPromise = cleanupPromise
  }
}
/**
 * Recognize an object with a readable string code; this broad diagnostic guard does not
 * authenticate source or local origin.
 */
export const isRpcError = (value: unknown): value is IRpcError =>
  typeof value === 'object' && value !== null && typeof safeRead(value, 'code') === 'string'

/** Known Core codes constrain structural family classification without granting operation rights. */
const coreErrorCodes = new Set<string>(Object.values(RpcCoreErrorCode))
/** The remote family has its own code domain and is not a RpcError subclass. */
const coreErrorFamilies = new Set<string>(
  Object.values(RpcErrorFamily).filter((name) => name !== RpcErrorFamily.remote)
)

/** Recognize the original native class or a coded equivalent received from another realm. */
export function isRpcErrorInstance(value: unknown): value is RpcError {
  if (typeof value !== 'object' || value === null) return false
  /** Reading hostile diagnostics retains the existing safe getter boundary. */
  const code = safeRead(value, 'code')
  /** A standard family name alone cannot make an arbitrary error a Core failure. */
  const name = safeRead(value, 'name')
  return (
    safeRead(value, 'source') === RPC_CORE_ERROR_SOURCE &&
    typeof code === 'string' &&
    coreErrorCodes.has(code) &&
    typeof name === 'string' &&
    coreErrorFamilies.has(name)
  )
}

/** Classify a received remote failure while retaining its unrestricted remote code domain. */
export function isRpcRemoteError(value: unknown): value is RpcRemoteError {
  return (
    typeof value === 'object' &&
    value !== null &&
    safeRead(value, 'source') === RPC_CORE_ERROR_SOURCE &&
    safeRead(value, 'name') === RpcErrorFamily.remote &&
    typeof safeRead(value, 'code') === 'string'
  )
}

/** Recognize a genuine native deadline error or its exact coded cross-realm equivalent. */
export function isRpcTimeoutError(value: unknown): value is RpcTimeoutError {
  return (
    typeof value === 'object' &&
    value !== null &&
    safeRead(value, 'source') === RPC_CORE_ERROR_SOURCE &&
    safeRead(value, 'name') === RpcErrorFamily.timeout &&
    safeRead(value, 'code') === RpcCoreErrorCode.deadlineExceeded
  )
}
