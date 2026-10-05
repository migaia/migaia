import { attachErrorIdentity } from '@migaia/utils/error'
import { RpcContractErrorCode, type IRpcContractErrorCode } from './error-code.js'
import { RPC_CONTRACT_SOURCE, RpcContractErrorText } from './error-text.js'

/** A factory may preserve only its own bounded chain; this permission never propagates to children. */
type ILocalErrorWireSummary = Readonly<{
  code: string
  message: string
  preserveSerializedError?: true
}>

/** Route provenance joins the existing summary owner; unrelated thrown values incur no new reads. */
type ILocalErrorWireMetadata = Readonly<{
  summary?: ILocalErrorWireSummary
  route?: readonly string[]
}>

/** Only genuine local registration can opt in; serialized or user-defined properties cannot. */
const summaries = new WeakMap<Error, ILocalErrorWireMetadata>()

/** Retain only admitted node ids on the existing error metadata owner without inspecting an Error. */
export function registerLocalErrorWireRoute(error: Error, route: readonly string[]): void {
  summaries.set(error, Object.freeze({ ...summaries.get(error), route }))
}

/** Read package-minted metadata without invoking ordinary business error property traps. */
export function localErrorWireRoute(error: unknown): readonly string[] | undefined {
  return (typeof error === 'object' && error !== null) || typeof error === 'function'
    ? summaries.get(error as Error)?.route
    : undefined
}

/** Retain the original local cause while limiting a contract failure's outbound disclosure. */
export function registerLocalErrorWireSummary(
  error: Error,
  code: string,
  message: string,
  options?: Readonly<{ preserveSerializedError?: true }>
): void {
  summaries.set(
    error,
    Object.freeze({
      ...summaries.get(error),
      summary: Object.freeze({
        code,
        message,
        ...(options?.preserveSerializedError === true
          ? { preserveSerializedError: true as const }
          : {})
      })
    })
  )
}

/** Read the factory-owned summary without invoking any untrusted error property getters. */
export function localErrorWireSummary(error: unknown): ILocalErrorWireSummary | undefined {
  return (typeof error === 'object' && error !== null) || typeof error === 'function'
    ? summaries.get(error as Error)?.summary
    : undefined
}

/**
 * Canonical text per public code. Keyed by code so every throw site shares one total mapping;
 * adding a code without text fails typecheck instead of silently reusing another message.
 */
const TEXT_BY_CODE: Readonly<Record<IRpcContractErrorCode, string>> = {
  [RpcContractErrorCode.invalidDescriptor]: RpcContractErrorText.invalidDescriptor,
  [RpcContractErrorCode.invalidEnvelope]: RpcContractErrorText.invalidEnvelope,
  [RpcContractErrorCode.invalidStream]: RpcContractErrorText.invalidStream,
  [RpcContractErrorCode.invalidFrame]: RpcContractErrorText.invalidFrame,
  [RpcContractErrorCode.frameLimitExceeded]: RpcContractErrorText.frameLimitExceeded,
  [RpcContractErrorCode.frameAssemblyExpired]: RpcContractErrorText.frameAssemblyExpired,
  [RpcContractErrorCode.invalidWireError]: RpcContractErrorText.invalidWireError,
  [RpcContractErrorCode.handshakeInvalid]: RpcContractErrorText.handshakeInvalid,
  [RpcContractErrorCode.handshakeIncompatible]: RpcContractErrorText.handshakeIncompatible,
  [RpcContractErrorCode.handshakeRejected]: RpcContractErrorText.handshakeRejected
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
export function createContractError(code: IRpcContractErrorCode, cause?: unknown): Error {
  /** Constructor option object; omitted entirely so no `cause` key exists when none was given. */
  const options = cause === undefined ? undefined : { cause }
  /** Native error preserving the per-code runtime type. */
  const error = RANGE_CODES.has(code)
    ? new RangeError(TEXT_BY_CODE[code], options)
    : code === RpcContractErrorCode.handshakeIncompatible ||
        code === RpcContractErrorCode.handshakeRejected
      ? new Error(TEXT_BY_CODE[code], options)
      : new TypeError(TEXT_BY_CODE[code], options)
  registerLocalErrorWireSummary(error, code, TEXT_BY_CODE[code])
  return attachErrorIdentity(error, { source: RPC_CONTRACT_SOURCE, code })
}
