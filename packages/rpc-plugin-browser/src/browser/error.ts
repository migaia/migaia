import { attachErrorIdentity } from '@migaia/utils/error'
import { RPC_CORE_ERROR_SOURCE, RpcCoreErrorCode } from '@migaia/rpc-host'

/** Existing first-party diagnostic family names remain recognizable by Core's public error guards. */
const BrowserRpcErrorFamily = {
  /** Window admission historically reports the generic RpcError family. */
  rpc: 'RpcError',
  /** Browser I/O historically reports the RpcTransportError family. */
  transport: 'RpcTransportError'
} as const

/**
 * Construct this Browser owner's admission failure with its historical Core diagnostic identity.
 * This native object never receives Core's private live-operation identity.
 */
export function createBrowserConfigurationError(message: string): Error {
  /** This owner creates the original Error and keeps its original enumerable cause field. */
  const error = new Error(message)
  error.name = BrowserRpcErrorFamily.rpc
  error.cause = undefined
  return attachErrorIdentity(error, {
    source: RPC_CORE_ERROR_SOURCE,
    code: RpcCoreErrorCode.invalidConfig
  })
}

/**
 * Preserve Browser's original Error/name/cause presentation for actual transport failures.
 * Diagnostic source/code do not mint Core authority or select retry, cancellation or close.
 */
export function createBrowserTransportError(message: string, cause?: unknown): Error {
  /** A failed platform read retains its original exception through the same direct cause field. */
  const error = new Error(message)
  error.name = BrowserRpcErrorFamily.transport
  error.cause = cause
  return attachErrorIdentity(error, {
    source: RPC_CORE_ERROR_SOURCE,
    code: RpcCoreErrorCode.transport
  })
}
