/**
 * Constructs native Contract failures and classifies callback failures without replacing their
 * original identity. Optional caller-owned metadata records provenance; no global error state lives
 * here.
 */
import {
  attachErrorIdentity,
  attachSecondaryErrors,
  isNativeErrorValue,
  tryReadProperty
} from '@migaia/utils/error'
import { RpcContractErrorCode, type IRpcContractErrorCode } from '../error-code.ts'
import { RPC_CONTRACT_SOURCE, RpcContractErrorText } from './error-text.ts'
import type { IRpcErrorWireMetadata } from './types.ts'

/**
 * Canonical text per public code. Keyed by code so every throw site shares one total mapping;
 * adding a code without text fails typecheck instead of silently reusing another message.
 */
const TEXT_BY_CODE: Readonly<Record<IRpcContractErrorCode, string>> = {
  [RpcContractErrorCode.callbackFailed]: RpcContractErrorText.callbackFailed,
  [RpcContractErrorCode.invalidDescriptor]: RpcContractErrorText.invalidDescriptor,
  [RpcContractErrorCode.invalidEnvelope]: RpcContractErrorText.invalidEnvelope,
  [RpcContractErrorCode.invalidStream]: RpcContractErrorText.invalidStream,
  [RpcContractErrorCode.invalidFrame]: RpcContractErrorText.invalidFrame,
  [RpcContractErrorCode.frameLimitExceeded]: RpcContractErrorText.frameLimitExceeded,
  [RpcContractErrorCode.frameAssemblyExpired]: RpcContractErrorText.frameAssemblyExpired,
  [RpcContractErrorCode.invalidWireError]: RpcContractErrorText.invalidWireError,
  [RpcContractErrorCode.handshakeInvalid]: RpcContractErrorText.handshakeInvalid,
  [RpcContractErrorCode.handshakeIncompatible]: RpcContractErrorText.handshakeIncompatible,
  [RpcContractErrorCode.handshakeRejected]: RpcContractErrorText.handshakeRejected,
  [RpcContractErrorCode.extensionNegotiationFailed]: RpcContractErrorText.extensionNegotiationFailed
}

/**
 * Native error type per code. Descriptor/envelope shape violations stay `TypeError`; framing
 * grammar and budget violations stay `RangeError`, because callers already branch on both.
 */
const RANGE_CODES: ReadonlySet<IRpcContractErrorCode> = new Set([
  RpcContractErrorCode.invalidFrame,
  RpcContractErrorCode.frameLimitExceeded,
  RpcContractErrorCode.frameAssemblyExpired
])

/**
 * Single construction site for every rpc-contract boundary error. Attaches `source`/`code` as
 * enumerable own properties without rebuilding the error, and places an optional original error on
 * the standard non-enumerable `cause` so traceability is identical across all throw sites.
 */
export function createContractError(
  code: IRpcContractErrorCode,
  cause?: unknown,
  metadata?: IRpcErrorWireMetadata
): Error {
  /** Constructor option object; omitted entirely so no `cause` key exists when none was given. */
  const options = cause === undefined ? undefined : { cause }
  /** Native error preserving the per-code runtime type. */
  const error = RANGE_CODES.has(code)
    ? new RangeError(TEXT_BY_CODE[code], options)
    : code === RpcContractErrorCode.callbackFailed ||
        code === RpcContractErrorCode.handshakeIncompatible ||
        code === RpcContractErrorCode.handshakeRejected
      ? new Error(TEXT_BY_CODE[code], options)
      : new TypeError(TEXT_BY_CODE[code], options)
  metadata?.summaries?.set(error, Object.freeze({ code, message: TEXT_BY_CODE[code] }))
  return attachErrorIdentity(error, { source: RPC_CONTRACT_SOURCE, code })
}

/** Identifies a callback failure without replacing a mutable native error or another owner. */
export function identifyContractCallbackFailure(
  error: unknown,
  metadata?: IRpcErrorWireMetadata
): Error {
  if (isNativeErrorValue(error)) {
    /** A full semantic identity remains with the originating package. */
    const source = tryReadProperty(error as { source?: unknown }, 'source')
    /** Host-only native codes are not a complete package error identity. */
    const code = tryReadProperty(error as { code?: unknown }, 'code')
    if (
      !source.threw &&
      !code.threw &&
      typeof source.value === 'string' &&
      source.value.length > 0 &&
      typeof code.value === 'string' &&
      code.value.length > 0
    )
      return error
    try {
      attachErrorIdentity(error, {
        source: RPC_CONTRACT_SOURCE,
        code: RpcContractErrorCode.callbackFailed
      })
      metadata?.summaries?.set(
        error,
        Object.freeze({
          code: RpcContractErrorCode.callbackFailed,
          message: RpcContractErrorText.callbackFailed
        })
      )
      return error
    } catch (attachmentError) {
      return attachSecondaryErrors(
        createContractError(RpcContractErrorCode.callbackFailed, error, metadata),
        [attachmentError]
      ) as Error
    }
  }
  /** Explicit cause presence retains even a callback that threw undefined. */
  const failure = createContractError(RpcContractErrorCode.callbackFailed, undefined, metadata)
  Object.defineProperty(failure, 'cause', { value: error, configurable: true, writable: true })
  return failure
}
