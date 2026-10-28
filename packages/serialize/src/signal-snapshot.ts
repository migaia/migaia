/** Signal admission and cached abort state; no lifecycle resource or scheduling ownership. */
import type { IAbortSignal } from '@migaia/utils/promise'
import { createSerializeTypeError, SerializeErrorCode, SerializeErrorText } from './errors.ts'
import { tryReadProperty } from '@migaia/utils/error'
import { hasSerializeErrorIdentity } from './operation-support.ts'

/** Keep tagged serialize failures intact while wrapping hostile signal accessors. */
export const isSerializeTaggedError = (
  error: unknown
): error is Error & { readonly source: string } => {
  try {
    return hasSerializeErrorIdentity(error)
  } catch {
    return false
  }
}

/** Read dynamic `aborted` state and convert accessor/shape failures to package-owned errors. */
export const readAborted = (signal: IAbortSignal): boolean => {
  try {
    /** Capture the source state getter once for shape admission. */
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
export const readReason = (signal: IAbortSignal): unknown => {
  /** Keep serialize-tagged getter failures intact at this boundary. */
  const read = tryReadProperty(signal, 'reason')
  if (read.threw) {
    if (isSerializeTaggedError(read.error)) throw read.error
    throw createSerializeTypeError(
      SerializeErrorCode.invalidOption,
      SerializeErrorText.signalReasonReadFailed,
      { cause: read.error }
    )
  }
  return read.value
}

/** Construct the historical plain snapshot shape while the owner retains cached abort state. */
function signalSnapshotFacade(owner: SerializeSignalSnapshot, source: IAbortSignal): IAbortSignal {
  return {
    get aborted() {
      return owner.captureCurrentState()
    },
    get reason() {
      return owner.readCurrentReason()
    },
    addEventListener(type, listener, options) {
      source.addEventListener(type, listener, options)
    },
    removeEventListener(type, listener) {
      source.removeEventListener(type, listener)
    }
  }
}

/** One snapshot owns cached abort state while retaining the original structural signal receiver. */
class SerializeSignalSnapshot {
  /** Borrowed caller signal remains dynamic until its first observed abort. */
  readonly #source: IAbortSignal
  /** Once true, pre-aborted or subsequently observed state never reads the caller again. */
  #observedAborted: boolean
  /** First observed reason retains exact identity across subsequent snapshot reads. */
  #observedReason: unknown
  /** Plain facade preserves the original own properties and independently callable methods. */
  readonly signal: IAbortSignal

  /** Admit the original source once in its historical getter order. */
  constructor(value: unknown) {
    if (value === null || (typeof value !== 'object' && typeof value !== 'function'))
      throw new TypeError(SerializeErrorText.signalInvalid)
    this.#source = value as IAbortSignal
    this.#observedAborted = readAborted(this.#source)
    if (
      typeof this.#source.addEventListener !== 'function' ||
      typeof this.#source.removeEventListener !== 'function'
    )
      throw new TypeError(SerializeErrorText.signalInvalid)
    this.#observedReason = this.#observedAborted ? readReason(this.#source) : undefined
    this.signal = signalSnapshotFacade(this, this.#source)
  }

  /** Observe the first dynamic abort and cache its reason through the existing coded boundary. */
  captureCurrentState(): boolean {
    if (this.#observedAborted) return true
    /** Caller state is read once per recheck until abort wins. */
    const currentAborted = readAborted(this.#source)
    if (!currentAborted) return false
    this.#observedAborted = true
    this.#observedReason = readReason(this.#source)
    return true
  }

  /** Before abort, reason reads remain dynamic; afterward the first observed identity wins. */
  readCurrentReason(): unknown {
    return this.#observedAborted ? this.#observedReason : readReason(this.#source)
  }
}

/** Capture a structural source without importing lifecycle runtime code; failures retain cause. */
export const snapshotSerializeSignal = (value: unknown): IAbortSignal => {
  try {
    return new SerializeSignalSnapshot(value).signal
  } catch (error) {
    if (isSerializeTaggedError(error)) throw error
    throw createSerializeTypeError(
      SerializeErrorCode.invalidOption,
      SerializeErrorText.signalAccessorFailed,
      { cause: error }
    )
  }
}
