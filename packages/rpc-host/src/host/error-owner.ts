/**
 * Host-owned exact-reference provenance for local control decisions; public diagnostics live in
 * contract.
 */
import {
  RpcError,
  RpcSchemaValidationError,
  RpcConfigurationError,
  RpcConstructionError,
  RpcLifecycleError,
  RpcSerializationError,
  RpcProtocolError,
  RpcContractError,
  RpcTransportError,
  RpcAuthenticationError,
  RpcChunkError,
  RpcRemoteError,
  RpcAbortError,
  RpcTimeoutError,
  RpcCoreErrorText,
  identifyRpcBoundaryFailure,
  tagRpcError
} from '@migaia/rpc-contract/errors'
import { RPC_ENDPOINT_ERROR_SOURCE, RpcCoreErrorCode } from '@migaia/rpc-contract/error-code'
import { attachSecondaryErrors, tryReadProperty } from '@migaia/utils/error'
import {
  PluginHostError,
  PluginHostErrorCode,
  type IPluginInstallFailureDetail
} from '@migaia/plugin-host'

/** Preserve the native install cause and its actual completed rollback receipt together. */
export async function originalRpcInstallationFailure(
  error: unknown
): Promise<Readonly<{ error: unknown }>> {
  if (!(error instanceof PluginHostError) || error.code !== PluginHostErrorCode.pluginInstallFailed)
    return { error }
  /** Native completion is the sole source of late cleanup failures; no report collector is added. */
  const detail = error.detail as IPluginInstallFailureDetail | undefined
  if (!detail || !Object.hasOwn(error, 'cause')) return { error }
  /** An ordinary cancellation without cleanup failure retains its exact original reason. */
  const settled = detail.completion ? await detail.completion : detail
  /** The receipt boxes arbitrary failure values so async return cannot assimilate a thrown thenable. */
  const failure = settled.rollbackErrors.length
    ? createRpcConstructionError(
        RpcCoreErrorText.endpointDisposed,
        error.cause,
        settled.rollbackErrors.map((failure) => ({
          resource: RpcCoreErrorText.endpointDisposed,
          error: failure
        }))
      )
    : error.cause
  return { error: failure }
}

/** Failed startup exposes the existing close receipt without substituting rollback for its cause. */
export async function rpcConstructionFailure(
  primary: unknown,
  cleanup: unknown
): Promise<RpcConstructionError> {
  /** The genuine native transaction is joined before the root's later disposal failures. */
  const original = (await originalRpcInstallationFailure(primary)).error
  /** Only locally constructed lifecycle diagnostics grant access to this real release receipt. */
  const failures =
    isLocalRpcError(cleanup, RpcLifecycleError) && cleanup.cleanupErrors
      ? cleanup.cleanupErrors
      : [{ resource: RpcCoreErrorText.endpointDisposed, error: cleanup }]
  return createRpcConstructionError(
    RpcCoreErrorText.endpointDisposed,
    isLocalRpcError(original, RpcConstructionError) ? original.cause : original,
    isLocalRpcError(original, RpcConstructionError)
      ? [...original.cleanupErrors, ...failures]
      : failures
  )
}

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

/** Physical departure owns a transport diagnostic, while an executing retry owns result uncertainty. */
export function createRpcPhysicalTransportError(reason: unknown): Error {
  /** Existing native classification preserves uncoded Error identity and unknown reasons on cause. */
  const error = identifyRpcBoundaryFailure(
    reason,
    RpcCoreErrorCode.transport,
    RpcCoreErrorText.endpointDisposed
  )
  /** Diagnostic identity prevents retagging; only the caller's physical fact grants this boundary. */
  const source = tryReadProperty(error as Error & { source?: unknown }, 'source')
  /** A native DOM numeric code is not an RPC semantic identity. */
  const code = tryReadProperty(error as Error & { code?: unknown }, 'code')
  if (
    !source.threw &&
    !code.threw &&
    source.value === RPC_ENDPOINT_ERROR_SOURCE &&
    code.value === RpcCoreErrorCode.transport
  )
    return error
  /** Foreign coded failures keep their exact original object and native wording below this boundary. */
  const message = tryReadProperty(error, 'message')
  /** Plain Error matches the original physical EOF family without granting local control identity. */
  const failure = tagRpcError(
    new Error(
      !message.threw && typeof message.value === 'string'
        ? message.value
        : RpcCoreErrorText.endpointDisposed,
      { cause: error }
    ),
    RpcCoreErrorCode.transport
  )
  for (const read of [source, code, message])
    if (read.threw) attachSecondaryErrors(failure, [read.error])
  return failure
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
