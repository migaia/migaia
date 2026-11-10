import { inspectThenable, observeThenableRejection } from '@migaia/utils/function'
import type { ICollectedError, IErrorPolicy } from './types.ts'
import {
  attachErrorIdentity,
  attachSecondaryErrors,
  tryReadProperty,
  type IErrorIdentity,
  type IErrorIdentityHooks
} from '@migaia/utils/error'
import { ERROR_SOURCE, LifecycleErrorCode } from './error-code.ts'
import { LifecycleErrorText } from './error-text.ts'
import { assertErrorPolicyReporter } from './error-boundary.ts'

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

/**
 * Rewrites a configurable lifecycle `code` in place when one primary error crosses a cancellation
 * boundary and is reclassified. Every other identity conflict (a foreign `source`, a locked `code`)
 * fails closed with the utils conflict error, exactly as a plain `attachErrorIdentity` call would.
 */
function reclassifyLifecycleCode(context: {
  readonly target: Error
  readonly key: string
  readonly incoming: unknown
}): Error {
  /** Only an existing configurable code written by lifecycle itself may be rewritten. */
  const descriptor =
    context.key === 'code' ? Object.getOwnPropertyDescriptor(context.target, 'code') : undefined
  if (descriptor?.configurable === true) {
    Object.defineProperty(context.target, 'code', {
      configurable: true,
      enumerable: true,
      value: context.incoming,
      writable: false
    })
    return context.target
  }
  /** Current identity with the conflicting key replaced, so utils raises its own conflict error. */
  const identity = {
    source: Object.getOwnPropertyDescriptor(context.target, 'source')?.value,
    code: Object.getOwnPropertyDescriptor(context.target, 'code')?.value,
    [context.key]: context.incoming
  } as IErrorIdentity
  return attachErrorIdentity(context.target, identity)
}

/**
 * Identity hooks for every error lifecycle throws: `source`/`code` stay configurable so lifecycle
 * can reclassify its own primary error in place; conflicts follow `reclassifyLifecycleCode`.
 */
export const lifecycleIdentity: IErrorIdentityHooks<Error> = {
  reclassifiable: true,
  onConflict: (context) => reclassifyLifecycleCode(context)
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
      return attachSecondaryErrors(
        attachErrorIdentity(
          new Error(message, { cause: error }),
          { source: LIFECYCLE_SOURCE, code },
          lifecycleIdentity
        ),
        [
          ...(messageRead.threw ? [messageRead.error] : []),
          ...(stackRead.threw ? [stackRead.error] : [])
        ]
      ) as ILifecycleError
    if (typeof messageRead.value !== 'string' || typeof stackRead.value !== 'string')
      return attachErrorIdentity(
        new Error(message, { cause: error }),
        { source: LIFECYCLE_SOURCE, code },
        lifecycleIdentity
      ) as ILifecycleError
    try {
      return attachErrorIdentity(
        error as Error,
        { source: LIFECYCLE_SOURCE, code },
        lifecycleIdentity
      ) as ILifecycleError
    } catch {
      // Frozen or already non-configurable errors cannot be retagged without replacing identity.
    }
  }
  return attachErrorIdentity(
    new Error(message, { cause: error }),
    { source: LIFECYCLE_SOURCE, code },
    lifecycleIdentity
  ) as ILifecycleError
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
        throw attachErrorIdentity(
          new AggregateError(
            entries.map((entry) => entry.error),
            message
          ),
          { source: LIFECYCLE_SOURCE, code: LifecycleErrorCode.scopeDisposalFailed },
          lifecycleIdentity
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
