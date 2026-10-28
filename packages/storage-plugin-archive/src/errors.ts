import {
  StorageContractError,
  StorageContractErrorCode,
  isStorageContractError
} from '@migaia/storage-contract'
import { PluginHostError } from '@migaia/plugin-host'
import { StorageError } from '@migaia/storage-host'
import {
  StorageHostErrorCode,
  ArchiveErrorCode,
  STORAGE_ARCHIVE_ERROR_SOURCE
} from '@migaia/storage-contract/error-code'
import type { IArchiveErrorCode } from '@migaia/storage-contract/error-code'
import { attachErrorIdentity } from '@migaia/utils/error'
import { Archive } from './constants.ts'
import { ArchiveText } from './error-text.ts'

/** The existing archive source marks declared validation failures without accessor normalization. */
export function isArchiveError(
  value: unknown
): value is Error & { readonly code: IArchiveErrorCode } {
  return (
    value instanceof Error &&
    (value as { source?: unknown }).source === STORAGE_ARCHIVE_ERROR_SOURCE
  )
}
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
    (cause.code === StorageHostErrorCode.storageHostDisposed ||
      cause.code === StorageHostErrorCode.backendNotInstalled)
  )
    return cause
  if (cause instanceof PluginHostError) return cause
  if (isArchiveError(cause)) return cause
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
  return attachErrorIdentity(error, { source: STORAGE_ARCHIVE_ERROR_SOURCE, code })
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
  return createArchiveError((original as Error & { code: IArchiveErrorCode }).code, cause, original)
}
