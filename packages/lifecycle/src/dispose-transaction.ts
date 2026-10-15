import { assimilateCapturedThen, probeThenable, ThenableProbeKind } from '@migaia/utils/function'
import { defaultLifecycleScheduler } from './scheduler.js'
import { assertErrorPolicyReporter, attachLifecycleSecondaryErrors } from './error-boundary.js'
import { safeReport } from './errors.js'
import type { ICollectedError, IErrorPolicy, IReleaseContext, IReleaseDescriptor } from './types.js'
import type { IDisposerContext } from './disposer-context.js'
import { createErrorCollector, createLifecycleError, createLifecycleTypeError } from './errors.js'
import { LifecycleErrorCode } from './error-code.js'
import { LifecycleErrorText } from './error-text.js'
import { boundedWait } from './bounded-wait.js'
import type { IScheduler } from '@migaia/utils/scheduler'
import {
  resolveSchedulerOption,
  addSchedulerTime,
  validateSchedulerDelay,
  validateSchedulerTime
} from './scheduler.js'
import type { IAbortSignal } from '@migaia/utils/promise'
import { captureAbortControllerFactory } from './abort-factory.js'
import {
  observeAbortSubscription,
  type IObservedAbortSubscription
} from './observed-subscription.js'
import { DisposeTransactionKind } from './state-constants.js'

type ICallbackOutcome = { readonly ok: true } | { readonly ok: false; readonly error: unknown }

/** Stable non-aborting signal for transactions without an external cancellation source. */
const inertReleaseSignal: IAbortSignal = Object.freeze({
  aborted: false,
  addEventListener: (): void => undefined,
  removeEventListener: (): void => undefined
})

/**
 * 一次读取的 thenable 归化：非 thenable → `not-thenable`；getter 失败 → `failed`（原 getter 错误）；否则把捕获的 `thenFn`
 * apply 一次成 Promise。禁止把探测异常静默改写（与 `probeThenable` 同一契约）。
 */
const assimilateThenable = (
  value: unknown
):
  | { readonly kind: typeof ThenableProbeKind.notThenable }
  | { readonly kind: typeof ThenableProbeKind.failed; readonly error: unknown }
  | { readonly kind: typeof ThenableProbeKind.thenable; readonly promise: Promise<void> } => {
  const probe = probeThenable(value)
  if (probe.kind === ThenableProbeKind.notThenable) return { kind: ThenableProbeKind.notThenable }
  if (probe.kind === ThenableProbeKind.failed)
    return { kind: ThenableProbeKind.failed, error: probe.error }
  return {
    kind: ThenableProbeKind.thenable,
    promise: assimilateCapturedThen<void>(probe.thenFn, value)
  }
}

/** A synchronous result, or a Promise of it once a release callback returned a thenable (LC-P4). */
type IMaybePromise<T> = T | Promise<T>

/** Shared successful callback outcome; outcomes are read-only, so one instance serves every call. */
const callbackSucceeded: ICallbackOutcome = Object.freeze({ ok: true })

/**
 * Runs one release callback. Stays synchronous when the callback returns a non-thenable, so an
 * all-synchronous release chain costs no microtask turn; only a thenable result yields a Promise.
 */
function runCallback(
  callback: (context: IReleaseContext) => void | PromiseLike<void>,
  context: IReleaseContext
): IMaybePromise<ICallbackOutcome> {
  let result: void | PromiseLike<void>
  try {
    result = callback(context)
  } catch (error) {
    return { ok: false, error }
  }
  const assimilated = assimilateThenable(result)
  if (assimilated.kind === ThenableProbeKind.failed) return { ok: false, error: assimilated.error }
  if (assimilated.kind === 'not-thenable') return callbackSucceeded
  return assimilated.promise.then(
    () => callbackSucceeded,
    (error: unknown): ICallbackOutcome => ({ ok: false, error })
  )
}

/**
 * Caps a graceful phase's own budget by whatever remains of the transaction's shared deadline.
 * `now` is read once by the caller so the deadline and the "already elapsed" check share a single
 * clock sample (no drift between the two).
 */
function computeEffectiveDeadline(
  gracefulTimeoutMs: number | undefined,
  sharedDeadlineAt: number | undefined,
  now: number
): number | undefined {
  if (gracefulTimeoutMs === undefined) return sharedDeadlineAt
  const ownDeadline = addSchedulerTime(now, gracefulTimeoutMs, 'graceful deadline')
  if (sharedDeadlineAt === undefined) return ownDeadline
  return Math.min(ownDeadline, sharedDeadlineAt)
}

type IGracefulOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: unknown }
  | { readonly ok: false; readonly timedOut: true }

/**
 * Runs `graceful` against its budget. A synchronous graceful settles synchronously (LC-P4); a
 * thenable result continues in `awaitGraceful` with the clock sample taken before user code ran.
 */
function raceGraceful(
  graceful: (context: IReleaseContext) => void | PromiseLike<void>,
  context: IReleaseContext,
  gracefulTimeoutMs: number | undefined
): IMaybePromise<IGracefulOutcome> {
  // Start the graceful budget before user code runs so synchronous work cannot earn a fresh
  // timeout after it has already consumed the caller's budget.
  const scheduler = context.scheduler ?? defaultLifecycleScheduler
  const start = scheduler.now()
  const effectiveDeadline = computeEffectiveDeadline(gracefulTimeoutMs, context.deadlineAt, start)
  let result: void | PromiseLike<void>
  try {
    result = graceful(context)
  } catch (error) {
    return { ok: false, error }
  }
  const assimilated = assimilateThenable(result)
  if (assimilated.kind === ThenableProbeKind.failed) return { ok: false, error: assimilated.error }
  if (assimilated.kind === 'not-thenable') {
    // A synchronous graceful that returned has already released the resource, so it counts as
    // success even past its budget; running `force` now would release the same resource twice.
    // The overrun stays observable as a diagnostic only.
    if (effectiveDeadline !== undefined && scheduler.now() >= effectiveDeadline) {
      context.report(
        createLifecycleError(
          LifecycleErrorCode.deadlineExceeded,
          LifecycleErrorText.syncGracefulOverBudget
        )
      )
    }
    return callbackSucceeded
  }
  return awaitGraceful(assimilated.promise, context, scheduler, start, effectiveDeadline)
}

/** Waits for an asynchronous graceful phase within its effective deadline. */
async function awaitGraceful(
  promise: Promise<void>,
  context: IReleaseContext,
  scheduler: IScheduler,
  start: number,
  effectiveDeadline: number | undefined
): Promise<IGracefulOutcome> {
  if (effectiveDeadline === undefined) {
    try {
      await promise
      return callbackSucceeded
    } catch (error) {
      return { ok: false, error }
    }
  }
  if (effectiveDeadline <= start) {
    // The shared budget was already spent by an earlier item before this one even got a chance to
    // try — there is no point racing a wait against a deadline that has already passed. Surface it
    // as a diagnostic (not an item error — timing out is a normal degrade path) and go straight to
    // `force`.
    context.report(
      createLifecycleError(
        LifecycleErrorCode.deadlineExceeded,
        LifecycleErrorText.sharedDeadlinePassed
      )
    )
    return { ok: false, timedOut: true }
  }
  try {
    const won = await boundedWait(promise, effectiveDeadline, { scheduler })
    return won ? callbackSucceeded : { ok: false, timedOut: true }
  } catch (error) {
    return { ok: false, error }
  }
}

/** Shared empty error list for a fully successful release; never mutated. */
const noReleaseErrors: readonly unknown[] = Object.freeze([])

/**
 * Runs the descriptor's degrade chain for exactly one resource: `custom` (if present, skips
 * everything else) — otherwise `graceful` (if present, with its timeout) — then `force`.
 *
 * Returns every error raised along the way (empty on full success) instead of throwing, so the
 * caller can attribute them to the right item and fold them into whatever error policy is active.
 * `graceful` throwing (not timing out) does not stop `force` from running (L-T24); a `graceful`
 * timeout abandons waiting without cancelling it and silently proceeds to `force` (L-T23). The
 * result is synchronous while every callback returns synchronously (LC-P4). `context` must already
 * be admitted: the transaction builds its own, and `executeReleaseDescriptor` normalizes a public
 * one.
 */
function executeAdmittedReleaseDescriptor(
  descriptor: IReleaseDescriptor,
  context: IReleaseContext
): IMaybePromise<readonly unknown[]> {
  if (descriptor.custom) {
    const outcome = runCallback(descriptor.custom, context)
    return outcome instanceof Promise ? outcome.then(outcomeErrors) : outcomeErrors(outcome)
  }
  const errors: unknown[] = []
  if (descriptor.graceful) {
    const gracefulOutcome = raceGraceful(descriptor.graceful, context, descriptor.gracefulTimeoutMs)
    return gracefulOutcome instanceof Promise
      ? gracefulOutcome.then((outcome) =>
          continueAfterGraceful(descriptor, context, errors, outcome)
        )
      : continueAfterGraceful(descriptor, context, errors, gracefulOutcome)
  }
  return runForce(descriptor, context, errors)
}

/** Maps a `custom` callback outcome to the item's error list. */
const outcomeErrors = (outcome: ICallbackOutcome): readonly unknown[] =>
  outcome.ok ? noReleaseErrors : [outcome.error]

/** Ends the chain on graceful success; otherwise records a graceful throw and runs `force`. */
function continueAfterGraceful(
  descriptor: IReleaseDescriptor,
  context: IReleaseContext,
  errors: unknown[],
  outcome: IGracefulOutcome
): IMaybePromise<readonly unknown[]> {
  if (outcome.ok) return noReleaseErrors
  if (!('timedOut' in outcome)) errors.push(outcome.error)
  return runForce(descriptor, context, errors)
}

/** Runs `force`, the unconditional last phase, and appends its failure to `errors`. */
function runForce(
  descriptor: IReleaseDescriptor,
  context: IReleaseContext,
  errors: unknown[]
): IMaybePromise<readonly unknown[]> {
  const forceOutcome = runCallback(descriptor.force, context)
  return forceOutcome instanceof Promise
    ? forceOutcome.then((outcome) => finishForce(context, errors, outcome))
    : finishForce(context, errors, forceOutcome)
}

/** Records a failed `force` on the diagnostic channel and in the item's error list. */
function finishForce(
  context: IReleaseContext,
  errors: unknown[],
  forceOutcome: ICallbackOutcome
): readonly unknown[] {
  if (!forceOutcome.ok) {
    // The collector keeps the raw, caller-produced error untouched (so `throw` policy's single-error
    // case still throws it exactly as-is) — this tagged wrapper is a parallel diagnostic channel
    // only, carrying `(source, code)` for callers that want that without losing the raw error's own
    // identity/type.
    context.report(
      createLifecycleError(
        LifecycleErrorCode.releaseForceFailed,
        LifecycleErrorText.releaseForceFailed,
        {
          cause: forceOutcome.error
        }
      )
    )
    errors.push(forceOutcome.error)
  }
  return errors
}

/**
 * Reads a caller-supplied release context once and re-admits its scheduler, so the public
 * `executeReleaseDescriptor` path sees one stable snapshot. Accessor failures become
 * `INVALID_OPTION`; an invalid `deadlineAt` throws its clock-domain error.
 */
function normalizeReleaseContext(context: IReleaseContext): IReleaseContext {
  let signal: IReleaseContext['signal']
  let deadlineAt: number | undefined
  let schedulerOption: unknown
  let report: IReleaseContext['report']
  let disposer: IReleaseContext['disposer']
  try {
    signal = context.signal
    deadlineAt = context.deadlineAt
    schedulerOption = context.scheduler
    report = context.report
    disposer = context.disposer
  } catch (error) {
    throw createLifecycleTypeError(
      LifecycleErrorCode.invalidOption,
      LifecycleErrorText.schedulerAccessorFailed,
      { cause: error, detail: { field: 'scheduler' } }
    )
  }
  if (deadlineAt !== undefined) validateSchedulerTime(deadlineAt, 'deadlineAt')
  const scheduler = resolveSchedulerOption({ scheduler: schedulerOption })
  const hasSchedulerGetter =
    Object.getOwnPropertyDescriptor(context, 'scheduler')?.get !== undefined
  return scheduler === undefined && !hasSchedulerGetter
    ? context
    : {
        signal,
        deadlineAt,
        scheduler,
        report,
        disposer
      }
}

/** Admits a public release descriptor once before executing its degrade chain. */
export async function executeReleaseDescriptor(
  descriptor: IReleaseDescriptor,
  context: IReleaseContext
): Promise<readonly unknown[]> {
  const admission = admitDescriptor(descriptor, false)
  if (!admission.ok) return [admission.error]
  return executeAdmittedReleaseDescriptor(admission.descriptor, normalizeReleaseContext(context))
}

export type IDisposeItem = {
  readonly source: string
  readonly descriptor: IReleaseDescriptor
}

type IAdmittedDisposeItem = {
  readonly source: string
  readonly descriptor: IReleaseDescriptor
}

type IDescriptorAdmission =
  | { readonly ok: true; readonly descriptor: IReleaseDescriptor }
  | { readonly ok: false; readonly error: unknown }

export type IAdmissionBatch = {
  readonly admitted: readonly IAdmittedDisposeItem[]
  readonly rejected: readonly ICollectedError[]
}

/**
 * `order` (weak): `DisposeTransaction` groups by `descriptor.order` (missing = `0`, higher values
 * first) and reads no other ordering signal — callers must already hand items in the sequence ties
 * should break in (LIFO), since the group sort is stable.
 *
 * `plan` (strong): items run in exactly the given sequence; `descriptor.order` is never read.
 *
 * §4.6: a single transaction instance never mixes the two.
 */
export type IDisposeTransactionMode =
  | { readonly kind: typeof DisposeTransactionKind.order }
  | { readonly kind: typeof DisposeTransactionKind.plan }

export type IDisposeTransactionOptions = {
  readonly errorPolicy?: IErrorPolicy
  /**
   * Reporter for failures the error policy does not throw or collect. Required when `errorPolicy`
   * is `report` or `firstError`; otherwise the factory throws `INVALID_OPTION` with `detail.field:
   * 'report'`.
   */
  readonly report?: (error: unknown) => void
  /** Absolute deadline shared, unchanged, across every item in this run (L-T32). */
  readonly deadlineAt?: number
  /**
   * Uses the scheduler whose `now()` produces `deadlineAt` under the R-9 clock-domain contract.
   * Defaults to `systemScheduler`. Forwards it to every item's `context.scheduler` and the
   * graceful-phase `boundedWait`.
   */
  readonly scheduler?: IScheduler
  /** Mirrored into every item's context; run() does not abort the caller-owned input signal. */
  readonly signal?: IAbortSignal
  /** Owner-bound self-join capability, supplied only by a LifecycleScope owner. */
  readonly disposer?: IDisposerContext
  /** Awaited after every item settles, so in-flight work started by a release can still be drained. */
  readonly pending?: { drain(): Promise<void> }
}

export type IDisposeTransaction = {
  readonly mode: IDisposeTransactionMode
  run(items: readonly IDisposeItem[]): Promise<readonly ICollectedError[]>
}

/** Creates one tagged lifecycle error for a descriptor value that violates admission shape. */
const invalidDescriptor = (field: string): unknown =>
  createLifecycleError(
    LifecycleErrorCode.invalidOption,
    LifecycleErrorText.disposeDescriptorInvalid,
    {
      detail: { field }
    }
  )

/**
 * Reads every descriptor value used by release exactly once and turns it into plain data. A getter
 * failure remains the caller's original error; an invalid value receives the lifecycle
 * invalid-option code. Order is read only for order-mode transactions, preserving plan-mode's
 * order-blind contract.
 *
 * Package-internal (not exported from the index): scope `own()` calls it as a validation-only entry
 * check and discards the snapshot; release still re-admits the descriptor at dispose time.
 */
export const admitDescriptor = (
  descriptor: IReleaseDescriptor,
  includeOrder: boolean
): IDescriptorAdmission => {
  let order: unknown
  let custom: unknown
  let graceful: unknown
  let gracefulTimeoutMs: unknown
  let force: unknown
  try {
    if (includeOrder) order = descriptor.order
    custom = descriptor.custom
    graceful = descriptor.graceful
    gracefulTimeoutMs = descriptor.gracefulTimeoutMs
    force = descriptor.force
  } catch (error) {
    return { ok: false, error }
  }
  if (
    includeOrder &&
    order !== undefined &&
    (typeof order !== 'number' || !Number.isFinite(order))
  ) {
    return { ok: false, error: invalidDescriptor('order') }
  }
  if (custom !== undefined && typeof custom !== 'function') {
    return { ok: false, error: invalidDescriptor('custom') }
  }
  if (graceful !== undefined && typeof graceful !== 'function') {
    return { ok: false, error: invalidDescriptor('graceful') }
  }
  if (gracefulTimeoutMs !== undefined) {
    try {
      validateSchedulerDelay(gracefulTimeoutMs, 'gracefulTimeoutMs')
    } catch (error) {
      return { ok: false, error }
    }
  }
  if (typeof force !== 'function') return { ok: false, error: invalidDescriptor('force') }

  const admitted: IReleaseDescriptor = {
    ...(includeOrder ? { order: (order as number | undefined) ?? 0 } : {}),
    custom: custom as IReleaseDescriptor['custom'],
    graceful: graceful as IReleaseDescriptor['graceful'],
    gracefulTimeoutMs: gracefulTimeoutMs as IReleaseDescriptor['gracefulTimeoutMs'],
    force: force as IReleaseDescriptor['force']
  }
  return { ok: true, descriptor: admitted }
}

/**
 * Admits descriptors independently before any release callback runs. Rejected items are excluded
 * from execution but retained as policy inputs; valid order-mode items are then stably sorted from
 * their already-snapshotted numeric keys, so no hostile accessor can abort the batch. Sync scopes
 * additionally retain their existing syncSafe getter read; registration already validates its
 * value.
 */
export const admitItems = (
  items: readonly IDisposeItem[],
  mode: IDisposeTransactionMode,
  snapshotSyncMarker = false
): IAdmissionBatch => {
  const admitted: IAdmittedDisposeItem[] = []
  const rejected: ICollectedError[] = []
  const includeOrder = mode.kind === DisposeTransactionKind.order
  const itemCount = items.length
  for (let index = 0; index < itemCount; index++) {
    const item = items[index]
    if (item === undefined) {
      rejected.push({ source: 'transaction', error: invalidDescriptor('item') })
      continue
    }
    let source = 'transaction'
    try {
      source = item.source
      /** Read the item descriptor once, including the sync scope's established marker read. */
      const descriptor = item.descriptor
      if (snapshotSyncMarker) void descriptor.syncSafe
      const admission = admitDescriptor(descriptor, includeOrder)
      if (!admission.ok) {
        rejected.push({ source, error: admission.error })
        continue
      }
      admitted.push({ source, descriptor: admission.descriptor })
    } catch (error) {
      rejected.push({ source, error })
    }
  }
  if (mode.kind === DisposeTransactionKind.plan) return { admitted, rejected }
  // Stable sort: ties (equal order) keep the caller-supplied relative sequence.
  admitted.sort((a, b) => (b.descriptor.order ?? 0) - (a.descriptor.order ?? 0))
  return { admitted, rejected }
}

export function createDisposeTransaction(
  mode: IDisposeTransactionMode,
  options: IDisposeTransactionOptions = {}
): IDisposeTransaction {
  const errorPolicy = options.errorPolicy ?? 'throw'
  const scheduler = resolveSchedulerOption(options)
  const report = options.report
  assertErrorPolicyReporter(errorPolicy, report)
  const deadlineAt = options.deadlineAt
  const signalOption = options.signal
  const pending = options.pending
  const createController = captureAbortControllerFactory()
  /** Whether `deadlineAt` is absent or a valid scheduler time; checked once per transaction. */
  let deadlineValid = true
  if (deadlineAt !== undefined) {
    try {
      validateSchedulerTime(deadlineAt, 'deadlineAt')
    } catch {
      // Recorded per item at run time, matching the former per-item context admission.
      deadlineValid = false
    }
  }
  return {
    mode,
    async run(items) {
      const collector = createErrorCollector(errorPolicy, report)
      const cleanupErrors: unknown[] = []
      let primaryRecorded = false
      const record = (source: string, error: unknown): void => {
        primaryRecorded = true
        collector.add(source, error)
      }
      // Mirrors `options.signal` into a signal every item's context can observe (L-T26). With no
      // `options.signal` given, `controller.signal` simply never aborts — a scope that wants items
      // to see "we're closing" passes its own close()-tied signal in.
      const controller = signalOption === undefined ? undefined : createController()
      const signalCleanupErrors: unknown[] = []
      let signalSubscription: IObservedAbortSubscription | undefined
      const forwardAbort = (reason: unknown): void => controller?.abort(reason)
      try {
        if (signalOption?.aborted) {
          controller?.abort(signalOption.reason)
        } else if (signalOption) {
          signalSubscription = observeAbortSubscription(signalOption, forwardAbort, (error) =>
            signalCleanupErrors.push(error)
          )
          signalSubscription.retryRegistrationCleanup()
        }
      } catch (error) {
        record('transaction-signal', error)
      }
      try {
        const admission = admitItems(items, mode)
        for (const item of admission.rejected) record(item.source, item.error)
        // Every context field is per-run, so one admitted context serves all items (LC-P4).
        const context: IReleaseContext = {
          signal: controller?.signal ?? inertReleaseSignal,
          deadlineAt,
          scheduler,
          report: (error) => safeReport(report, error),
          disposer: options.disposer
        }
        for (const item of admission.admitted) {
          try {
            // Each item re-checks an invalid `deadlineAt`, so every item still records its own
            // fresh INVALID_OPTION instead of running against a broken clock.
            if (!deadlineValid) validateSchedulerTime(deadlineAt, 'deadlineAt')
            const pendingErrors = executeAdmittedReleaseDescriptor(item.descriptor, context)
            // Await only a genuinely asynchronous chain; synchronous releases stay on this turn.
            const errors = pendingErrors instanceof Promise ? await pendingErrors : pendingErrors
            for (const error of errors) record(item.source, error)
          } catch (error) {
            // Keep one unexpected item failure from preventing later admitted resources from release.
            record(item.source, error)
          }
        }
      } catch (error) {
        // Input iteration failures must not bypass pending drain or collector finalization.
        record('transaction', error)
      } finally {
        signalSubscription?.unsubscribe()
        cleanupErrors.push(...signalCleanupErrors)
      }
      if (pending) {
        try {
          await pending.drain()
        } catch (error) {
          record('transaction-pending', error)
        }
      }
      // Under `throw`, attach cleanup failures to an existing primary instead of turning them into
      // a second primary. Other policies receive cleanup failures through their normal collector.
      if (errorPolicy !== 'throw' || !primaryRecorded) {
        for (const error of cleanupErrors) record('transaction-signal-cleanup', error)
      }
      try {
        return collector.finalize(LifecycleErrorText.disposeTransactionFailed)
      } catch (error) {
        const additionalCleanupErrors =
          errorPolicy === 'throw' && !cleanupErrors.includes(error) ? cleanupErrors : []
        throw attachLifecycleSecondaryErrors(
          error,
          additionalCleanupErrors,
          LifecycleErrorText.disposeTransactionFailed
        )
      }
    }
  }
}
