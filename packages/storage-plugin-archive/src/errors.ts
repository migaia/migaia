import {
  StorageContractError,
  StorageContractErrorCode,
  isStorageContractError
} from '@migaia/storage-contract'
import { PluginHostError } from '@migaia/plugin-host'
import { StorageError, StorageErrorCode } from '@migaia/storage-host'
import { attachErrorIdentity, tryReadProperty } from '@migaia/utils/error'
import { ArchiveErrorCode, ERROR_SOURCE, type IArchiveErrorCode } from './error-code.js'
import { Archive } from './constants.js'
import { ArchiveText } from './error-text.js'

/** Existing coded native/contract failures cross unchanged; uncoded failures retain their class. */
export function archiveError(code: IArchiveErrorCode, cause?: unknown): Error {
  if (
    isStorageContractError(cause) &&
    (cause.code === StorageContractErrorCode.unsupported ||
      cause.code === StorageContractErrorCode.disposed ||
      cause.code === StorageContractErrorCode.aborted ||
      cause.code === StorageContractErrorCode.writeConflict)
  )
    return cause
  if (
    cause instanceof StorageError &&
    (cause.code === StorageErrorCode.storageHostDisposed ||
      cause.code === StorageErrorCode.backendNotInstalled)
  )
    return cause
  if (cause instanceof PluginHostError) return cause
  if (cause instanceof Error) {
    const source = tryReadProperty(cause as { source?: unknown }, 'source')
    if (!source.threw && source.value === ERROR_SOURCE) return cause
  }
  return createArchiveError(code, cause)
}
/** Preserve native failure classes while the exact original native object remains first cause. */
function createArchiveError(
  code: IArchiveErrorCode,
  cause?: unknown,
  kind: unknown = cause
): Error {
  const text = ArchiveText[code]
  const error =
    kind instanceof TypeError
      ? new TypeError(text, { cause })
      : kind instanceof RangeError
        ? new RangeError(text, { cause })
        : kind instanceof SyntaxError
          ? new SyntaxError(text, { cause })
          : kind instanceof DOMException
            ? new DOMException(text, kind.name)
            : kind instanceof AggregateError
              ? new AggregateError(kind.errors, text, { cause })
              : new Error(text, cause === undefined ? undefined : { cause })
  if (error instanceof DOMException) Object.defineProperty(error, 'cause', { value: cause })
  return attachErrorIdentity(error, { source: ERROR_SOURCE, code })
}
/** Segment validation remains Archive-owned even when the original codec supplied the cause. */
export function invalidSegment(cause?: unknown): Error {
  return createArchiveError(ArchiveErrorCode.segmentInvalid, cause)
}
/** Missing supported hot/cold capabilities fail before reading or changing either backend. */
export function unsupported(cause?: unknown): never {
  throw new StorageContractError(
    StorageContractErrorCode.unsupported,
    { backend: Archive.backend, cause },
    ArchiveText.unsupported
  )
}

/** Re-expose an archive validation scenario after the native transaction has rolled back. */
export function transactionArchiveError(original: Error, cause: unknown): Error {
  return createArchiveError(Reflect.get(original, 'code') as IArchiveErrorCode, cause, original)
}
