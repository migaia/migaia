import type {
  ICollectedError,
  IErrorPolicy,
  IReleaseContext,
  IReleaseDescriptor
} from './types.js';
import {
  assimilateCapturedThen,
  containAsyncRejection,
  createErrorCollector,
  createLifecycleError,
  probeThenable
} from './errors.js';
import { LifecycleErrorCode } from './error-code.js';
import { boundedWait } from './bounded-wait.js';
import { systemScheduler, type ILifecycleScheduler } from './scheduler.js';
import { createAbortController, type IAbortSignal } from './abort.js';
import { DisposeTransactionKind, ThenableProbeKind } from './state-constants.js';

type ICallbackOutcome = { readonly ok: true } | { readonly ok: false; readonly error: unknown };

/**
 * 一次读取的 thenable 归化：非 thenable → `not-thenable`；getter 失败 → `failed`（原 getter 错误）；否则把捕获的 `thenFn`
 * apply 一次成 Promise。禁止把探测异常静默改写（与 `probeThenable` 同一契约）。
 */
const assimilateThenable = (
  value: unknown
):
  | { readonly kind: typeof ThenableProbeKind.notThenable }
  | { readonly kind: typeof ThenableProbeKind.failed; readonly error: unknown }
  | { readonly kind: typeof ThenableProbeKind.promise; readonly promise: Promise<void> } => {
  const probe = probeThenable(value);
  if (probe.kind === ThenableProbeKind.notThenable) return { kind: ThenableProbeKind.notThenable };
  if (probe.kind === ThenableProbeKind.failed)
    return { kind: ThenableProbeKind.failed, error: probe.error };
  return {
    kind: ThenableProbeKind.promise,
    promise: assimilateCapturedThen<void>(probe.thenFn, value)
  };
};

async function runCallback(
  callback: (context: IReleaseContext) => void | PromiseLike<void>,
  context: IReleaseContext
): Promise<ICallbackOutcome> {
  let result: void | PromiseLike<void>;
  try {
    result = callback(context);
  } catch (error) {
    return { ok: false, error };
  }
  const assimilated = assimilateThenable(result);
  if (assimilated.kind === ThenableProbeKind.failed) return { ok: false, error: assimilated.error };
  if (assimilated.kind === 'not-thenable') return { ok: true };
  try {
    await assimilated.promise;
    return { ok: true };
  } catch (error) {
    return { ok: false, error };
  }
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
  if (gracefulTimeoutMs === undefined) return sharedDeadlineAt;
  const ownDeadline = now + gracefulTimeoutMs;
  if (sharedDeadlineAt === undefined) return ownDeadline;
  return Math.min(ownDeadline, sharedDeadlineAt);
}

type IGracefulOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: unknown }
  | { readonly ok: false; readonly timedOut: true };

async function raceGraceful(
  graceful: (context: IReleaseContext) => void | PromiseLike<void>,
  context: IReleaseContext,
  gracefulTimeoutMs: number | undefined
): Promise<IGracefulOutcome> {
  let result: void | PromiseLike<void>;
  try {
    result = graceful(context);
  } catch (error) {
    return { ok: false, error };
  }
  const assimilated = assimilateThenable(result);
  if (assimilated.kind === ThenableProbeKind.failed) return { ok: false, error: assimilated.error };
  if (assimilated.kind === 'not-thenable') return { ok: true };
  const promise = assimilated.promise;
  // Single clock sample: the scheduler that produced `context.deadlineAt` (R-9 time-domain contract).
  const scheduler = context.scheduler ?? systemScheduler;
  const now = scheduler.now();
  const effectiveDeadline = computeEffectiveDeadline(gracefulTimeoutMs, context.deadlineAt, now);
  if (effectiveDeadline === undefined) {
    try {
      await promise;
      return { ok: true };
    } catch (error) {
      return { ok: false, error };
    }
  }
  if (effectiveDeadline <= now) {
    // The shared budget was already spent by an earlier item before this one even got a chance to
    // try — there is no point racing a wait against a deadline that has already passed. Surface it
    // as a diagnostic (not an item error — timing out is a normal degrade path) and go straight to
    // `force`.
    context.report(
      createLifecycleError(
        LifecycleErrorCode.deadlineExceeded,
        '[lifecycle] shared deadline already passed before this graceful phase could start'
      )
    );
    return { ok: false, timedOut: true };
  }
  try {
    const won = await boundedWait(promise, effectiveDeadline, { scheduler });
    return won ? { ok: true } : { ok: false, timedOut: true };
  } catch (error) {
    return { ok: false, error };
  }
}

/**
 * Runs the descriptor's degrade chain for exactly one resource: `custom` (if present, skips
 * everything else) — otherwise `graceful` (if present, with its timeout) — then `force`.
 *
 * Returns every error raised along the way (empty on full success) instead of throwing, so the
 * caller can attribute them to the right item and fold them into whatever error policy is active.
 * `graceful` throwing (not timing out) does not stop `force` from running (L-T24); a `graceful`
 * timeout abandons waiting without cancelling it and silently proceeds to `force` (L-T23).
 */
export async function executeReleaseDescriptor(
  descriptor: IReleaseDescriptor,
  context: IReleaseContext
): Promise<readonly unknown[]> {
  if (descriptor.custom) {
    const outcome = await runCallback(descriptor.custom, context);
    return outcome.ok ? [] : [outcome.error];
  }
  const errors: unknown[] = [];
  if (descriptor.graceful) {
    const gracefulOutcome = await raceGraceful(
      descriptor.graceful,
      context,
      descriptor.gracefulTimeoutMs
    );
    if (gracefulOutcome.ok) return [];
    if (!('timedOut' in gracefulOutcome)) errors.push(gracefulOutcome.error);
  }
  const forceOutcome = await runCallback(descriptor.force, context);
  if (!forceOutcome.ok) {
    // The collector keeps the raw, caller-produced error untouched (so `throw` policy's single-error
    // case still throws it exactly as-is) — this tagged wrapper is a parallel diagnostic channel
    // only, carrying `(source, code)` for callers that want that without losing the raw error's own
    // identity/type.
    context.report(
      createLifecycleError(LifecycleErrorCode.releaseForceFailed, '[lifecycle] force() failed', {
        cause: forceOutcome.error
      })
    );
    errors.push(forceOutcome.error);
  }
  return errors;
}

export type IDisposeItem = {
  readonly source: string;
  readonly descriptor: IReleaseDescriptor;
};

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
  | { readonly kind: typeof DisposeTransactionKind.plan };

export type IDisposeTransactionOptions = {
  readonly errorPolicy?: IErrorPolicy;
  readonly report?: (error: unknown) => void;
  /** Absolute deadline shared, unchanged, across every item in this run (L-T32). */
  readonly deadlineAt?: number;
  /**
   * Scheduler whose `now()` produced `deadlineAt`（R-9 时间域契约）；缺省 `systemScheduler`。 Forwarded into
   * every item's `context.scheduler` and into the graceful-phase `boundedWait`.
   */
  readonly scheduler?: ILifecycleScheduler;
  /** Forwarded into `context.signal` for every item; aborted automatically once `run()` starts. */
  readonly signal?: IAbortSignal;
  /** Awaited after every item settles, so in-flight work started by a release can still be drained. */
  readonly pending?: { drain(): Promise<void> };
};

export type IDisposeTransaction = {
  readonly mode: IDisposeTransactionMode;
  run(items: readonly IDisposeItem[]): Promise<readonly ICollectedError[]>;
};

const safeReport = (report: ((error: unknown) => void) | undefined, error: unknown): void => {
  if (!report) return;
  try {
    const result: unknown = report(error);
    containAsyncRejection(result, () => {
      // No lower layer to escalate a reporter's own async failure to.
    });
  } catch {
    // The reporter is the last error boundary for its own synchronous failures too.
  }
};

const orderedItems = (
  items: readonly IDisposeItem[],
  mode: IDisposeTransactionMode
): readonly IDisposeItem[] => {
  if (mode.kind === 'plan') return items;
  // Stable sort: ties (equal order) keep the caller-supplied relative sequence.
  return [...items].sort((a, b) => (b.descriptor.order ?? 0) - (a.descriptor.order ?? 0));
};

export function createDisposeTransaction(
  mode: IDisposeTransactionMode,
  options: IDisposeTransactionOptions = {}
): IDisposeTransaction {
  const errorPolicy = options.errorPolicy ?? 'throw';
  return {
    mode,
    async run(items) {
      const collector = createErrorCollector(errorPolicy, options.report);
      // Mirrors `options.signal` into a signal every item's context can observe (L-T26). With no
      // `options.signal` given, `controller.signal` simply never aborts — a scope that wants items
      // to see "we're closing" passes its own close()-tied signal in.
      const controller = createAbortController();
      const forwardAbort = (): void => controller.abort(options.signal?.reason);
      if (options.signal?.aborted) controller.abort(options.signal.reason);
      else options.signal?.addEventListener('abort', forwardAbort, { once: true });
      try {
        for (const item of orderedItems(items, mode)) {
          const context: IReleaseContext = {
            signal: controller.signal,
            deadlineAt: options.deadlineAt,
            scheduler: options.scheduler,
            report: (error) => safeReport(options.report, error)
          };
          const errors = await executeReleaseDescriptor(item.descriptor, context);
          for (const error of errors) collector.add(item.source, error);
        }
      } finally {
        options.signal?.removeEventListener('abort', forwardAbort);
      }
      if (options.pending) await options.pending.drain();
      return collector.finalize('[lifecycle] dispose transaction failed');
    }
  };
}
