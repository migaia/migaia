/**
 * Preserves browser configuration, transport and handshake diagnostics under centralized RPC
 * identities.
 */
import { attachErrorIdentity } from '@migaia/utils/error'
import { RpcError, RpcCoreErrorText, RpcTimeoutError } from '@migaia/rpc-contract/errors'
import { BrowserPeerErrorText } from '../error-text.ts'
import { RPC_ENDPOINT_ERROR_SOURCE, RpcCoreErrorCode } from '@migaia/rpc-contract/error-code'

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
    source: RPC_ENDPOINT_ERROR_SOURCE,
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
    source: RPC_ENDPOINT_ERROR_SOURCE,
    code: RpcCoreErrorCode.transport
  })
}

/** These native media cannot transfer ownership; reject before caller transfer getters are read. */
export function rejectBrowserTransfer(): never {
  throw new RpcError(RpcCoreErrorCode.capabilityUnsupported, RpcCoreErrorText.capabilityUnsupported)
}

/** Preserve message-source startup diagnostics while Session retains the sole handshake deadline. */
export function normalizeBrowserHandshakeFailure(error: unknown): unknown {
  if (!(error instanceof RpcTimeoutError)) return error
  return attachErrorIdentity(
    new TypeError(BrowserPeerErrorText.handshakeNotAcknowledged, { cause: error }),
    { source: RPC_ENDPOINT_ERROR_SOURCE, code: RpcCoreErrorCode.invalidConfig }
  )
}
