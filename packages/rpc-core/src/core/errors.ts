import { RpcErrorFamily } from './error-family.js'
import { RpcCoreErrorText } from './error-text.js'
import { ERROR_SOURCE, RpcCoreErrorCode, type IRpcCoreErrorCode } from './error-code.js'
import {
  attachErrorIdentity,
  attachSecondaryErrors,
  isNativeErrorValue,
  tryReadProperty
} from '@migaia/utils/error'
import { safeRead } from './internal/safe-value.js'
export { RpcCoreErrorCode, type IRpcCoreErrorCode }

/** Core-layer `source` stamped onto each locally thrown Rpc error. */
export const RPC_CORE_ERROR_SOURCE = ERROR_SOURCE

/** Only owner factories retain the original code and native family for live control decisions. */
const localErrors = new WeakMap<Error, Readonly<{ code: string; family: Function }>>()

/** Read the original minted code without consulting mutable public diagnostic properties. */
export function localRpcErrorCode(value: unknown): string | undefined {
  /** A Core-created remote wrapper still carries peer-selected codes, never local control rights. */
  const identity =
    (typeof value === 'object' && value !== null) || typeof value === 'function'
      ? localErrors.get(value as Error)
      : undefined
  return identity?.family === RpcRemoteError ? undefined : identity?.code
}

/** Class construction and prototype imitation alone cannot obtain an owner's decision identity. */
export function isLocalRpcError<T extends Error>(
  value: unknown,
  family: abstract new (...args: never[]) => T
): value is T {
  /** Mutable public fields and prototypes cannot alter the family selected by the owner factory. */
  const identity =
    (typeof value === 'object' && value !== null) || typeof value === 'function'
      ? localErrors.get(value as Error)
      : undefined
  return (
    identity !== undefined &&
    (identity.family === family ||
      ((family as Function) === RpcError &&
        identity.family !== RpcRemoteError &&
        identity.family !== Error) ||
      ((family as Function) === RpcConfigurationError && identity.family === RpcConstructionError))
  )
}

/** The original owner records a newly constructed error; callers receive only its diagnostics. */
function mintLocalRpcError<E extends Error>(error: E, code: string, family: Function): E {
  localErrors.set(error, { code, family })
  return error
}

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
    this.name = RpcErrorFamily.rpc
    this.source = RPC_CORE_ERROR_SOURCE
    this.code = code
    this.cause = cause
  }
}

/**
 * Attaches `(source, code)` to an existing error such as `TypeError` or `RangeError`. Preserves
 * `message`, `name`, `stack`, and other fields supplied by the constructor. Use it for argument
 * validation that must preserve the native error type for `instanceof TypeError` checks. See
 * `docs/contracts/error-codes.md` §2.2.
 */
export function tagRpcError<E extends Error>(
  error: E,
  code: IRpcCoreErrorCode
): E & Pick<IRpcError, 'source' | 'code'> {
  /** Tagging diagnostics cannot grant control identity through public listener helpers. */
  return attachErrorIdentity(error, { source: RPC_CORE_ERROR_SOURCE, code }) as E &
    Pick<IRpcError, 'source' | 'code'>
}

/** Classify one boundary failure without replacing a mutable native error or a foreign identity. */
export function identifyRpcBoundaryFailure(
  error: unknown,
  code: IRpcCoreErrorCode,
  message: string
): Error {
  if (isNativeErrorValue(error)) {
    /** A complete semantic identity remains owned by the package that supplied it. */
    const source = tryReadProperty(error as { source?: unknown }, 'source')
    /** Numeric native DOM codes alone do not constitute a semantic package identity. */
    const existingCode = tryReadProperty(error as { code?: unknown }, 'code')
    if (
      !source.threw &&
      !existingCode.threw &&
      typeof source.value === 'string' &&
      source.value.length > 0 &&
      typeof existingCode.value === 'string' &&
      existingCode.value.length > 0
    )
      return error
    try {
      return tagRpcError(error, code)
    } catch (attachmentError) {
      return attachSecondaryErrors(new RpcError(code, message, error), [attachmentError]) as Error
    }
  }
  return new RpcError(code, message, error)
}
export class RpcSchemaValidationError extends RpcError {
  readonly data: unknown
  constructor(message: string, data: unknown, cause?: unknown) {
    super(RpcCoreErrorCode.schemaInvalid, message, cause)
    this.name = RpcErrorFamily.schema
    this.data = data
  }
}
export class RpcConfigurationError extends RpcError {
  constructor(message: string, cause?: unknown) {
    super(RpcCoreErrorCode.invalidConfig, message, cause)
    this.name = RpcErrorFamily.configuration
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
    this.name = RpcErrorFamily.construction
    this.cleanupErrors = cleanupErrors
    this.cleanupPromise = cleanupPromise
  }
}
export class RpcLifecycleError extends RpcError {
  /** Core cleanup translation exposes secondary failures through the standard error graph. */
  declare readonly errors?: readonly unknown[]
  readonly cleanupErrors?: readonly IRpcCleanupError[]
  constructor(message: string, cause?: unknown, cleanupErrors?: readonly IRpcCleanupError[]) {
    super(RpcCoreErrorCode.endpointDisposed, message, cause)
    this.name = RpcErrorFamily.lifecycle
    this.cleanupErrors = cleanupErrors
  }
}
export class RpcSerializationError extends RpcError {
  constructor(message: string, cause?: unknown) {
    super(RpcCoreErrorCode.payloadInvalid, message, cause)
    this.name = RpcErrorFamily.serialization
  }
}
export class RpcProtocolError extends RpcError {
  constructor(message: string, cause?: unknown) {
    super(RpcCoreErrorCode.protocolInvalid, message, cause)
    this.name = RpcErrorFamily.protocol
  }
}
export class RpcContractError extends RpcError {
  constructor(message: string, cause?: unknown) {
    super(RpcCoreErrorCode.contractInvalid, message, cause)
    this.name = RpcErrorFamily.contract
  }
}
export class RpcTransportError extends RpcError {
  constructor(message: string, cause?: unknown) {
    super(RpcCoreErrorCode.transport, message, cause)
    this.name = RpcErrorFamily.transport
  }
}
export class RpcAuthenticationError extends RpcError {
  constructor(message: string, cause?: unknown) {
    super(RpcCoreErrorCode.authenticationFailed, message, cause)
    this.name = RpcErrorFamily.authentication
  }
}
export class RpcChunkError extends RpcError {
  constructor(message: string, cause?: unknown) {
    super(RpcCoreErrorCode.chunkInvalid, message, cause)
    this.name = RpcErrorFamily.chunk
  }
}
export class RpcRemoteError extends Error {
  readonly source: string
  readonly code: string
  readonly data?: unknown
  readonly cause?: unknown
  constructor(code: string, message: string, data?: unknown, cause?: unknown) {
    super(message)
    this.name = RpcErrorFamily.remote
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
    this.name = RpcErrorFamily.abort
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
    this.name = RpcErrorFamily.timeout
    this.cleanupPromise = cleanupPromise
  }
}
/** Owner-only construction preserves the native RpcError instance and records its original code. */
export function createRpcError(...args: ConstructorParameters<typeof RpcError>): RpcError {
  /** The selected owner class supplies the immutable decision family. */
  const error = new RpcError(...args)
  return mintLocalRpcError(error, error.code, RpcError)
}

/**
 * Owner-only construction preserves the native RpcSchemaValidationError instance and records its
 * original code.
 */
export function createRpcSchemaValidationError(
  ...args: ConstructorParameters<typeof RpcSchemaValidationError>
): RpcSchemaValidationError {
  /** The selected owner class supplies the immutable decision family. */
  const error = new RpcSchemaValidationError(...args)
  return mintLocalRpcError(error, error.code, RpcSchemaValidationError)
}

/**
 * Owner-only construction preserves the native RpcConfigurationError instance and records its
 * original code.
 */
export function createRpcConfigurationError(
  ...args: ConstructorParameters<typeof RpcConfigurationError>
): RpcConfigurationError {
  /** The selected owner class supplies the immutable decision family. */
  const error = new RpcConfigurationError(...args)
  return mintLocalRpcError(error, error.code, RpcConfigurationError)
}

/**
 * Owner-only construction preserves the native RpcConstructionError instance and records its
 * original code.
 */
export function createRpcConstructionError(
  ...args: ConstructorParameters<typeof RpcConstructionError>
): RpcConstructionError {
  /** The selected owner class supplies the immutable decision family. */
  const error = new RpcConstructionError(...args)
  return mintLocalRpcError(error, error.code, RpcConstructionError)
}

/**
 * Owner-only construction preserves the native RpcLifecycleError instance and records its original
 * code.
 */
export function createRpcLifecycleError(
  ...args: ConstructorParameters<typeof RpcLifecycleError>
): RpcLifecycleError {
  /** The selected owner class supplies the immutable decision family. */
  const error = new RpcLifecycleError(...args)
  return mintLocalRpcError(error, error.code, RpcLifecycleError)
}

/**
 * Owner-only construction preserves the native RpcSerializationError instance and records its
 * original code.
 */
export function createRpcSerializationError(
  ...args: ConstructorParameters<typeof RpcSerializationError>
): RpcSerializationError {
  /** The selected owner class supplies the immutable decision family. */
  const error = new RpcSerializationError(...args)
  return mintLocalRpcError(error, error.code, RpcSerializationError)
}

/**
 * Owner-only construction preserves the native RpcProtocolError instance and records its original
 * code.
 */
export function createRpcProtocolError(
  ...args: ConstructorParameters<typeof RpcProtocolError>
): RpcProtocolError {
  /** The selected owner class supplies the immutable decision family. */
  const error = new RpcProtocolError(...args)
  return mintLocalRpcError(error, error.code, RpcProtocolError)
}

/**
 * Owner-only construction preserves the native RpcContractError instance and records its original
 * code.
 */
export function createRpcContractError(
  ...args: ConstructorParameters<typeof RpcContractError>
): RpcContractError {
  /** The selected owner class supplies the immutable decision family. */
  const error = new RpcContractError(...args)
  return mintLocalRpcError(error, error.code, RpcContractError)
}

/**
 * Owner-only construction preserves the native RpcTransportError instance and records its original
 * code.
 */
export function createRpcTransportError(
  ...args: ConstructorParameters<typeof RpcTransportError>
): RpcTransportError {
  /** The selected owner class supplies the immutable decision family. */
  const error = new RpcTransportError(...args)
  return mintLocalRpcError(error, error.code, RpcTransportError)
}

/**
 * Owner-only construction preserves the native RpcAuthenticationError instance and records its
 * original code.
 */
export function createRpcAuthenticationError(
  ...args: ConstructorParameters<typeof RpcAuthenticationError>
): RpcAuthenticationError {
  /** The selected owner class supplies the immutable decision family. */
  const error = new RpcAuthenticationError(...args)
  return mintLocalRpcError(error, error.code, RpcAuthenticationError)
}

/**
 * Owner-only construction preserves the native RpcChunkError instance and records its original
 * code.
 */
export function createRpcChunkError(
  ...args: ConstructorParameters<typeof RpcChunkError>
): RpcChunkError {
  /** The selected owner class supplies the immutable decision family. */
  const error = new RpcChunkError(...args)
  return mintLocalRpcError(error, error.code, RpcChunkError)
}

/**
 * Owner-only construction preserves the native RpcRemoteError instance and records its original
 * code.
 */
export function createRpcRemoteError(
  ...args: ConstructorParameters<typeof RpcRemoteError>
): RpcRemoteError {
  /** The selected owner class supplies the immutable decision family. */
  const error = new RpcRemoteError(...args)
  return mintLocalRpcError(error, error.code, RpcRemoteError)
}

/**
 * Owner-only construction preserves the native RpcAbortError instance and records its original
 * code.
 */
export function createRpcAbortError(
  ...args: ConstructorParameters<typeof RpcAbortError>
): RpcAbortError {
  /** The selected owner class supplies the immutable decision family. */
  const error = new RpcAbortError(...args)
  return mintLocalRpcError(error, error.code, RpcAbortError)
}

/**
 * Owner-only construction preserves the native RpcTimeoutError instance and records its original
 * code.
 */
export function createRpcTimeoutError(
  ...args: ConstructorParameters<typeof RpcTimeoutError>
): RpcTimeoutError {
  /** The selected owner class supplies the immutable decision family. */
  const error = new RpcTimeoutError(...args)
  return mintLocalRpcError(error, error.code, RpcTimeoutError)
}

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
