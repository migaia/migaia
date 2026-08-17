import { containAsyncRejection, createLifecycleError } from './errors.js';
import { LifecycleErrorCode } from './error-code.js';
import { systemScheduler, type ILifecycleScheduler, type IScheduledTask } from './scheduler.js';

export type IMutationQueueOptions = {
  /**
   * Default per-task admission budget. `undefined` (default) means "diagnose only, never reject" —
   * the core never invents a domain timeout. `false` disables even diagnostics. A number is the
   * `plugin-host`-equivalent behavior: reject once a queued task has waited this long.
   */
  readonly queueAdmissionTimeoutMs?: number | false;
  /**
   * Diagnostic-only threshold used while `queueAdmissionTimeoutMs` is `undefined`. `false` disables
   * the diagnostic timer.
   */
  readonly admissionDiagnosticMs?: number | false;
  readonly onAdmissionDiagnostic?: (info: {
    readonly owner: string | undefined;
    readonly waitedMs: number;
  }) => void;
  /** Runtime-neutral scheduler（默认 `systemScheduler`）；watchdog 计时与时钟都经它，不直接用宿主 timer。 */
  readonly scheduler?: ILifecycleScheduler;
};

export type IEnqueueOptions = {
  readonly owner?: string;
  /** Overrides the queue's default for this one task. */
  readonly queueAdmissionTimeoutMs?: number | false;
};

export type IMutationQueue = {
  enqueue<T>(task: () => T | PromiseLike<T>, options?: IEnqueueOptions): Promise<T>;
  readonly size: number;
};

type IMutationRecord = {
  readonly task: () => unknown | PromiseLike<unknown>;
  readonly owner: string | undefined;
  readonly resolve: (value: unknown) => void;
  readonly reject: (reason: unknown) => void;
  admissionTimer: IScheduledTask | undefined;
};

/**
 * Serial FIFO queue, ported off `plugin-host`'s `#mutationQueue`/`#armQueueWatchdog` (already
 * verified as: strict FIFO, watchdog disarmed the instant a task settles, and — contrary to an
 * earlier reading of that code — no owner-aware self-dependency detection at all). This module adds
 * that detection as new behavior, plus makes the admission timeout a caller-supplied configuration
 * instead of a hardcoded domain SLA (§4.7).
 */
export function createMutationQueue(options: IMutationQueueOptions = {}): IMutationQueue {
  const defaultAdmissionTimeoutMs = options.queueAdmissionTimeoutMs;
  const admissionDiagnosticMs = options.admissionDiagnosticMs ?? 1000;
  const scheduler = options.scheduler ?? systemScheduler;
  const queue: IMutationRecord[] = [];
  let running = false;
  let runningOwner: string | undefined;

  const disarmAdmission = (record: IMutationRecord): void => {
    if (record.admissionTimer !== undefined) {
      record.admissionTimer.cancel();
      record.admissionTimer = undefined;
    }
  };

  /** 校验 scheduler.schedule 返回句柄含可调用 cancel（AF-32）：非法句柄 fail-fast，不裸抛 undefined.cancel。 */
  function validateScheduleHandle(handle: unknown): asserts handle is IScheduledTask {
    if (
      handle === null ||
      typeof handle !== 'object' ||
      typeof (handle as { cancel?: unknown }).cancel !== 'function'
    ) {
      throw createLifecycleError(
        LifecycleErrorCode.invalidOption,
        '[lifecycle] scheduler.schedule must return an object with a cancel() function'
      );
    }
  }

  /** 诊断回调隔离（AF-33）：同步抛/异步拒绝均被观测，不穿透 scheduler、不改变业务结果、不产生 unhandled rejection。 */
  const reportAdmissionDiagnostic = (record: IMutationRecord, waitedMs: number): void => {
    try {
      const result: unknown = options.onAdmissionDiagnostic?.({ owner: record.owner, waitedMs });
      containAsyncRejection(result, () => {
        // 诊断异步失败无更低一层可上报，在边界终止。
      });
    } catch {
      // 诊断同步失败不得逃逸出 timer 回调。
    }
  };

  const armAdmission = (record: IMutationRecord, timeoutMs: number | false | undefined): void => {
    if (timeoutMs === false) return;
    const startedAt = scheduler.now();
    if (timeoutMs === undefined) {
      // nothing to diagnose to, or the diagnostic timer is explicitly disabled — don't burn a timer.
      if (!options.onAdmissionDiagnostic || admissionDiagnosticMs === false) return;
      const timer = scheduler.schedule(() => {
        reportAdmissionDiagnostic(record, scheduler.now() - startedAt);
      }, admissionDiagnosticMs);
      validateScheduleHandle(timer);
      record.admissionTimer = timer;
      return;
    }
    const timer = scheduler.schedule(() => {
      const index = queue.indexOf(record);
      if (index < 0) return; // already dequeued to run, or already settled
      queue.splice(index, 1);
      const waitedMs = scheduler.now() - startedAt;
      record.reject(
        createLifecycleError(
          LifecycleErrorCode.queueAdmissionTimeout,
          `[lifecycle] mutation waited in the queue for more than ${timeoutMs}ms`,
          { detail: { owner: record.owner, waitedMs } }
        )
      );
    }, timeoutMs);
    validateScheduleHandle(timer);
    record.admissionTimer = timer;
  };

  const runNext = (): void => {
    if (running) return;
    const next = queue.shift();
    if (!next) return;
    disarmAdmission(next);
    running = true;
    runningOwner = next.owner;
    void (async () => {
      try {
        next.resolve(await next.task());
      } catch (error) {
        next.reject(error);
      } finally {
        running = false;
        runningOwner = undefined;
        runNext();
      }
    })();
  };

  const enqueue = <T>(
    task: () => T | PromiseLike<T>,
    enqueueOptions: IEnqueueOptions = {}
  ): Promise<T> => {
    const owner = enqueueOptions.owner;
    // A task awaiting a same-owner task it just enqueued cannot ever complete — the queue is FIFO
    // and won't run the new one until this one finishes. Unlabeled tasks are never flagged: without
    // a reliable owner, rejecting a legitimate task would be worse than missing this diagnostic
    // (§4.7).
    //
    // This is a partial guard, not a general one: a running task that `enqueue()`s a *different*
    // or unlabeled task and then `await`s it right there deadlocks the exact same way — the queue
    // is strictly single-flight and won't dequeue anything until the running task returns. That
    // case has no reliable signal to detect it by, so it isn't caught; the safe pattern for a
    // running task that wants to submit follow-up work is to enqueue it without awaiting its own
    // successor.
    if (owner !== undefined && running && runningOwner === owner) {
      return Promise.reject(
        createLifecycleError(
          LifecycleErrorCode.queueSelfDependency,
          `[lifecycle] mutation with owner "${owner}" was enqueued while a mutation with the same owner is running`,
          { detail: { owner } }
        )
      );
    }
    return new Promise<T>((resolve, reject) => {
      const record: IMutationRecord = {
        task: task as () => unknown | PromiseLike<unknown>,
        owner,
        resolve: resolve as (value: unknown) => void,
        reject,
        admissionTimer: undefined
      };
      const queuedBehindWork = running || queue.length > 0;
      queue.push(record);
      if (queuedBehindWork) {
        try {
          armAdmission(record, enqueueOptions.queueAdmissionTimeoutMs ?? defaultAdmissionTimeoutMs);
        } catch (error) {
          // 排程失败不得留下幽灵任务（AF-32）：移除记录并 reject，后续任务不被阻塞、size 正确、原始错误可达。
          const index = queue.indexOf(record);
          if (index >= 0) queue.splice(index, 1);
          reject(error);
          return;
        }
      }
      runNext();
    });
  };

  return {
    enqueue,
    get size() {
      return queue.length + (running ? 1 : 0);
    }
  };
}
