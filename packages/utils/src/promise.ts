import { UtilsErrorCode } from './error-code.js';
import { UtilsErrorText } from './error-text.js';
import { attachErrorIdentity, UtilsAbortError, UtilsTimeoutError } from './error.js';

export { UtilsAbortError } from './error.js';

export type IAbortSignal = {
  readonly aborted: boolean;
  readonly reason?: unknown;
  addEventListener(
    type: 'abort',
    listener: () => void,
    options?: { readonly once?: boolean }
  ): void;
  removeEventListener(type: 'abort', listener: () => void): void;
};
export type IScheduledTask = { cancel(): void; unref?(): void };
export type IUtilsScheduler = {
  now(): number;
  schedule(callback: () => void, delayMs: number): IScheduledTask;
};
export type IManualScheduler = IUtilsScheduler & {
  advance(ms: number): void;
  readonly pendingCount: number;
};
export type IDeferred<T> = {
  readonly promise: Promise<T>;
  readonly resolve: (value: T | PromiseLike<T>) => void;
  readonly reject: (reason?: unknown) => void;
};
export type IAsyncControls = {
  readonly signal?: IAbortSignal;
  readonly signals?: readonly IAbortSignal[];
  readonly scheduler?: IUtilsScheduler;
  readonly unref?: boolean;
};
export type IRetryContext = {
  readonly attempt: number;
  readonly signal: IAbortSignal;
  readonly remainingMs?: number;
};
export type IRetryFailureContext = IRetryContext & { readonly maxAttempts: number };
export type IUtilsReporter = (
  error: unknown,
  context: {
    readonly operation: 'withTimeout' | 'raceWithAbort' | 'retry' | 'sleep' | 'limiter';
    readonly phase: 'late-rejection' | 'cleanup' | 'reporter';
    readonly attempt?: number;
  }
) => void;
/** Reports a diagnostic to the host without creating an unhandled rejected Promise. */
export const hostRethrowReporter: IUtilsReporter = (error) => {
  const enqueue = globalThis.queueMicrotask;
  if (typeof enqueue === 'function')
    enqueue(() => {
      throw error;
    });
  else throw error;
};
export type ITimeoutOperation<T> = (context: {
  readonly signal: IAbortSignal;
}) => T | PromiseLike<T>;

/** Stable inert signal used by deadline-only callers that must not allocate an AbortController. */
const inertTimeoutSignal: IAbortSignal = Object.freeze({
  aborted: false,
  addEventListener: (): void => undefined,
  removeEventListener: (): void => undefined
});

/** Result of inspecting external abort state without allowing hostile getters to escape. */
type IAbortObservation =
  | { readonly kind: 'none' }
  | { readonly kind: 'aborted'; readonly reason: unknown }
  | { readonly kind: 'failed'; readonly error: unknown };

/** Reads the first observed abort and treats a hostile reason getter as that abort's reason. */
function observeAbort(signals: readonly IAbortSignal[]): IAbortObservation {
  for (const signal of signals) {
    let aborted: boolean;
    try {
      aborted = signal.aborted;
    } catch (error) {
      return { kind: 'failed', error };
    }
    if (!aborted) continue;
    try {
      return { kind: 'aborted', reason: signal.reason };
    } catch (error) {
      return { kind: 'aborted', reason: error };
    }
  }
  return { kind: 'none' };
}
/** Describes a lazy operation whose cooperative cancellation observes the supplied signal. */
export type IAbortOperation<T> = ITimeoutOperation<T>;
export type IConcurrencyLimiter = {
  run<T>(
    task: (context: { readonly signal?: IAbortSignal }) => T | PromiseLike<T>,
    options?: { readonly signal?: IAbortSignal }
  ): Promise<T>;
  readonly activeCount: number;
  readonly pendingCount: number;
  whenIdle(): Promise<void>;
  close(reason?: unknown): void;
  dispose(reason?: unknown): Promise<void>;
};

/** Schedules callbacks with native timers while forwarding optional unref hints. */
export const systemScheduler: IUtilsScheduler = {
  now: () => Date.now(),
  schedule: (callback, delayMs) => {
    const handle = setTimeout(callback, delayMs);
    return {
      cancel: () => clearTimeout(handle),
      unref:
        typeof (handle as unknown as { unref?: unknown }).unref === 'function'
          ? () => (handle as unknown as { unref: () => void }).unref()
          : undefined
    };
  }
};

/** Creates a native Promise deferred without exposing mutable settlement state. */
export function deferred<T>(): IDeferred<T> {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

/** Creates a deterministic FIFO scheduler for unit tests and adapters. */
export function createManualScheduler(): IManualScheduler {
  let current = 0;
  let sequence = 0;
  const tasks: Array<{
    readonly due: number;
    readonly order: number;
    readonly callback: () => void;
    cancelled: boolean;
  }> = [];
  const scheduler: IManualScheduler = {
    now: () => current,
    schedule: (callback, delayMs) => {
      if (!Number.isFinite(delayMs) || delayMs < 0)
        throw new RangeError(
          UtilsErrorText.invalidArgument('delayMs', 'a finite non-negative number')
        );
      const task = { due: current + delayMs, order: sequence++, callback, cancelled: false };
      tasks.push(task);
      return {
        cancel: () => {
          task.cancelled = true;
        },
        unref: () => undefined
      };
    },
    advance: (ms) => {
      if (!Number.isFinite(ms) || ms < 0)
        throw new RangeError(UtilsErrorText.invalidArgument('ms', 'a finite non-negative number'));
      const target = current + ms;
      current = target;
      let count = 0;
      while (true) {
        const next = tasks
          .filter((task) => !task.cancelled && task.due <= target)
          .sort((left, right) => left.due - right.due || left.order - right.order)[0];
        if (!next) break;
        if (++count > 10000) throw runaway();
        next.cancelled = true;
        next.callback();
      }
    },
    get pendingCount() {
      return tasks.filter((task) => !task.cancelled).length;
    }
  };
  return scheduler;
}

/** Resolves after a scheduler delay or rejects on cooperative abort. */
export function sleep(delayMs: number, options?: IAsyncControls): Promise<void> {
  const schedulerOption = options?.scheduler;
  const signal = options?.signal;
  const signalsOption = options?.signals;
  const unref = options?.unref;
  const scheduler = schedulerOption ?? systemScheduler;
  if (!Number.isFinite(delayMs) || delayMs < 0)
    return Promise.reject(
      new RangeError(UtilsErrorText.invalidArgument('delayMs', 'a finite non-negative number'))
    );
  if (signal && signalsOption)
    return Promise.reject(
      new TypeError(
        UtilsErrorText.invalidArgument('signal', 'signal and signals are mutually exclusive')
      )
    );
  const signals = signalsOption ?? (signal ? [signal] : []);
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    let timer: IScheduledTask | undefined;
    const cleanup = (): void => {
      try {
        timer?.cancel();
      } catch (error) {
        reportDiagnostic(hostRethrowReporter, error, { operation: 'sleep', phase: 'cleanup' });
      }
      for (const signal of signals)
        try {
          signal.removeEventListener('abort', onAbort);
        } catch (error) {
          reportDiagnostic(hostRethrowReporter, error, { operation: 'sleep', phase: 'cleanup' });
        }
    };
    const onAbort = (): void => {
      if (settled) return;
      const observation = observeAbort(signals);
      settled = true;
      cleanup();
      if (observation.kind === 'failed') reject(observation.error);
      else
        reject(
          new UtilsAbortError(observation.kind === 'aborted' ? observation.reason : undefined)
        );
    };
    for (const signal of signals) if (signal.aborted) return onAbort();
    timer = scheduler.schedule(() => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    }, delayMs);
    if (unref) timer.unref?.();
    try {
      for (const signal of signals) signal.addEventListener('abort', onAbort, { once: true });
    } catch (error) {
      if (!settled) {
        settled = true;
        cleanup();
        reject(error);
      }
      return;
    }
    if (signals.some((signal) => signal.aborted)) onAbort();
  });
}

/** Races a lazy operation against an abort-aware deadline. */
export function withTimeout<T>(
  operation: ITimeoutOperation<T>,
  options: IAsyncControls & {
    readonly timeoutMs: number;
    readonly report?: IUtilsReporter;
    readonly zeroTimeoutBehavior?: 'skip' | 'start';
    /** Disables internal cancellation allocation for deadline-only operations. */
    readonly cooperativeCancellation?: boolean;
  }
): Promise<T> {
  const timeoutMs = options.timeoutMs;
  const signal = options.signal;
  const signalsOption = options.signals;
  const reportOption = options.report;
  const zeroTimeoutBehavior = options.zeroTimeoutBehavior;
  const cooperativeCancellation = options.cooperativeCancellation ?? true;
  const scheduler = options.scheduler ?? systemScheduler;
  const unref = options.unref;
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0)
    return Promise.reject(
      new RangeError(UtilsErrorText.invalidArgument('timeoutMs', 'a finite non-negative number'))
    );
  if (signal && signalsOption)
    return Promise.reject(
      new TypeError(
        UtilsErrorText.invalidArgument('signal', 'signal and signals are mutually exclusive')
      )
    );
  const signals = signalsOption ?? (signal ? [signal] : []);
  const report = reportOption ?? hostRethrowReporter;
  const controller = cooperativeCancellation ? new AbortController() : undefined;
  const operationSignal = controller?.signal as unknown as IAbortSignal | undefined;
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    let timedOut = false;
    let timer: IScheduledTask | undefined;
    const finish = (callback: () => void, primaryError?: unknown): void => {
      if (settled) return;
      settled = true;
      const cleanupErrors: unknown[] = [];
      try {
        timer?.cancel();
      } catch (error) {
        cleanupErrors.push(error);
      }
      for (const signal of signals)
        try {
          signal.removeEventListener('abort', onAbort);
        } catch (error) {
          cleanupErrors.push(error);
        }
      if (cleanupErrors.length > 0) {
        const errors =
          primaryError === undefined ? cleanupErrors : [primaryError, ...cleanupErrors];
        reject(
          errors.length === 1 ? errors[0] : new AggregateError(errors, UtilsErrorText.cleanupFailed)
        );
        return;
      }
      callback();
    };
    const onAbort = (): void => {
      if (!timedOut) {
        const observation = observeAbort(signals);
        if (observation.kind === 'failed') {
          finish(() => reject(observation.error), observation.error);
          return;
        }
        const reason = observation.kind === 'aborted' ? observation.reason : undefined;
        controller?.abort(reason);
        const error = new UtilsAbortError(reason);
        finish(() => reject(error), error);
      }
    };
    for (const signal of signals) if (signal.aborted) return onAbort();
    if (timeoutMs === 0 && zeroTimeoutBehavior !== 'start') {
      const error = new UtilsTimeoutError('operation', 0);
      return finish(() => reject(error), error);
    }
    timer = scheduler.schedule(() => {
      timedOut = true;
      const timeoutError = new UtilsTimeoutError('operation', timeoutMs);
      controller?.abort(timeoutError);
      finish(() => reject(timeoutError), timeoutError);
    }, timeoutMs);
    if (settled) timer.cancel();
    if (unref) timer.unref?.();
    try {
      for (const signal of signals) signal.addEventListener('abort', onAbort, { once: true });
    } catch (error) {
      finish(() => reject(error), error);
      return;
    }
    if (signals.some((signal) => signal.aborted)) return onAbort();
    if (settled) return;
    try {
      Promise.resolve(operation({ signal: operationSignal ?? inertTimeoutSignal })).then(
        (value) => {
          if (settled) return;
          finish(() => resolve(value));
        },
        (error) => {
          if (settled) {
            reportDiagnostic(report, error, { operation: 'withTimeout', phase: 'late-rejection' });
            return;
          }
          finish(() => reject(error), error);
        }
      );
    } catch (error) {
      finish(() => reject(error), error);
    }
  });
}

/** Races a lazy operation against one or more external abort signals without creating a timer. */
export function raceWithAbort<T>(
  operation: IAbortOperation<T>,
  options: Pick<IAsyncControls, 'signal' | 'signals'> & {
    readonly report?: IUtilsReporter;
    readonly cleanupPolicy?: 'reject' | 'report';
  } = {}
): Promise<T> {
  const signal = options.signal;
  const signalsOption = options.signals;
  const reportOption = options.report;
  const cleanupPolicy = options.cleanupPolicy ?? 'reject';
  if (signal && signalsOption)
    return Promise.reject(
      new TypeError(
        UtilsErrorText.invalidArgument('signal', 'signal and signals are mutually exclusive')
      )
    );
  const signals = signalsOption ?? (signal ? [signal] : []);
  const report = reportOption ?? hostRethrowReporter;
  const controller = new AbortController();
  const operationSignal = controller.signal as unknown as IAbortSignal;
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void, primaryError?: unknown): void => {
      if (settled) return;
      settled = true;
      const cleanupErrors: unknown[] = [];
      for (const candidate of signals)
        try {
          candidate.removeEventListener('abort', onAbort);
        } catch (error) {
          cleanupErrors.push(error);
        }
      if (cleanupErrors.length > 0) {
        if (cleanupPolicy === 'report') {
          for (const error of cleanupErrors)
            reportDiagnostic(report, error, { operation: 'raceWithAbort', phase: 'cleanup' });
          callback();
          return;
        }
        const errors =
          primaryError === undefined ? cleanupErrors : [primaryError, ...cleanupErrors];
        reject(
          errors.length === 1 ? errors[0] : new AggregateError(errors, UtilsErrorText.cleanupFailed)
        );
        return;
      }
      callback();
    };
    const onAbort = (): void => {
      const observation = observeAbort(signals);
      if (observation.kind === 'failed') {
        finish(() => reject(observation.error), observation.error);
        return;
      }
      const reason = observation.kind === 'aborted' ? observation.reason : undefined;
      controller.abort(reason);
      const error = new UtilsAbortError(reason);
      finish(() => reject(error), error);
    };
    for (const candidate of signals) if (candidate.aborted) return onAbort();
    try {
      for (const candidate of signals) candidate.addEventListener('abort', onAbort, { once: true });
    } catch (error) {
      const admissionError = attachErrorIdentity(
        new TypeError(UtilsErrorText.invalidArgument('signal', 'abort listener admission failed'), {
          cause: error
        }),
        { source: '@migaia/utils', code: UtilsErrorCode.invalidArgument }
      );
      finish(() => reject(admissionError), admissionError);
      return;
    }
    if (signals.some((candidate) => candidate.aborted)) return onAbort();
    try {
      Promise.resolve(operation({ signal: operationSignal })).then(
        (value) => {
          if (!settled) finish(() => resolve(value));
        },
        (error) => {
          if (settled) {
            reportDiagnostic(report, error, {
              operation: 'raceWithAbort',
              phase: 'late-rejection'
            });
            return;
          }
          finish(() => reject(error), error);
        }
      );
    } catch (error) {
      finish(() => reject(error), error);
    }
  });
}

/** Retries serially under explicit attempt and total limits. */
async function retryCore<T>(
  operation: (context: IRetryContext) => T | PromiseLike<T>,
  options: {
    readonly maxAttempts: number;
    readonly shouldRetry: (
      error: unknown,
      context: IRetryFailureContext
    ) => boolean | PromiseLike<boolean>;
    readonly delay?: number | ((error: unknown, context: IRetryFailureContext) => number);
    readonly totalTimeoutMs?: number;
    readonly attemptTimeoutMs?: number;
    readonly signal?: IAbortSignal;
    readonly signals?: readonly IAbortSignal[];
    readonly zeroTimeoutBehavior?: 'skip' | 'start';
    readonly report?: IUtilsReporter;
    readonly unref?: boolean;
    readonly scheduler?: IUtilsScheduler;
  }
): Promise<T> {
  if (!Number.isSafeInteger(options.maxAttempts) || options.maxAttempts < 1)
    throw new RangeError(UtilsErrorText.invalidArgument('maxAttempts', 'a positive safe integer'));
  if (options.signal && options.signals)
    throw new TypeError(
      UtilsErrorText.invalidArgument('signal', 'signal and signals are mutually exclusive')
    );
  for (const [name, value] of [
    ['totalTimeoutMs', options.totalTimeoutMs],
    ['attemptTimeoutMs', options.attemptTimeoutMs]
  ] as const)
    if (value !== undefined && (!Number.isFinite(value) || value < 0))
      throw new RangeError(UtilsErrorText.invalidArgument(name, 'a finite non-negative number'));
  const externalSignals = options.signals ?? (options.signal ? [options.signal] : []);
  const preAbort = observeAbort(externalSignals);
  if (preAbort.kind === 'failed') throw preAbort.error;
  if (preAbort.kind === 'aborted') throw new UtilsAbortError(preAbort.reason);
  let lastError: unknown;
  const startedAt = options.scheduler?.now() ?? systemScheduler.now();
  for (let attempt = 1; attempt <= options.maxAttempts; attempt += 1) {
    const attemptController = new AbortController();
    const signal = attemptController.signal as unknown as IAbortSignal;
    const remainingMs =
      options.totalTimeoutMs === undefined
        ? undefined
        : options.totalTimeoutMs -
          ((options.scheduler?.now() ?? systemScheduler.now()) - startedAt);
    try {
      if (remainingMs !== undefined && remainingMs <= 0)
        throw new UtilsTimeoutError('total', options.totalTimeoutMs!);
      const operationCall = (context: { readonly signal: IAbortSignal }): T | PromiseLike<T> =>
        operation({ attempt, signal: context.signal, remainingMs });
      if (options.attemptTimeoutMs !== undefined) {
        return await withTimeout(operationCall, {
          timeoutMs: options.attemptTimeoutMs,
          scheduler: options.scheduler,
          signals: externalSignals,
          zeroTimeoutBehavior: options.zeroTimeoutBehavior,
          unref: options.unref,
          report: options.report
        });
      }
      if (remainingMs !== undefined) {
        try {
          return await withTimeout(operationCall, {
            timeoutMs: remainingMs,
            scheduler: options.scheduler,
            signals: externalSignals,
            zeroTimeoutBehavior: options.zeroTimeoutBehavior,
            unref: options.unref,
            report: options.report
          });
        } catch (error) {
          if (error instanceof UtilsTimeoutError)
            throw new UtilsTimeoutError('total', options.totalTimeoutMs!);
          throw error;
        }
      }
      if (externalSignals.length === 0) return await operationCall({ signal });
      return await runWithAbort(
        () => operationCall({ signal }),
        externalSignals,
        attemptController,
        options.report
      );
    } catch (error) {
      const externalAbort = observeAbort(externalSignals);
      if (externalAbort.kind === 'failed') throw externalAbort.error;
      if (
        externalAbort.kind === 'aborted' &&
        externalAbort.reason instanceof UtilsTimeoutError &&
        externalAbort.reason.scope === 'operation'
      )
        return await new Promise<T>(() => undefined);
      if (externalAbort.kind === 'aborted' && error instanceof UtilsAbortError) throw error;
      lastError = error;
      if (
        attempt >= options.maxAttempts ||
        (error instanceof UtilsTimeoutError && error.scope === 'total') ||
        !(await (externalSignals.length === 0
          ? options.shouldRetry(error, { attempt, maxAttempts: options.maxAttempts, signal })
          : runWithAbort(
              () =>
                options.shouldRetry(error, { attempt, maxAttempts: options.maxAttempts, signal }),
              externalSignals,
              attemptController,
              options.report
            )))
      )
        throw error;
      const delay =
        typeof options.delay === 'function'
          ? options.delay(error, { attempt, maxAttempts: options.maxAttempts, signal })
          : (options.delay ?? 0);
      if (!Number.isFinite(delay) || delay < 0)
        throw new RangeError(
          UtilsErrorText.invalidArgument('delay', 'a finite non-negative number')
        );
      if (options.totalTimeoutMs !== undefined) {
        const elapsed = (options.scheduler?.now() ?? systemScheduler.now()) - startedAt;
        if (elapsed + delay >= options.totalTimeoutMs)
          throw new UtilsTimeoutError('total', options.totalTimeoutMs);
      }
      if (delay > 0)
        await sleep(delay, {
          scheduler: options.scheduler,
          signals: externalSignals,
          unref: options.unref
        });
    }
  }
  throw lastError;
}

/** Enforces the retry task's outer deadline, including policy and backoff admission work. */
export function retry<T>(
  operation: (context: IRetryContext) => T | PromiseLike<T>,
  options: Parameters<typeof retryCore<T>>[1]
): Promise<T> {
  const snapshot = { ...options };
  if (snapshot.totalTimeoutMs === undefined) return retryCore(operation, snapshot);
  const externalSignals = snapshot.signals ?? (snapshot.signal ? [snapshot.signal] : []);
  return withTimeout(
    ({ signal }) =>
      retryCore(operation, {
        ...snapshot,
        signal: undefined,
        signals: [...externalSignals, signal],
        totalTimeoutMs: snapshot.totalTimeoutMs
      }),
    {
      timeoutMs: snapshot.totalTimeoutMs,
      scheduler: snapshot.scheduler,
      unref: snapshot.unref,
      zeroTimeoutBehavior: snapshot.zeroTimeoutBehavior,
      report: snapshot.report
    }
  ).catch((error: unknown) => {
    if (error instanceof UtilsTimeoutError && error.scope === 'operation')
      throw new UtilsTimeoutError('total', snapshot.totalTimeoutMs!);
    throw error;
  });
}

/**
 * Runs an operation with externally linked cooperative cancellation when no deadline wrapper
 * exists.
 */
function runWithAbort<T>(
  operation: () => T | PromiseLike<T>,
  signals: readonly IAbortSignal[],
  controller: AbortController,
  report: IUtilsReporter = hostRethrowReporter
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const cleanup = (): void => {
      for (const signal of signals)
        try {
          signal.removeEventListener('abort', onAbort);
        } catch (error) {
          reportDiagnostic(report, error, { operation: 'retry', phase: 'cleanup' });
        }
    };
    const onAbort = (): void => {
      if (settled) return;
      const observation = observeAbort(signals);
      settled = true;
      if (observation.kind === 'failed') {
        cleanup();
        reject(observation.error);
        return;
      }
      const reason = observation.kind === 'aborted' ? observation.reason : undefined;
      controller.abort(reason);
      cleanup();
      reject(new UtilsAbortError(reason));
    };
    for (const signal of signals) if (signal.aborted) return onAbort();
    for (const signal of signals) signal.addEventListener('abort', onAbort, { once: true });
    Promise.resolve()
      .then(operation)
      .then(
        (value) => {
          if (settled) return;
          settled = true;
          cleanup();
          resolve(value);
        },
        (error) => {
          if (settled) {
            reportDiagnostic(report, error, { operation: 'retry', phase: 'late-rejection' });
            return;
          }
          settled = true;
          cleanup();
          reject(error);
        }
      );
  });
}

/** Limits active tasks with FIFO admission and cooperative queued cancellation. */
export function createConcurrencyLimiter(options: {
  readonly concurrency: number;
  readonly report?: IUtilsReporter;
}): IConcurrencyLimiter {
  const concurrency = options.concurrency;
  const report = options.report ?? hostRethrowReporter;
  if (!Number.isSafeInteger(concurrency) || concurrency < 1)
    throw new RangeError(UtilsErrorText.invalidArgument('concurrency', 'a positive safe integer'));
  type IEntry = {
    readonly task: (context: { readonly signal?: IAbortSignal }) => unknown;
    readonly signal?: IAbortSignal;
    readonly resolve: (value: unknown) => void;
    readonly reject: (error: unknown) => void;
    cancelled: boolean;
    cleanup: () => void;
  };
  const queue: IEntry[] = [];
  let queueHead = 0;
  let active = 0;
  let closed = false;
  let closeReason: unknown;
  let idlePromise: Promise<void> | undefined;
  let idleResolve: (() => void) | undefined;
  let disposePromise: Promise<void> | undefined;
  const signalIdle = (): void => {
    if (active !== 0) return;
    for (let index = queueHead; index < queue.length; index++) if (!queue[index].cancelled) return;
    idleResolve?.();
    idleResolve = undefined;
  };
  const drain = (): void => {
    while (!closed && active < concurrency && queueHead < queue.length) {
      const entry = queue[queueHead++];
      if (!entry || entry.cancelled) continue;
      try {
        entry.cleanup();
      } catch (error) {
        reportDiagnostic(report, error, {
          operation: 'limiter',
          phase: 'cleanup'
        });
      }
      active += 1;
      Promise.resolve()
        .then(() => entry.task({ signal: entry.signal }))
        .then(entry.resolve, entry.reject)
        .finally(() => {
          active -= 1;
          drain();
          signalIdle();
        });
    }
  };
  const close = (reason?: unknown): void => {
    if (closed) return;
    closed = true;
    closeReason = reason ?? limiterClosedError();
    for (let index = queueHead; index < queue.length; index++) {
      const entry = queue[index];
      if (entry.cancelled) continue;
      entry.cancelled = true;
      try {
        entry.cleanup();
      } catch (error) {
        reportDiagnostic(report, error, {
          operation: 'limiter',
          phase: 'cleanup'
        });
      }
      entry.reject(closeReason);
    }
    queueHead = queue.length;
    signalIdle();
  };
  const limiter: IConcurrencyLimiter = {
    run: (task, runOptions) => {
      const runSignal = runOptions?.signal;
      if (closed) return Promise.reject(closeReason);
      const initialAbort = observeAbort(runSignal === undefined ? [] : [runSignal]);
      if (initialAbort.kind === 'failed') return Promise.reject(initialAbort.error);
      if (initialAbort.kind === 'aborted')
        return Promise.reject(initialAbort.reason ?? new UtilsAbortError());
      return new Promise((resolve, reject) => {
        let cleanup = (): void => undefined;
        const entry: IEntry = {
          task,
          signal: runSignal,
          resolve: resolve as (value: unknown) => void,
          reject,
          cancelled: false,
          cleanup: () => cleanup()
        };
        const onAbort = (): void => {
          if (entry.cancelled) return;
          const observation = observeAbort(runSignal === undefined ? [] : [runSignal]);
          entry.cancelled = true;
          reject(
            observation.kind === 'failed'
              ? observation.error
              : observation.kind === 'aborted'
                ? (observation.reason ?? new UtilsAbortError())
                : new UtilsAbortError()
          );
          try {
            runSignal?.removeEventListener('abort', onAbort);
          } catch (error) {
            reportDiagnostic(report, error, { operation: 'limiter', phase: 'cleanup' });
          }
          signalIdle();
        };
        runSignal?.addEventListener('abort', onAbort, { once: true });
        cleanup = () => runSignal?.removeEventListener('abort', onAbort);
        queue.push(entry);
        drain();
      });
    },
    get activeCount() {
      return active;
    },
    get pendingCount() {
      let count = 0;
      for (let index = queueHead; index < queue.length; index++)
        if (!queue[index].cancelled) count += 1;
      return count;
    },
    whenIdle: () => {
      if (active === 0 && queueHead >= queue.length) return Promise.resolve();
      if (!idlePromise)
        idlePromise = new Promise<void>((resolve) => {
          idleResolve = resolve;
        });
      return idlePromise;
    },
    close,
    dispose: (reason) => {
      if (!disposePromise) {
        disposePromise = new Promise<void>((resolve) => {
          idleResolve = resolve;
          close(reason);
          if (active === 0) resolve();
        });
      }
      return disposePromise;
    }
  };
  return limiter;
}

function runaway(): RangeError {
  const error = new RangeError(UtilsErrorText.schedulerRunaway);
  Object.defineProperty(error, 'source', { value: '@migaia/utils', enumerable: true });
  Object.defineProperty(error, 'code', {
    value: UtilsErrorCode.schedulerRunaway,
    enumerable: true
  });
  return error;
}

function reportDiagnostic(
  reporter: IUtilsReporter,
  error: unknown,
  context: Parameters<IUtilsReporter>[1]
): void {
  try {
    reporter(error, context);
  } catch (reporterError) {
    if (reporter !== hostRethrowReporter)
      hostRethrowReporter(reporterError, { operation: context.operation, phase: 'reporter' });
  }
}

function limiterClosedError(): Error {
  return attachErrorIdentity(new Error(UtilsErrorText.limiterClosed), {
    source: '@migaia/utils',
    code: UtilsErrorCode.limiterClosed
  });
}
