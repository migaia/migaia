import { ERROR_SOURCE, SerializeErrorCode, type ISerializeErrorCode } from './error-code.js'
import { attachErrorIdentity, isNativeErrorValue } from '@migaia/utils/error'

export { SerializeErrorCode, type ISerializeErrorCode }

/** The single literal source for error `source`. Throw sites do not repeat `'serialization'`. */
export const SERIALIZE_SOURCE = ERROR_SOURCE

/** Stable registry-option diagnostics used by construction-time validation. */
export const SerializeErrorText = {
  /** Stable boundary text for the public base64 decoder; underlying failures remain on cause. */
  base64Invalid: 'invalid base64 input',
  /** Native JSON failures keep their own message; this fallback is used for non-Error throws. */
  jsonEncodeFailed: 'json encoding failed',
  /** Native JSON parse failures keep their message and type; unknown throws retain their cause. */
  jsonDecodeFailed: 'json decoding failed',
  /** JSON.stringify returning undefined cannot produce a serializable text chunk. */
  jsonUndefined: 'json parser cannot serialize this value',
  /** Standalone JSON bytes decoding needs an injected or host decoder. */
  jsonDecoderUnavailable: 'TextDecoder is unavailable',
  /** Standalone chunk conversion retains the supplied decoder failure behind this fallback. */
  textDecodeFailed: 'serialize text decoding failed',
  /** A value chunk deliberately has no wire text representation. */
  valueTextUnsupported: 'a value chunk has no text form',
  /** A value chunk deliberately has no wire byte representation. */
  valueBytesUnsupported: 'a value chunk has no byte form',
  /** Cooperative stream and registry cancellation share this stable public text. */
  aborted: 'serialize aborted',
  /** Text output admits only portable own data; diagnostics never reflect rejected input values. */
  outputInvalid: 'serialize output requires a supported format and portable own data',
  /** Generic boundary text for an option accessor that threw during admission. */
  registryOptionReadFailed: 'serialize registry option could not be read',
  /** Stable boundary text for a plugin-list container or iterator that fails during admission. */
  pluginListInvalid: 'serialize plugin list is invalid',
  /** Scheduler capability shape required by registry deadline handling. */
  schedulerInvalid: 'serialize scheduler must be { now, schedule }',
  /** Boundary text for a scheduler accessor failure during core admission. */
  schedulerAccessorFailed: 'serialize scheduler accessor could not be read',
  /** Boundary text for a scheduler clock value with the wrong runtime type. */
  schedulerNowType: 'serialize scheduler now() must return a number',
  /** Boundary text for a scheduler clock value outside the finite numeric domain. */
  schedulerNowRange: 'serialize scheduler now() must return a finite number',
  /** Boundary text for a scheduler task with no callable cancel capability. */
  schedulerTaskInvalid: 'serialize scheduler task must provide cancel()',
  /** Boundary text for a task cancel accessor failure during core admission. */
  schedulerTaskCancelGetterFailed: 'serialize scheduler task cancel accessor could not be read',
  /** Boundary text for a failure while releasing an admitted scheduler task. */
  schedulerTaskCancelFailed: 'serialize scheduler task cancel() failed',
  /** Encoder capability shape required when a registry is constructed. */
  encoderInvalid: 'serialize encoder must provide encode() as a function',
  /** Decoder capability shape required when a registry is constructed. */
  decoderInvalid: 'serialize decoder must provide decode() as a function',
  /** Reporter callback shape required for secondary error observation. */
  reportInvalid: 'serialize report must be a function',
  /** Drain-timeout observer shape required for deadline diagnostics. */
  onDrainTimeoutInvalid: 'serialize onDrainTimeout must be a function',
  /** Cleanup policy shape required before a registry can publish disposal state. */
  cleanupInvalid: 'serialize cleanup policy must be throw or report',
  /** Cleanup reporter shape required by the report policy. */
  cleanupReportInvalid: 'serialize cleanup.report must be a function',
  /** Boundary text for a failure while installing a structural abort-signal listener. */
  signalRegistrationFailed: 'serialize abort signal listener registration failed',
  /** Boundary text for a failure while notifying an internal composed-signal listener. */
  signalDispatchFailed: 'serialize abort signal listener dispatch failed',
  /** Boundary text for an operation option accessor or shape that cannot be admitted. */
  operationOptionInvalid: 'serialize operation option is invalid',
  /** Boundary text for a structural abort-signal accessor failure. */
  signalAccessorFailed: 'serialize abort signal accessor could not be read',
  /** Boundary text for a reason accessor failure after an abort is observed. */
  signalReasonReadFailed: 'serialize abort signal reason could not be read',
  /** Structural abort-signal shape required before parser admission. */
  signalInvalid:
    'serialize abort signal must provide aborted, addEventListener(), and removeEventListener()',
  /** Deterministic fallback when a hostile failure cannot expose a safe textual reason. */
  reasonUnavailable: 'serialize failure reason unavailable',
  /** Stable prefix for a text encoder call failure during chunk collection. */
  textEncodeFailed: 'serialize text encoding failed',
  /** Stable diagnostic for an encoder result that cannot be merged as bytes. */
  textEncoderOutputInvalid: 'serialize text encoder must return a Uint8Array',
  /** Stable text for malformed collector options before iterator acquisition. */
  collectOptionInvalid: 'serialize collectStream options are invalid',
  /** Stable text for an empty stream rejection requested by its consumer. */
  collectEmpty: 'serialize stream is empty',
  /** Stable text for a value chunk rejected from wire collection. */
  collectValue: 'cannot collect a value chunk into a stream',
  /** Stable text for iterator cleanup failures at the collector boundary. */
  collectCleanupFailed: 'serialize stream iterator cleanup failed',
  /** Reason carried by the operation-owned signal when a consumer closes a stream early. */
  streamConsumerClosed: 'serialize stream consumer closed'
} as const

/**
 * Adds `source`, `code`, and optional `context` to a native error while retaining its runtime type
 * and `instanceof` behavior.
 */
export type ISerializeTaggedError<TError extends Error> = TError & {
  /** Package identity retained alongside the native error type. */
  readonly source: string
  /** Public serialize semantic failure code. */
  readonly code: ISerializeErrorCode
  /** Optional caller diagnostic label, absent when none was supplied. */
  readonly context?: string
}
/** Native TypeError carrying serialize classification without losing instanceof behavior. */
export type ISerializeTypeError = ISerializeTaggedError<TypeError>
/** Native RangeError carrying serialize classification without losing instanceof behavior. */
export type ISerializeRangeError = ISerializeTaggedError<RangeError>
/**
 * Tagged native error for construction and lifecycle failures. Inherits `cause` from `Error` and
 * can carry `errors`.
 */
export type ISerializeLifecycleError = ISerializeTaggedError<Error> & {
  /** Optional frozen secondary-error snapshot from the factory; cause stays independent. */
  readonly errors?: readonly unknown[]
}

/**
 * Attaches read-only `source`, `code`, and optional `context` and returns the original error. Never
 * rebuilds or replaces the error or overwrites its stack.
 *
 * Idempotent for matching `(source, code)`: returns the error and adds `context` only if not
 * already defined. Conflicting identity throws a `TypeError` instead of silently rewriting
 * immutable properties.
 */
export function tagSerializeError<E extends Error>(
  error: E,
  code: ISerializeErrorCode,
  context?: string
): ISerializeTaggedError<E> {
  const tagged = error as ISerializeTaggedError<E>
  const already = (error as { readonly source?: string }).source !== undefined
  if (already) {
    if (tagged.source === SERIALIZE_SOURCE && tagged.code === code) {
      if (context !== undefined && tagged.context === undefined) {
        Object.defineProperty(error, 'context', { value: context, enumerable: true })
      }
      return tagged
    }
    // The canonical owner supplies the coded conflict and retains the original error as cause.
    return attachErrorIdentity(error, {
      source: SERIALIZE_SOURCE,
      code
    }) as ISerializeTaggedError<E>
  }
  attachErrorIdentity(error, { source: SERIALIZE_SOURCE, code })
  if (context !== undefined) {
    Object.defineProperty(error, 'context', { value: context, enumerable: true })
  }
  return tagged
}

/**
 * Tags a standalone parser or conversion failure without rebuilding an annotatable native error.
 * Host codes or immutable errors need a coded TypeError wrapper; the exact original remains cause.
 * The utils attachment hooks own conflict detection instead of duplicating it in each parser.
 */
export function tagSerializeFailure(
  error: unknown,
  code: ISerializeErrorCode,
  message: string
): Error {
  if (!isNativeErrorValue(error)) return createSerializeError(code, message, { cause: error })
  return attachErrorIdentity(
    error,
    { source: SERIALIZE_SOURCE, code },
    {
      onConflict: () => createSerializeTypeError(code, message, { cause: error }),
      onFailure: () => createSerializeTypeError(code, message, { cause: error })
    }
  )
}

/**
 * Creates a native construction or lifecycle error, such as `REGISTRY_DISPOSED`, `ENV_UNSUPPORTED`,
 * or rollback failure. Attaches `source`, `code`, and optional `context`, `cause`, and `errors`.
 *
 * `errors` is a frozen snapshot copied after rollback completes. An empty list omits that property
 * and never replaces `cause`.
 */
export function createSerializeError(
  code: ISerializeErrorCode,
  message: string,
  options?: {
    /** Original non-undefined failure retained through Error.cause. */
    readonly cause?: unknown
    /** Optional operation label attached without changing error text. */
    readonly context?: string
    /** Secondary failures copied into a frozen array; an empty array omits the property. */
    readonly errors?: readonly unknown[]
  }
): ISerializeLifecycleError {
  const error = tagSerializeError(
    new Error(message, options?.cause !== undefined ? { cause: options.cause } : undefined),
    code,
    options?.context
  )
  if (options?.errors !== undefined && options.errors.length > 0) {
    Object.defineProperty(error, 'errors', {
      value: Object.freeze([...options.errors]),
      enumerable: true
    })
  }
  return error
}

/**
 * Creates a native `TypeError` with the supplied code, for example `INVALID_OPTION` for an invalid
 * scheduler. Optional context and non-undefined cause are retained; no input error is rewritten.
 */
export function createSerializeTypeError(
  code: ISerializeErrorCode,
  message: string,
  options?: { readonly cause?: unknown; readonly context?: string }
): ISerializeTypeError {
  return tagSerializeError(
    new TypeError(message, options?.cause !== undefined ? { cause: options.cause } : undefined),
    code,
    options?.context
  )
}

/**
 * Creates a native `RangeError` tagged for invalid input, such as an empty plugin list, duplicate
 * type, or illegal type. Optional context and non-undefined cause are retained by reference.
 */
export function createSerializeRangeError(
  code: ISerializeErrorCode,
  message: string,
  options?: { readonly cause?: unknown; readonly context?: string }
): ISerializeRangeError {
  return tagSerializeError(
    new RangeError(message, options?.cause !== undefined ? { cause: options.cause } : undefined),
    code,
    options?.context
  )
}
