/** Resource-owned failure construction; preserves existing native errors, causes and text. */
import { attachSecondaryErrors, tryReadProperty } from '@migaia/utils/error'
import {
  createResourceError,
  RESOURCE_SOURCE,
  tagResourceError,
  type IResourceError
} from './errors.ts'
import { ResourceErrorCode } from './error-code.ts'
import { ResourceErrorText } from './error-text.ts'

/** Reuses a Resource reason, otherwise retains the lower lifecycle reason on the native AbortError. */
export function abortError(...causes: [] | [unknown]): DOMException {
  /** Existing Resource-initiated cancellation is already the canonical native rejection. */
  const reason = causes[0]
  if (reason instanceof DOMException) {
    /** Read semantic identity safely; native DOMException.code alone is numeric. */
    const source = tryReadProperty(reason as { source?: unknown }, 'source')
    /** Resource semantic code is checked separately from DOMException numeric code. */
    const code = tryReadProperty(reason as { code?: unknown }, 'code')
    if (
      !source.threw &&
      !code.threw &&
      source.value === RESOURCE_SOURCE &&
      code.value === ResourceErrorCode.requestAborted
    )
      return reason
  }
  /**
   * DOMException has no ErrorOptions constructor, so preserve its native type with an attached
   * cause.
   */
  const error = tagResourceError(
    new DOMException(ResourceErrorText.requestAborted, ResourceErrorText.abortName),
    ResourceErrorCode.requestAborted
  )
  if (causes.length > 0)
    Object.defineProperty(error, 'cause', { value: reason, configurable: true })
  return error
}

/** Native explicit-cancellation state error; kept distinct from request rejection. */
export class ResourceCancelledError extends DOMException {
  /** Creates the same canonical AbortError with the explicit-cancel semantic code. */
  constructor() {
    super(ResourceErrorText.requestCancelled, ResourceErrorText.abortName)
    tagResourceError(this, ResourceErrorCode.requestCancelled)
  }
}

/** Creates a native option type error while preserving a hostile getter as its cause. */
export function createResourceOptionTypeError(message: string, cause?: unknown): IResourceError {
  /** Native TypeError identity remains the public option failure. */
  const error = new TypeError(message, cause === undefined ? undefined : { cause })
  return tagResourceError(error, ResourceErrorCode.invalidOption) as IResourceError
}

/** Wraps scheduler admission/cleanup failures without losing the original failure identity. */
export function createSchedulerFailure(error: unknown): IResourceError {
  return createResourceError(
    ResourceErrorCode.invalidOption,
    ResourceErrorText.schedulerTaskOperationFailed,
    { cause: error }
  )
}

/** Identifies the Resource-owned wrapper so passive reads do not wrap one clock failure twice. */
export function isSchedulerFailure(error: unknown): error is IResourceError {
  return (
    error !== null &&
    (typeof error === 'object' || typeof error === 'function') &&
    (error as { readonly source?: unknown }).source === RESOURCE_SOURCE &&
    (error as { readonly code?: unknown }).code === ResourceErrorCode.invalidOption &&
    (error as { readonly message?: unknown }).message ===
      ResourceErrorText.schedulerTaskOperationFailed
  )
}

/** Wraps abort-signal registration failures without exposing a raw host error. */
export function createSignalRegistrationFailure(error: unknown): IResourceError {
  return createResourceError(
    ResourceErrorCode.invalidOption,
    ResourceErrorText.signalRegistrationFailed,
    { cause: error }
  )
}

/** Reclassifies cancellation cleanup failures without confusing them with the cancelled state. */
export function createCancellationFailure(error: unknown): IResourceError {
  if (
    error !== null &&
    (typeof error === 'object' || typeof error === 'function') &&
    (error as { source?: unknown }).source === RESOURCE_SOURCE
  ) {
    return tagResourceError(error, ResourceErrorCode.cancellationCleanupFailed) as IResourceError
  }
  return createResourceError(
    ResourceErrorCode.cancellationCleanupFailed,
    ResourceErrorText.cancellationCleanupFailed,
    { cause: error }
  )
}

/** Keeps later Resource teardown failures reachable while preserving its package fallback. */
export const appendDisposeCleanupErrors = (
  primary: unknown,
  cleanupErrors: readonly unknown[]
): unknown => {
  if (cleanupErrors.length === 0) return primary
  /** Existing attachment behavior may retain or replace the primary. */
  const attached = attachSecondaryErrors(primary, cleanupErrors)
  if (attached === primary) return primary
  /** Fallback keeps the original primary reachable when direct attachment is unavailable. */
  const fallback = createResourceError(
    ResourceErrorCode.cancellationCleanupFailed,
    ResourceErrorText.cancellationCleanupFailed,
    { cause: primary }
  )
  return attachSecondaryErrors(fallback, [primary, ...cleanupErrors])
}

/** Creates the original setup-contract native TypeError without changing its identity or text. */
export function createResourceSetupError(code: string, message: string): TypeError {
  return tagResourceError(new TypeError(message), code)
}
