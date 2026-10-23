import { inspectThenable, observeThenableRejection } from '@migaia/utils/function'
import type { ICollectedError, IErrorPolicy } from './types.js'
import { attachErrorIdentity, attachSecondaryErrors, tryReadProperty } from '@migaia/utils/error'
import { ERROR_SOURCE, LifecycleErrorCode } from './error-code.js'
import { LifecycleErrorText } from './error-text.js'
import { assertErrorPolicyReporter } from './error-boundary.js'

/** `source` value stamped onto every error this package throws. */
export const LIFECYCLE_SOURCE = ERROR_SOURCE

/**
 * The structural error contract every package in the workspace follows. Attached as properties on a
 * real `Error`, never used to replace it — callers that branch on `instanceof
 * DOMException`/`RangeError`/etc. keep working.
 */
export type ILifecycleError = Error & {
  readonly source: string
  readonly code: string
  readonly phase?: string
  readonly detail?: Readonly<Record<string, unknown>>
  readonly cause?: unknown
  /**
   * Stores a frozen, non-enumerable list of secondary failures such as cleanup errors, appended in
   * occurrence order. Keeps them separate from `cause` so the primary error retains its identity.
   */
  readonly errors?: readonly unknown[]
}

/** Attaches lifecycle identity with configurable descriptors for same-package reclassification. */
function attachLifecycleIdentity<T extends Error>(error: T, code: string): T {
  /** Existing source descriptor used to reject cross-package identity replacement. */
  const source = Object.getOwnPropertyDescriptor(error, 'source')
  if (source !== undefined && source.value !== LIFECYCLE_SOURCE) {
    return attachErrorIdentity(error, { source: LIFECYCLE_SOURCE, code })
  }
  if (source === undefined) {
    Object.defineProperty(error, 'source', {
      configurable: true,
      enumerable: true,
      value: LIFECYCLE_SOURCE,
      writable: false
    })
  }
  /** Existing lifecycle code descriptor, which may be reclassified at a later boundary. */
  const existingCode = Object.getOwnPropertyDescriptor(error, 'code')
  if (existingCode === undefined || existingCode.value !== code) {
    if (existingCode !== undefined && existingCode.configurable !== true) {
      return attachErrorIdentity(error, { source: LIFECYCLE_SOURCE, code })
    }
    Object.defineProperty(error, 'code', {
      configurable: true,
      enumerable: true,
      value: code,
      writable: false
    })
  }
  return error
}

/**
 * Builds a `(source, code)`-tagged error without ever touching `stack` — the engine populates it at
 * construction and this function never reassigns it, so the original throw site is always visible.
 */
export function createLifecycleError(
  code: string,
  message: string,
  options?: {
    readonly cause?: unknown
    readonly phase?: string
    readonly detail?: Readonly<Record<string, unknown>>
    readonly errors?: readonly unknown[]
  }
): ILifecycleError {
  const hasCause = options !== undefined && 'cause' in options
  const error = new Error(message, hasCause ? { cause: options.cause } : undefined)
  attachLifecycleIdentity(error, code)
  if (options?.phase !== undefined) {
    Object.defineProperty(error, 'phase', { value: options.phase, enumerable: true })
  }
  if (options?.detail !== undefined) {
    Object.defineProperty(error, 'detail', { value: options.detail, enumerable: true })
  }
  if (options?.errors !== undefined) attachSecondaryErrors(error, options.errors)
  return error as ILifecycleError
}

/**
 * Stamps `(source, code)` onto an error object we did not construct ourselves (e.g. a built-in
 * `AggregateError`) without touching `stack`, `message`, or `errors`. Used where the error's _type_
 * matters to callers (`AggregateError`) so `createLifecycleError`'s plain `Error` cannot be used.
 */
export function tagLifecycleError<E extends Error>(error: E, code: string): E {
  /** Existing source descriptor used to distinguish lifecycle-local reclassification. */
  const source = Object.getOwnPropertyDescriptor(error, 'source')
  /** Existing code descriptor whose configurability determines whether identity can be preserved. */
  const existingCode = Object.getOwnPropertyDescriptor(error, 'code')
  if (
    source?.value === LIFECYCLE_SOURCE &&
    existingCode !== undefined &&
    existingCode.value !== code &&
    existingCode.configurable === true
  ) {
    // Lifecycle deliberately reclassifies one primary Error as it crosses cancellation
    // boundaries. Preserve object identity while keeping cross-source conflicts fail-closed.
    Object.defineProperty(error, 'code', {
      configurable: true,
      enumerable: true,
      value: code,
      writable: false
    })
    return error
  }
  return attachLifecycleIdentity(error, code)
}

/**
 * Converts an arbitrary cleanup/listener throw into a lifecycle-boundary failure. Extensible
 * `Error` objects are tagged in place so callers retain identity and native type; primitive throws
 * (or objects that reject tagging) are wrapped with the original reachable through `cause`.
 */
export function createLifecycleFailure(
  code: string,
  message: string,
  error: unknown
): ILifecycleError {
  if (error !== null && (typeof error === 'object' || typeof error === 'function')) {
    /** Diagnostic getters are fallible input reads, not authority to replace the original throw. */
    const messageRead = tryReadProperty(error as { message?: unknown }, 'message')
    /** Preserve getter failures as secondary evidence while keeping the original value as cause. */
    const stackRead = tryReadProperty(error as { stack?: unknown }, 'stack')
    if (messageRead.threw || stackRead.threw)
      return createLifecycleError(code, message, {
        cause: error,
        errors: [
          ...(messageRead.threw ? [messageRead.error] : []),
          ...(stackRead.threw ? [stackRead.error] : [])
        ]
      })
    if (typeof messageRead.value !== 'string' || typeof stackRead.value !== 'string')
      return createLifecycleError(code, message, { cause: error })
    try {
      return tagLifecycleError(error as Error, code) as ILifecycleError
    } catch {
      // Frozen or already non-configurable errors cannot be retagged without replacing identity.
    }
  }
  return createLifecycleError(code, message, { cause: error })
}

/**
 * Creates a native `RangeError` for input validation and attaches the supplied code. Preserves the
 * native type required by `docs/contracts/error-codes.md`.
 */
export function createLifecycleRangeError(
  code: string,
  message: string,
  options?: { readonly cause?: unknown; readonly detail?: Readonly<Record<string, unknown>> }
): RangeError {
  const error = new RangeError(
    message,
    options?.cause === undefined ? undefined : { cause: options.cause }
  )
  tagLifecycleError(error, code)
  if (options?.detail !== undefined)
    Object.defineProperty(error, 'detail', { value: options.detail, enumerable: true })
  return error
}

/** Creates a lifecycle-tagged native TypeError without replacing its runtime type. */
export function createLifecycleTypeError(
  code: string,
  message: string,
  options?: { readonly cause?: unknown; readonly detail?: Readonly<Record<string, unknown>> }
): TypeError {
  /** Whether caller explicitly supplied a cause, including an intentional `undefined` throw. */
  const hasCause = options !== undefined && 'cause' in options
  const error = new TypeError(message, hasCause ? { cause: options.cause } : undefined)
  tagLifecycleError(error, code)
  if (options?.detail !== undefined)
    Object.defineProperty(error, 'detail', { value: options.detail, enumerable: true })
  return error
}

/** Collects errors under one of the four policies and produces the correct finalize behavior. */
export type IErrorCollector = {
  readonly policy: IErrorPolicy
  /** Records one item's failure. For `report`, this is also where the reporter is invoked. */
  add(source: string, error: unknown): void
  /**
   * Finalizes collection. `collect`/`report`/`firstError`-with-no-error return the collected list
   * (empty for `report`, since those were already handed to the reporter per `add`); `throw` and
   * `firstError`-with-an-error throw instead of returning.
   */
  finalize(message: string): readonly ICollectedError[]
}

export function createErrorCollector(
  policy: IErrorPolicy,
  report: ((error: unknown) => void) | undefined
): IErrorCollector {
  assertErrorPolicyReporter(policy, report)
  const entries: ICollectedError[] = []
  let firstError: unknown
  let hasFirstError = false

  /** Hands one failure to the configured reporter under the shared containment rules. */
  const invokeReport = (error: unknown): void => safeReport(report, error)

  return {
    policy,
    add(source, error) {
      // Existing semantic identities belong to their original package. Unclassified callback
      // failures receive this release boundary's code without replacing native objects.
      if (error === null || (typeof error !== 'object' && typeof error !== 'function'))
        error = createLifecycleFailure(
          LifecycleErrorCode.scopeDisposalFailed,
          LifecycleErrorText.disposeTransactionFailed,
          error
        )
      else {
        /** Only guarded reads may decide whether a caller already supplied semantic identity. */
        const identitySource = tryReadProperty(error as { source?: unknown }, 'source')
        /** A host code without a package source is still an unclassified lifecycle boundary error. */
        const identityCode = tryReadProperty(error as { code?: unknown }, 'code')
        if (
          identitySource.threw ||
          identityCode.threw ||
          typeof identitySource.value !== 'string' ||
          identitySource.value.length === 0 ||
          typeof identityCode.value !== 'string' ||
          identityCode.value.length === 0
        )
          error = createLifecycleFailure(
            LifecycleErrorCode.scopeDisposalFailed,
            LifecycleErrorText.disposeTransactionFailed,
            error
          )
      }
      if (policy === 'report') {
        invokeReport(error)
        return
      }
      if (policy === 'firstError') {
        if (!hasFirstError) {
          hasFirstError = true
          firstError = error
        } else {
          // 后续错误必须被观测，但不得改变「首错原样抛出」的结果。经 reporter 观测（与 `report`
          // 策略同通道），绝不静默吞掉；reporter 由创建方经 `assertErrorPolicyReporter` 保证存在。
          invokeReport(error)
        }
        return
      }
      entries.push({ source, error })
    },
    finalize(message) {
      if (policy === 'report') return []
      if (policy === 'firstError') {
        if (hasFirstError) throw firstError
        return []
      }
      if (policy === 'collect') return [...entries]
      // add() already preserves valid identities or annotates unclassified native failures.
      // A single failure remains the same instance; only multiple failures need an aggregate.
      if (entries.length === 1) throw entries[0]!.error
      if (entries.length > 1) {
        throw tagLifecycleError(
          new AggregateError(
            entries.map((entry) => entry.error),
            message
          ),
          LifecycleErrorCode.scopeDisposalFailed
        )
      }
      return []
    }
  }
}

/**
 * Delegates callback-result inspection to the canonical utils thenable boundary.
 *
 * `() => void` in TypeScript still accepts an `async` function. This guards a diagnostic/release
 * callback's return value for a thenable and observes its rejection, so a callback that turns out
 * to be `async` behind our backs doesn't surface as an unhandled rejection one microtask later .
 */
export function containAsyncRejection(value: unknown, onRejected: (error: unknown) => void): void {
  observeThenableRejection(value, inspectThenable(value), onRejected)
}

/**
 * Hands `error` to a caller-supplied reporter, the last error boundary of a lifecycle operation.
 * Reporter failures go through utils' shared host exception queue, preserving secondary failure
 * traceability without creating unhandled Promise rejections. An absent reporter is a no-op.
 */
export function safeReport(report: ((error: unknown) => void) | undefined, error: unknown): void {
  if (!report) return
  try {
    const result: unknown = report(error)
    containAsyncRejection(result, (reporterError) => {
      throw reporterError // utils owns the terminal host exception queue for reporter failures.
    })
  } catch (reporterError) {
    observeThenableRejection(undefined, { error: reporterError }, (failure) => {
      throw failure
    })
  }
}
