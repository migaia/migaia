/** Minimal cancellation signal shape shared by browser, worker and Node consumers. */
export type IAbortSignal = {
  readonly aborted: boolean;
  addEventListener(
    type: 'abort',
    listener: () => void,
    options?: { readonly once?: boolean }
  ): void;
  removeEventListener(type: 'abort', listener: () => void): void;
};

/** Detaches Node-compatible timers from process liveness when supported. */
export function unrefTimer<T extends ReturnType<typeof setTimeout>>(timer: T): T {
  (timer as T & { unref?: () => void }).unref?.();
  return timer;
}

/** Creates an idempotently clearable runtime timer owned by async-control. */
export function createRuntimeTimer(
  task: () => void,
  delayMs: number
): { readonly clear: () => void } {
  const timer = unrefTimer(setTimeout(task, delayMs));
  let cleared = false;
  return {
    clear: () => {
      if (cleared) return;
      cleared = true;
      clearTimeout(timer);
    }
  };
}

/** Waits for a delay while remaining cancellable by any supplied signal. */
export function waitWithSignal(
  delayMs: number,
  signals: readonly IAbortSignal[],
  createAbortError: () => Error,
  onDiagnostic?: (error: unknown) => void
): Promise<void> {
  if (!Number.isFinite(delayMs) || delayMs < 0) throw new TypeError('delay must be non-negative');
  return new Promise((resolve, reject) => {
    try {
      if (signals.some((signal) => signal.aborted)) {
        reject(createAbortError());
        return;
      }
    } catch (error) {
      reject(error);
      return;
    }
    let settled = false;
    let timer: { readonly clear: () => void } | undefined;
    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      timer?.clear();
      for (const signal of signals) {
        try {
          signal.removeEventListener('abort', onAbort);
        } catch (error) {
          try {
            onDiagnostic?.(error);
          } catch {}
        }
      }
      try {
        callback();
      } catch (error) {
        reject(error);
      }
    };
    const onAbort = (): void => finish(() => reject(createAbortError()));
    const registeredSignals: IAbortSignal[] = [];
    try {
      for (const signal of signals) {
        if (settled) break;
        signal.addEventListener('abort', onAbort, { once: true });
        registeredSignals.push(signal);
      }
    } catch (error) {
      for (const signal of registeredSignals) {
        try {
          signal.removeEventListener('abort', onAbort);
        } catch {}
      }
      reject(error);
      return;
    }
    if (settled) return;
    try {
      timer = createRuntimeTimer(() => finish(resolve), delayMs);
    } catch (error) {
      finish(() => reject(error));
    }
  });
}

/** Races an operation against timeout/abort controls while cleaning every loser. */
export function raceWithAsyncControl<T>(options: {
  /** A lazy operation avoids starting external side effects before cancellation checks. */
  readonly operation: () => PromiseLike<T>;
  readonly timeoutMs?: number | false;
  readonly signals?: readonly IAbortSignal[];
  readonly createTimeoutError: () => Error;
  readonly createAbortError: () => Error;
  readonly onTimeout?: () => void | Promise<void>;
  readonly onDiagnostic?: (error: unknown) => void;
}): Promise<T> {
  const signals = options.signals ?? [];
  if (
    options.timeoutMs !== undefined &&
    options.timeoutMs !== false &&
    (!Number.isFinite(options.timeoutMs) || options.timeoutMs < 0)
  )
    return Promise.reject(new TypeError('timeout must be false or a non-negative finite number'));
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    let timer: { readonly clear: () => void } | undefined;
    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      timer?.clear();
      for (const signal of signals) {
        try {
          signal.removeEventListener('abort', onAbort);
        } catch (error) {
          try {
            options.onDiagnostic?.(error);
          } catch {}
        }
      }
      try {
        callback();
      } catch (error) {
        reject(error);
      }
    };
    const onAbort = (): void => finish(() => reject(options.createAbortError()));
    try {
      if (signals.some((signal) => signal.aborted)) {
        onAbort();
        return;
      }
      for (const signal of signals) {
        if (settled) break;
        signal.addEventListener('abort', onAbort, { once: true });
      }
    } catch (error) {
      finish(() => reject(error));
      return;
    }
    if (settled) return;
    if (options.timeoutMs !== undefined && options.timeoutMs !== false) {
      timer = createRuntimeTimer(() => {
        try {
          const timeoutEffect = options.onTimeout?.();
          void Promise.resolve(timeoutEffect).catch((error) => {
            try {
              options.onDiagnostic?.(error);
            } catch {}
          });
        } catch (error) {
          try {
            options.onDiagnostic?.(error);
          } catch {}
        }
        finish(() => reject(options.createTimeoutError()));
      }, options.timeoutMs);
    }
    let operation: PromiseLike<T>;
    try {
      operation = options.operation();
    } catch (error) {
      finish(() => reject(error));
      return;
    }
    Promise.resolve(operation).then(
      (value) => finish(() => resolve(value)),
      (error) => finish(() => reject(error))
    );
  });
}
