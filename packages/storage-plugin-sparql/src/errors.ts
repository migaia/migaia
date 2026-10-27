import { StorageContractError, StorageContractErrorCode } from '@migaia/storage-contract'
import { attachErrorIdentity } from '@migaia/utils/error'
import { normalizeError } from '@migaia/storage-host/sdk'
import { ERROR_SOURCE, SparqlErrorCode, type ISparqlErrorCode } from './error-code.js'
import { SparqlErrorText } from './error-text.js'
import { SparqlText } from './text.js'
/** Native errors retain their type and stack, with immutable/conflicting identities on cause. */
export function sparqlError(code: ISparqlErrorCode, cause?: unknown): Error {
  /** Stable contract text or a complete native request is selected before crossing its boundary. */
  const text =
    code === SparqlErrorCode.responseInvalid
      ? SparqlErrorText.responseInvalid
      : code === SparqlErrorCode.requestFailed
        ? SparqlErrorText.requestFailed
        : code === SparqlErrorCode.commitUnknown
          ? SparqlErrorText.commitUnknown
          : code === SparqlErrorCode.transactionFailed
            ? SparqlErrorText.transactionFailed
            : SparqlErrorText.unavailable
  /** A conflicting native identity remains reachable as the cause of the coded wrapper. */
  const wrap = (): Error => {
    /** Native error classes are preserved because callers distinguish their failure families. */
    const error =
      cause instanceof TypeError
        ? new TypeError(text, { cause })
        : cause instanceof RangeError
          ? new RangeError(text, { cause })
          : typeof DOMException !== 'undefined' && cause instanceof DOMException
            ? new DOMException(text, cause.name)
            : new Error(text, { cause })
    if (typeof DOMException !== 'undefined' && error instanceof DOMException)
      Object.defineProperty(error, 'cause', { value: cause })
    return attachErrorIdentity(error, { source: ERROR_SOURCE, code })
  }
  if (
    cause instanceof TypeError ||
    cause instanceof RangeError ||
    (typeof DOMException !== 'undefined' && cause instanceof DOMException)
  )
    return attachErrorIdentity<Error>(
      cause,
      { source: ERROR_SOURCE, code },
      { onConflict: wrap, onFailure: wrap }
    )
  return wrap()
}
/** The original family boundary recognizes already-normalized native protocol errors. */
function isSparqlError(error: unknown): error is Error {
  return error instanceof Error && 'source' in error && error.source === ERROR_SOURCE
}
/** Native read failures gain protocol identity while existing error owners stay unchanged. */
export function normalizeSparqlError(error: unknown): Error {
  return normalizeError(
    error,
    (cause) => sparqlError(SparqlErrorCode.unavailable, cause),
    isSparqlError
  )
}
/** Callback and accepted draft failures use transaction semantics, never endpoint availability. */
export function normalizeTransactionFailure(error: unknown): Error {
  return normalizeError(
    error,
    (cause) => sparqlError(SparqlErrorCode.transactionFailed, cause),
    isSparqlError
  )
}
/** Pure invalid parameters stay in the canonical contract argument family. */
export function invalidArgument(cause?: unknown): StorageContractError {
  return new StorageContractError(
    StorageContractErrorCode.invalidArgument,
    { backend: SparqlText.backend, cause },
    SparqlErrorText.argument
  )
}
