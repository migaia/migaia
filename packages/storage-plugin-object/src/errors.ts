import { StorageContractError, StorageContractErrorCode } from '@migaia/storage-contract'
import { attachErrorIdentity } from '@migaia/utils/error'
import { ERROR_SOURCE, ObjectErrorCode, type IObjectErrorCode } from './error-code.js'
import { ObjectErrorText } from './error-text.js'
import { ObjectNames } from './constants.js'
/** Attach domain and code to a new native Error while preserving the exact original cause. */
export function objectError(
  code: IObjectErrorCode,
  cause?: unknown
): Error & { readonly source: typeof ERROR_SOURCE; readonly code: IObjectErrorCode } {
  const error = new Error(
    code === ObjectErrorCode.dataInvalid
      ? ObjectErrorText.dataInvalid
      : code === ObjectErrorCode.commitUnknown
        ? ObjectErrorText.commitUnknown
        : ObjectErrorText.failed,
    { cause }
  )
  Object.defineProperties(error, {
    source: { value: ERROR_SOURCE, enumerable: true },
    code: { value: code, enumerable: true }
  })
  return error as Error & { readonly source: typeof ERROR_SOURCE; readonly code: IObjectErrorCode }
}
/**
 * Native argument/platform error identity and stacks survive code attachment; owner errors stay
 * exact.
 */
export function normalizeObjectError(error: unknown): Error {
  if (
    error instanceof StorageContractError ||
    (error instanceof Error && 'source' in error && error.source === ERROR_SOURCE)
  )
    return error
  if (
    error instanceof TypeError ||
    error instanceof RangeError ||
    (typeof DOMException !== 'undefined' && error instanceof DOMException)
  ) {
    /** Immutable or already-identified native errors keep their exact original on the cause chain. */
    const fallback = (): Error => {
      const replacement =
        error instanceof TypeError
          ? new TypeError(ObjectErrorText.failed, { cause: error })
          : error instanceof RangeError
            ? new RangeError(ObjectErrorText.failed, { cause: error })
            : new DOMException(ObjectErrorText.failed, error.name)
      if (replacement instanceof DOMException)
        Object.defineProperty(replacement, 'cause', { value: error })
      return attachErrorIdentity(replacement, {
        source: ERROR_SOURCE,
        code: ObjectErrorCode.failed
      })
    }
    return attachErrorIdentity<Error>(
      error,
      { source: ERROR_SOURCE, code: ObjectErrorCode.failed },
      { onConflict: fallback, onFailure: fallback }
    )
  }
  return objectError(ObjectErrorCode.failed, error)
}
/** Pure factory and cursor failures belong to the existing shared argument family. */
export function invalidArgument(cause?: unknown): StorageContractError {
  return new StorageContractError(
    StorageContractErrorCode.invalidArgument,
    { backend: ObjectNames.backend, cause },
    ObjectErrorText.argument
  )
}
/** Definite object absence is distinct from permissions, corrupt data and transient network failure. */
export function isMissing(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (('code' in error && error.code === 'ENOENT') ||
      ('name' in error && (error.name === 'NotFound' || error.name === 'NoSuchKey')))
  )
}
/** Public option getters fail in the original argument family before native side effects. */
export function captureObjectOptions<T>(capture: () => T): T {
  try {
    return capture()
  } catch (cause) {
    if (cause instanceof StorageContractError) throw cause
    throw invalidArgument(cause)
  }
}
