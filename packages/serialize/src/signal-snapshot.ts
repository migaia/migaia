import {
  createSerializeTypeError,
  SerializeErrorCode,
  SerializeErrorText,
  SERIALIZE_SOURCE
} from './errors.js'
import type { ISerializeAbortSignal } from './types.js'

/** Keep tagged serialize failures intact while wrapping hostile signal accessors. */
export const isSerializeTaggedError = (
  error: unknown
): error is Error & { readonly source: string } => {
  try {
    return (
      error instanceof Error && (error as { readonly source?: unknown }).source === SERIALIZE_SOURCE
    )
  } catch {
    return false
  }
}

/** Read dynamic `aborted` state and convert accessor/shape failures to package-owned errors. */
export const readAborted = (signal: ISerializeAbortSignal): boolean => {
  try {
    const value = signal.aborted
    if (typeof value !== 'boolean') throw new TypeError(SerializeErrorText.signalInvalid)
    return value
  } catch (error) {
    if (isSerializeTaggedError(error)) throw error
    throw createSerializeTypeError(
      SerializeErrorCode.invalidOption,
      SerializeErrorText.signalAccessorFailed,
      { cause: error }
    )
  }
}

/** Read abort reason once at the point it wins arbitration. */
export const readReason = (signal: ISerializeAbortSignal): unknown => {
  try {
    return signal.reason
  } catch (error) {
    if (isSerializeTaggedError(error)) throw error
    throw createSerializeTypeError(
      SerializeErrorCode.invalidOption,
      SerializeErrorText.signalReasonReadFailed,
      { cause: error }
    )
  }
}

/** Capture a structural source for stream operations without importing lifecycle runtime code. */
export const snapshotSerializeSignal = (value: unknown): ISerializeAbortSignal => {
  try {
    if (value === null || (typeof value !== 'object' && typeof value !== 'function')) {
      throw new TypeError(SerializeErrorText.signalInvalid)
    }
    const source = value as ISerializeAbortSignal
    const initialAborted = readAborted(source)
    if (
      typeof source.addEventListener !== 'function' ||
      typeof source.removeEventListener !== 'function'
    ) {
      throw new TypeError(SerializeErrorText.signalInvalid)
    }
    const initialReason = initialAborted ? readReason(source) : undefined
    /** Snapshot state that prevents pre-aborted operations from rereading hostile raw getters. */
    let observedAborted = initialAborted
    /** First reason observed by this snapshot, retained by identity. */
    let observedReason = initialReason
    const captureCurrentState = (): boolean => {
      if (observedAborted) return true
      const currentAborted = readAborted(source)
      if (!currentAborted) return false
      observedAborted = true
      observedReason = readReason(source)
      return true
    }
    return {
      get aborted() {
        return captureCurrentState()
      },
      get reason() {
        return observedAborted ? observedReason : readReason(source)
      },
      addEventListener(type, listener, options) {
        source.addEventListener(type, listener, options)
      },
      removeEventListener(type, listener) {
        source.removeEventListener(type, listener)
      }
    }
  } catch (error) {
    if (isSerializeTaggedError(error)) throw error
    throw createSerializeTypeError(
      SerializeErrorCode.invalidOption,
      SerializeErrorText.signalAccessorFailed,
      { cause: error }
    )
  }
}
