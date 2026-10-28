import { observeThenableRejection, probeThenable, ThenableProbeKind } from '@migaia/utils/function'
import {
  createErrorCollector,
  createLifecycleError,
  createLifecycleFailure,
  safeReport
} from './errors.ts'
import { LifecycleErrorCode } from './error-code.ts'
import { LifecycleErrorText } from './error-text.ts'
import type { IAdmissionBatch } from './dispose-transaction.ts'
import type { ICollectedError, IErrorPolicy, IReleaseContext, IReleaseDescriptor } from './types.ts'

type ICallbackOutcome = { readonly ok: true } | { readonly ok: false; readonly error: unknown }

/** Runs one synchronous callback and rejects thenable results without adding an await boundary. */
function runSyncCallback(
  callback: (context: IReleaseContext) => void | PromiseLike<void>,
  context: IReleaseContext,
  reportLate: (error: unknown) => void
): ICallbackOutcome {
  /** Callback output retained for a single thenable admission read. */
  let result: void | PromiseLike<void>
  try {
    result = callback(context)
  } catch (error) {
    return { ok: false, error }
  }
  // 单次探测：hostile `.then` getter 的异常也必须作为本项失败进入 error policy，绝不逃逸出释放循环。
  /** Captured getter failure belongs to this item rather than escaping the release plan. */
  const probe = probeThenable(result)
  if (probe.kind === ThenableProbeKind.failed) return { ok: false, error: probe.error }
  if (probe.kind === 'thenable') {
    // oxlint-disable-next-line unicorn/no-thenable -- Reuse the already captured PromiseLike method without reading its getter twice.
    observeThenableRejection(result, { then: probe.thenFn }, reportLate)
    return {
      ok: false,
      error: createLifecycleError(
        LifecycleErrorCode.scopeSyncViolation,
        LifecycleErrorText.syncCallbackReturnedThenable
      )
    }
  }
  return { ok: true }
}

/**
 * Same degrade order as the async path (custom skips the rest; graceful throwing still runs force),
 * minus any timeout race — there is nothing to await.
 */
function executeSyncDescriptor(
  descriptor: IReleaseDescriptor,
  context: IReleaseContext,
  reportLate: (error: unknown) => void
): readonly unknown[] {
  if (descriptor.custom) {
    /** Custom release owns the complete chain, so no fallback phase runs afterwards. */
    const outcome = runSyncCallback(descriptor.custom, context, reportLate)
    return outcome.ok ? [] : [outcome.error]
  }
  /** Failed graceful and force phases remain ordered without replacing the original errors. */
  const errors: unknown[] = []
  if (descriptor.graceful) {
    /** Successful graceful release skips force; a failure keeps the forced fallback active. */
    const gracefulOutcome = runSyncCallback(descriptor.graceful, context, reportLate)
    if (gracefulOutcome.ok) return []
    errors.push(gracefulOutcome.error)
  }
  /** Final synchronous fallback contributes its own raw failure when it cannot release. */
  const forceOutcome = runSyncCallback(descriptor.force, context, reportLate)
  if (!forceOutcome.ok) errors.push(forceOutcome.error)
  return errors
}

/**
 * Executes an already-admitted synchronous release plan without yielding. Admission and ordering
 * are shared with DisposeTransaction; this executor owns only the sync-only callback contract. Each
 * item receives a fresh owner-created context, preserving synchronous scope callback identity.
 */
export function executeSyncDisposeTransaction(
  admission: IAdmissionBatch,
  createContext: () => IReleaseContext,
  errorPolicy: IErrorPolicy,
  report: ((error: unknown) => void) | undefined
): readonly ICollectedError[] {
  /** Policy collector receives all admission failures before any resource callback runs. */
  const collector = createErrorCollector(errorPolicy, report)
  /** Late callback failure cannot enter an already-returned sync result; use the existing reporter. */
  const reportLate = (error: unknown): void => {
    /** Tag an annotatable original; immutable/primitive failures remain reachable through cause. */
    const failure = createLifecycleFailure(
      LifecycleErrorCode.scopeSyncViolation,
      LifecycleErrorText.syncCallbackReturnedThenable,
      error
    )
    if (report) safeReport(report, failure)
    else throw failure // utils observes this reporter failure through its shared host exception queue.
  }
  for (const item of admission.rejected) collector.add(item.source, item.error)
  for (const item of admission.admitted) {
    /** Fresh context keeps the scope's established per-item callback boundary. */
    const context = createContext()
    /** Raw failures retain native type and identity until the policy handles them. */
    const errors = executeSyncDescriptor(item.descriptor, context, reportLate)
    for (const error of errors) collector.add(item.source, error)
  }
  return collector.finalize(LifecycleErrorText.syncScopeDisposalFailed)
}
