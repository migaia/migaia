/**
 * Owns shared operation error identity, safe diagnostics, cancellation reads, and cleanup
 * projection. Registry and stream entry points retain their distinct public error policies through
 * this owner.
 */
import type { IAbortSignal } from '@migaia/utils/promise'
import { attachSecondaryErrors, safeErrorReason, tryReadProperty } from '@migaia/utils/error'
import {
  createSerializeError,
  createSerializeTypeError,
  SerializeErrorCode,
  SerializeErrorText,
  SERIALIZE_SOURCE,
  type ISerializeErrorCode
} from './errors.ts'

/**
 * Reads classification without containing hostile error accessors, for established scheduler
 * policy.
 */
export function hasSerializeErrorIdentity(error: unknown, code?: ISerializeErrorCode): boolean {
  return (
    error instanceof Error &&
    (error as { readonly source?: unknown }).source === SERIALIZE_SOURCE &&
    (code === undefined || (error as { readonly code?: unknown }).code === code)
  )
}

/**
 * Contains hostile error identity access for operation boundaries that previously treated it as
 * false.
 */
export function isSerializeTaggedError(
  error: unknown,
  code?: ISerializeErrorCode
): error is Error & { readonly source: string } {
  try {
    return hasSerializeErrorIdentity(error, code)
  } catch {
    return false
  }
}

/** Formats diagnostics without allowing hostile access or coercion to replace the original cause. */
export const reasonOf = (error: unknown): string =>
  safeErrorReason(error, SerializeErrorText.reasonUnavailable)

/** Retains registry cleanup causes and its established AggregateError fallback message. */
export function appendCleanupErrors(primary: unknown, cleanupErrors: readonly unknown[]): unknown {
  if (cleanupErrors.length === 0) return primary
  /** The canonical error owner attaches secondaries when the primary permits it. */
  const attached = attachSecondaryErrors(primary, cleanupErrors)
  if (attached === primary) return primary
  return new AggregateError([primary, ...cleanupErrors], reasonOf(primary))
}

/** Converts stream-option failures while retaining an already-owned INVALID_OPTION unchanged. */
export function streamOptionFailure(error: unknown): never {
  if (isSerializeTaggedError(error, SerializeErrorCode.invalidOption)) throw error
  throw createSerializeTypeError(
    SerializeErrorCode.invalidOption,
    SerializeErrorText.operationOptionInvalid,
    { cause: error }
  )
}

/** Reads live structural state using the original two-read boolean admission policy. */
export function readSerializeSignalAborted(signal: IAbortSignal): boolean {
  try {
    if (typeof signal.aborted !== 'boolean') throw new TypeError(SerializeErrorText.signalInvalid)
    return signal.aborted
  } catch (error) {
    if (isSerializeTaggedError(error, SerializeErrorCode.invalidOption)) throw error
    throw createSerializeTypeError(
      SerializeErrorCode.invalidOption,
      SerializeErrorText.signalAccessorFailed,
      { cause: error }
    )
  }
}

/** Stream cancellation wraps every failing reason read, including serialize-tagged failures. */
export function readSerializeSignalReason(signal: IAbortSignal): unknown {
  /** Reading once preserves the admitted signal's exact reason or the getter failure identity. */
  const read = tryReadProperty(signal, 'reason')
  if (read.threw)
    throw createSerializeTypeError(
      SerializeErrorCode.invalidOption,
      SerializeErrorText.signalReasonReadFailed,
      { cause: read.error }
    )
  return read.value
}

/** Checks cooperative cancellation only at supported stream admission and resumption boundaries. */
export function checkStreamAbort(signal: IAbortSignal | undefined): void {
  if (signal !== undefined && readSerializeSignalAborted(signal)) {
    throw createSerializeError(SerializeErrorCode.aborted, SerializeErrorText.aborted, {
      cause: readSerializeSignalReason(signal)
    })
  }
}
