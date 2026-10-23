import { RpcError, RpcTransportError, tagRpcError } from '../core/errors.js'
import { RpcCoreErrorCode } from '../core/error-code.js'
import { defaultRpcId } from '../core/internal/id.js'
import { resolveAbortReason } from '../core/internal/async-control.js'
import { readRuntimeDefaultTimeout } from '../remote/runtime-api/timeout.js'
import { compileRuntimeMethods } from '../remote/runtime-api/catalog.js'
import { normalizeRuntimeDescription } from '../remote/runtime-api/description.js'
import { contractRequiresStream } from '../remote/serve-methods.js'
import { RuntimeApiErrorText } from '../remote/runtime-api/constants.js'
import { IpcReporterContext } from '../core/plugins/reporter-context.js'

/** Construct the original source-conflict diagnostic without exporting the private text catalog. */
export function createAdapterSourceConfigurationError() {
  return new RpcError(RpcCoreErrorCode.invalidConfig, RuntimeApiErrorText.sourceInvalid)
}

/** Fixed fallback reporter context belongs to the original IPC listener/report owner. */
export { IpcReporterContext }

/** Allocate an ordinary local resource address; this does not create authentication or trust. */
export function createAdapterId(): string {
  return defaultRpcId()
}

/** Preserve the signal's original abort reason at the held resource operation boundary. */
export function readAdapterAbortReason(signal: Parameters<typeof resolveAbortReason>[0]) {
  return resolveAbortReason(signal)
}

/** Validate a Peer default before an adapter discovers or launches any native resource. */
export function validateAdapterPeerTimeout(
  options: Parameters<typeof readRuntimeDefaultTimeout>[0]
) {
  return readRuntimeDefaultTimeout(options)
}

/** Compile actual local provider declarations before an adapter installs bootstrap listeners. */
export function validateAdapterPeerMethods(...args: Parameters<typeof compileRuntimeMethods>) {
  return compileRuntimeMethods(...args)
}

/** Normalize a received directory as data; this operation cannot grant channel capability facts. */
export function normalizeAdapterDescription(value: unknown) {
  return normalizeRuntimeDescription(value)
}

/** Inspect an admitted remote declaration before selecting a carrier with no stream support. */
export function adapterContractRequiresStream(...args: Parameters<typeof contractRequiresStream>) {
  return contractRequiresStream(...args)
}

/** Construct the established native diagnostic without minting live control identity. */
export function createAdapterConfigurationError(message: string) {
  return new RpcError(RpcCoreErrorCode.invalidConfig, message)
}

/**
 * Construct the native configuration TypeError inside Core; no external error is a registration
 * target.
 */
export function createAdapterConfigurationTypeError(message: string, cause?: unknown): TypeError {
  return tagRpcError(new TypeError(message, { cause }), RpcCoreErrorCode.invalidConfig)
}

/** Preserve the native transport diagnostic/cause without granting private live control identity. */
export function createAdapterTransportError(
  ...args: ConstructorParameters<typeof RpcTransportError>
) {
  return new RpcTransportError(...args)
}
