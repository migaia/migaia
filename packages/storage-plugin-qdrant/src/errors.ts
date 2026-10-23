import { StorageContractError, StorageContractErrorCode } from '@migaia/storage-contract'
import { attachErrorIdentity, walkErrorCauses } from '@migaia/utils/error'
import { normalizeError } from '@migaia/storage-host/authoring/backend'
import { ERROR_SOURCE, QdrantErrorCode, type IQdrantErrorCode } from './error-code.js'
import { QdrantErrorText } from './error-text.js'
import { QdrantText } from './constants.js'
/** Attach native identity through the original helper, retaining immutable failures as causes. */
export function qdrantError(code: IQdrantErrorCode, cause?: unknown): Error {
  const message =
    code === QdrantErrorCode.requestFailed
      ? QdrantErrorText.requestFailed
      : code === QdrantErrorCode.responseInvalid
        ? QdrantErrorText.responseInvalid
        : QdrantErrorText.unavailable
  const wrap = (): Error => {
    const error =
      cause instanceof TypeError
        ? new TypeError(message, { cause })
        : cause instanceof RangeError
          ? new RangeError(message, { cause })
          : cause instanceof SyntaxError
            ? new SyntaxError(message, { cause })
            : typeof DOMException !== 'undefined' && cause instanceof DOMException
              ? new DOMException(message, cause.name)
              : new Error(message, { cause })
    if (typeof DOMException !== 'undefined' && error instanceof DOMException)
      Object.defineProperty(error, 'cause', { value: cause })
    return attachErrorIdentity(error, { source: ERROR_SOURCE, code })
  }
  if (
    cause instanceof TypeError ||
    cause instanceof RangeError ||
    cause instanceof SyntaxError ||
    (cause instanceof Error && cause.name === QdrantText.sdkUnexpectedResponse) ||
    (typeof DOMException !== 'undefined' && cause instanceof DOMException)
  )
    return attachErrorIdentity<Error>(
      cause,
      { source: ERROR_SOURCE, code },
      { onConflict: wrap, onFailure: wrap }
    )
  return wrap()
}
/** Native status remains available without copying SDK client configuration. */
export function responseStatus(error: unknown): number | undefined {
  for (const cause of walkErrorCauses(error))
    if (cause && typeof cause === 'object' && 'status' in cause && typeof cause.status === 'number')
      return cause.status
  return undefined
}
/** Existing error owners survive native normalization, including original cancellation. */
export function normalizeQdrantError(error: unknown): Error {
  return normalizeError(
    error,
    (cause) => {
      const status = responseStatus(cause)
      return qdrantError(
        cause instanceof SyntaxError ||
          (cause instanceof Error && cause.name === QdrantText.sdkUnexpectedResponse) ||
          (status !== undefined && status >= 200 && status < 400)
          ? QdrantErrorCode.responseInvalid
          : status !== undefined && status >= 400 && status < 500
            ? QdrantErrorCode.requestFailed
            : QdrantErrorCode.unavailable,
        cause
      )
    },
    (value): value is Error =>
      value instanceof Error && 'source' in value && value.source === ERROR_SOURCE
  )
}
/** Pure public input failures remain owned by the existing shared contract. */
export function invalidArgument(cause?: unknown): StorageContractError {
  return new StorageContractError(
    StorageContractErrorCode.invalidArgument,
    { backend: 'qdrant', cause },
    QdrantErrorText.argument
  )
}
/** Reflection occurs once before native work and preserves its original cause. */
export function capture<T>(read: () => T): T {
  try {
    return read()
  } catch (cause) {
    if (cause instanceof StorageContractError) throw cause
    throw invalidArgument(cause)
  }
}
