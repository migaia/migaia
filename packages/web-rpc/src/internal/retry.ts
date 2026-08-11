import { raceWithAsyncControl, waitWithSignal } from './async-control';
import type { IAbortSignal } from './async-control';

export type IRetryDecision =
  | { readonly retry: false }
  | { readonly retry: true; readonly delayMs: number };
export type IRetryExecutorOptions<T> = {
  readonly maxAttempts: number;
  readonly signals: readonly IAbortSignal[];
  readonly attempt: (attempt: number) => Promise<T>;
  readonly decide: (error: unknown, attempt: number) => Promise<IRetryDecision>;
  readonly createAbortError: () => Error;
  readonly createTimeoutError: () => Error;
  readonly remainingTimeout?: () => number | false | undefined;
  readonly onDiagnostic?: (error: unknown) => void;
};

/** Executes serial attempts with cancellable backoff and no hidden retry policy. */
export async function executeWithRetry<T>(options: IRetryExecutorOptions<T>): Promise<T> {
  if (!Number.isSafeInteger(options.maxAttempts) || options.maxAttempts < 1)
    throw new TypeError('maxAttempts must be a positive safe integer');
  for (let attempt = 1; attempt <= options.maxAttempts; attempt += 1) {
    if (options.signals.some((signal) => signal.aborted)) throw options.createAbortError();
    try {
      return await options.attempt(attempt);
    } catch (error) {
      if (attempt >= options.maxAttempts) throw error;
      const decision = await raceWithAsyncControl({
        // Keep policy execution lazy so abort/dispose wins before user code starts.
        operation: () => options.decide(error, attempt),
        timeoutMs: options.remainingTimeout?.() ?? false,
        signals: options.signals,
        createTimeoutError: options.createTimeoutError,
        createAbortError: options.createAbortError
      });
      if (!decision.retry) throw error;
      await waitWithSignal(
        decision.delayMs,
        options.signals,
        options.createAbortError,
        options.onDiagnostic
      );
    }
  }
  throw options.createAbortError();
}
