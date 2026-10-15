import { attachSecondaryErrors, safeErrorReason } from '@migaia/utils/error'
import type { IErrorPolicy } from './types.js'
import { LifecycleErrorCode } from './error-code.js'
import { LifecycleErrorText } from './error-text.js'
import { createLifecycleTypeError, tagLifecycleError } from './errors.js'

/**
 * Lifecycle's single entry point for attaching secondary failures (cleanup, rollback, cancellation)
 * to a primary failure. Delegates to `@migaia/utils/error` `attachSecondaryErrors`, which appends
 * to any existing `errors` list as a non-enumerable, frozen array and keeps the primary's identity.
 * Entries identical to the primary and repeated entries are dropped first. When the primary cannot
 * carry the list (primitive, frozen, hostile `errors` accessor), the returned `AggregateError`
 * fallback lists the primary first, takes the primary's reason (or `fallbackMessage`) as its
 * message and is tagged with `fallbackCode` (`SCOPE_DISPOSAL_FAILED` unless the call site owns a
 * narrower code). Returns the value the caller must throw or reject with.
 */
export function attachLifecycleSecondaryErrors(
  primary: unknown,
  secondaryErrors: readonly unknown[],
  fallbackMessage: string,
  fallbackCode: string = LifecycleErrorCode.scopeDisposalFailed
): unknown {
  /** Secondary failures without the primary itself or repeated objects, in first-seen order. */
  const distinct = secondaryErrors.filter(
    (error, index) => error !== primary && secondaryErrors.indexOf(error) === index
  )
  /** Either the primary (attached in place) or utils' freshly built AggregateError fallback. */
  const attached = attachSecondaryErrors(primary, distinct)
  if (attached === primary) return primary
  // The fallback aggregate is a fresh object owned by this call, so giving it a message is safe.
  Object.defineProperty(attached, 'message', {
    configurable: true,
    enumerable: false,
    value: safeErrorReason(primary, fallbackMessage),
    writable: true
  })
  return tagLifecycleError(attached as AggregateError, fallbackCode)
}

/**
 * Rejects, at the creating factory, an error policy whose only observation channel is a reporter
 * that was not supplied. `report` hands every failure to the reporter and `firstError` hands every
 * failure after the first to it; without one those failures would vanish (X2=a, LC-B5). Throws an
 * `INVALID_OPTION` TypeError carrying `detail.field = 'report'`.
 */
export function assertErrorPolicyReporter(
  policy: IErrorPolicy,
  report: ((error: unknown) => void) | undefined
): void {
  if (policy !== 'report' && policy !== 'firstError') return
  if (typeof report === 'function') return
  throw createLifecycleTypeError(
    LifecycleErrorCode.invalidOption,
    LifecycleErrorText.errorPolicyReporterMissing,
    { detail: { field: 'report', errorPolicy: policy } }
  )
}
