import { StorageContractError, StorageContractErrorCode } from '@migaia/storage-contract'
import { attachErrorIdentity } from '@migaia/utils/error'
import { ERROR_SOURCE, SparqlErrorCode, type ISparqlErrorCode } from './error-code.js'
import { SparqlErrorText } from './error-text.js'
import { SparqlText } from './text.js'
/** Native errors retain their type and stack, with immutable/conflicting identities on cause. */
export function sparqlError(code: ISparqlErrorCode, cause?: unknown): Error {
  const text =
    code === SparqlErrorCode.responseInvalid
      ? SparqlErrorText.responseInvalid
      : code === SparqlErrorCode.requestFailed
        ? SparqlErrorText.requestFailed
        : code === SparqlErrorCode.commitUnknown
          ? SparqlErrorText.commitUnknown
          : SparqlErrorText.unavailable
  const wrap = (): Error => {
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
/** Existing contract and package errors are not relabelled by native boundary normalization. */
export function normalizeSparqlError(error: unknown): Error {
  if (
    error instanceof StorageContractError ||
    (error instanceof Error && 'source' in error && error.source === ERROR_SOURCE)
  )
    return error
  return sparqlError(SparqlErrorCode.unavailable, error)
}
/** Pure invalid parameters stay in the canonical contract argument family. */
export function invalidArgument(cause?: unknown): StorageContractError {
  return new StorageContractError(
    StorageContractErrorCode.invalidArgument,
    { backend: SparqlText.backend, cause },
    SparqlErrorText.argument
  )
}
/** Structural option getters are captured at the public entry before native execution. */
export function capture<T>(read: () => T): T {
  try {
    return read()
  } catch (cause) {
    if (cause instanceof StorageContractError) throw cause
    throw invalidArgument(cause)
  }
}
