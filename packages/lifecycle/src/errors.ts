import type { ICollectedError, IErrorPolicy } from './types.js';
import { LifecycleErrorCode } from './error-code.js';
import { ThenableProbeKind } from './state-constants.js';

/**
 * 一次读取的 thenable 探测结果（`lifecycle-extraction.sdd.md` §3「then 只读一次」）。
 *
 * 区分「非 thenable」「thenable（已捕获 then）」「getter 失败」三种，保证 hostile/stateful getter 只被读取一次、且 getter
 * 异常不被静默吞掉。
 */
export type IThenableProbe =
  | { readonly kind: typeof ThenableProbeKind.notThenable }
  | {
      readonly kind: typeof ThenableProbeKind.thenable;
      readonly thenFn: (resolve: unknown, reject: unknown) => void;
    }
  | { readonly kind: typeof ThenableProbeKind.failed; readonly error: unknown };

/** 一次读取 `value.then`，返回判别结果；getter 抛错归入 `failed`，绝不把探测异常静默改写。 */
export function probeThenable(value: unknown): IThenableProbe {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) {
    return { kind: ThenableProbeKind.notThenable };
  }
  let thenFn: unknown;
  try {
    thenFn = (value as { then?: unknown }).then;
  } catch (error) {
    return { kind: ThenableProbeKind.failed, error };
  }
  if (typeof thenFn !== 'function') return { kind: ThenableProbeKind.notThenable };
  return {
    kind: ThenableProbeKind.thenable,
    thenFn: thenFn as (resolve: unknown, reject: unknown) => void
  };
}

/**
 * Assimilates a thenable whose `.then` was already captured by `probeThenable`, invoking it exactly
 * once with the thenable as receiver (Promise/A+) and no second `.then` read.
 *
 * This is the package's single reflective receiver-binding boundary. Preserving `this === thenable`
 * together with the single-read guarantee requires `Reflect.apply` — an arrow function captures
 * lexical context, it cannot supply an arbitrary receiver — while the repository rule forbids
 * `Function.prototype.call`/`apply`/`bind`. `Reflect.apply` (the `Reflect` static, distinct from
 * `Function.prototype.apply`) appears nowhere else in this package.
 */
export function assimilateCapturedThen<T>(
  thenFn: (resolve: unknown, reject: unknown) => void,
  thenable: unknown
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    try {
      Reflect.apply(thenFn, thenable, [resolve, reject]);
    } catch (error) {
      reject(error);
    }
  });
}

/** `source` value stamped onto every error this package throws. */
export const LIFECYCLE_SOURCE = '@migaia/lifecycle';

/**
 * The structural error contract every package in the workspace follows
 * (`docs/contracts/error-codes.md` §2). Attached as properties on a real `Error`, never used to
 * replace it — callers that branch on `instanceof DOMException`/`RangeError`/etc. keep working.
 */
export type ILifecycleError = Error & {
  readonly source: string;
  readonly code: string;
  readonly phase?: string;
  readonly detail?: Readonly<Record<string, unknown>>;
  readonly cause?: unknown;
  /** 冻结的次要失败快照（如 cleanup 失败），不与 `cause` 混用；primary 保持原错误身份。 */
  readonly errors?: readonly unknown[];
};

/**
 * Builds a `(source, code)`-tagged error without ever touching `stack` — the engine populates it at
 * construction and this function never reassigns it, so the original throw site is always visible.
 */
export function createLifecycleError(
  code: string,
  message: string,
  options?: {
    readonly cause?: unknown;
    readonly phase?: string;
    readonly detail?: Readonly<Record<string, unknown>>;
    readonly errors?: readonly unknown[];
  }
): ILifecycleError {
  const error = new Error(
    message,
    options?.cause !== undefined ? { cause: options.cause } : undefined
  );
  Object.defineProperty(error, 'source', { value: LIFECYCLE_SOURCE, enumerable: true });
  Object.defineProperty(error, 'code', { value: code, enumerable: true });
  if (options?.phase !== undefined) {
    Object.defineProperty(error, 'phase', { value: options.phase, enumerable: true });
  }
  if (options?.detail !== undefined) {
    Object.defineProperty(error, 'detail', { value: options.detail, enumerable: true });
  }
  if (options?.errors !== undefined && options.errors.length > 0) {
    Object.defineProperty(error, 'errors', {
      value: Object.freeze([...options.errors]),
      enumerable: true
    });
  }
  return error as ILifecycleError;
}

/**
 * Stamps `(source, code)` onto an error object we did not construct ourselves (e.g. a built-in
 * `AggregateError`) without touching `stack`, `message`, or `errors`. Used where the error's _type_
 * matters to callers (`AggregateError`) so `createLifecycleError`'s plain `Error` cannot be used.
 */
export function tagLifecycleError<E extends Error>(error: E, code: string): E {
  Object.defineProperty(error, 'source', { value: LIFECYCLE_SOURCE, enumerable: true });
  Object.defineProperty(error, 'code', { value: code, enumerable: true });
  return error;
}

/** 入参校验错误：原生 `RangeError` + 指定 code（`docs/contracts/error-codes.md` §2.2 保持原生类型）。 */
export function createLifecycleRangeError(code: string, message: string): RangeError {
  return tagLifecycleError(new RangeError(message), code);
}

/**
 * Ported from `@migaia/capability`'s `containAsyncRejection`.
 *
 * `() => void` in TypeScript still accepts an `async` function. This guards a diagnostic/release
 * callback's return value for a thenable and observes its rejection, so a callback that turns out
 * to be `async` behind our backs doesn't surface as an unhandled rejection one microtask later
 * (L-T17, L-T26, L-T35).
 */
export function containAsyncRejection(value: unknown, onRejected: (error: unknown) => void): void {
  if ((value === null || typeof value !== 'object') && typeof value !== 'function') return;
  let then: unknown;
  try {
    then = (value as { then?: unknown }).then;
  } catch (error) {
    onRejected(error);
    return;
  }
  if (typeof then !== 'function') return;
  // Reuse the `then` we already read — `assimilateCapturedThen` invokes it exactly once with the
  // thenable as receiver, so we never hand the value back to `Promise.resolve()` to read `.then` a
  // second time (a stateful getter could return a different function or throw on the second read).
  const settled = assimilateCapturedThen<unknown>(
    then as (resolve: unknown, reject: unknown) => void,
    value
  );
  void settled.catch((error: unknown) => {
    try {
      onRejected(error);
    } catch {
      // The rejection handler is itself the last error boundary; it must not manufacture a new
      // unhandled rejection by throwing back out of this `.catch`.
    }
  });
}

/** Collects errors under one of the four policies (D-4) and produces the correct finalize behavior. */
export type IErrorCollector = {
  readonly policy: IErrorPolicy;
  /** Records one item's failure. For `report`, this is also where the reporter is invoked. */
  add(source: string, error: unknown): void;
  /**
   * Finalizes collection. `collect`/`report`/`firstError`-with-no-error return the collected list
   * (empty for `report`, since those were already handed to the reporter per `add`); `throw` and
   * `firstError`-with-an-error throw instead of returning.
   */
  finalize(message: string): readonly ICollectedError[];
};

export function createErrorCollector(
  policy: IErrorPolicy,
  report: ((error: unknown) => void) | undefined
): IErrorCollector {
  const entries: ICollectedError[] = [];
  let firstError: unknown;
  let hasFirstError = false;

  const invokeReport = (error: unknown): void => {
    if (!report) return;
    try {
      const result: unknown = report(error);
      containAsyncRejection(result, () => {
        // The reporter's own async failure has no lower layer to report to; it terminates here.
      });
    } catch {
      // The reporter is the last error boundary for its own failures too (L-T35).
    }
  };

  return {
    policy,
    add(source, error) {
      if (policy === 'report') {
        invokeReport(error);
        return;
      }
      if (policy === 'firstError') {
        if (!hasFirstError) {
          hasFirstError = true;
          firstError = error;
        } else {
          // L-T38：后续错误必须被观测，但不得改变「首错原样抛出」的结果。经 reporter 观测（与 `report`
          // 策略同通道），绝不静默吞掉；无 reporter 时与 `report` 策略一致地降级为无观测通道。
          invokeReport(error);
        }
        return;
      }
      entries.push({ source, error });
    },
    finalize(message) {
      if (policy === 'report') return [];
      if (policy === 'firstError') {
        if (hasFirstError) throw firstError;
        return [];
      }
      if (policy === 'collect') return [...entries];
      // 'throw': a single error is thrown exactly as the caller produced it — untagged, since it is
      // their error, not ours. The multi-error aggregate is a shape we construct ourselves, so it
      // carries our own (source, code) (L-T41: `SCOPE_DISPOSAL_FAILED`).
      if (entries.length === 1) throw entries[0]!.error;
      if (entries.length > 1) {
        throw tagLifecycleError(
          new AggregateError(
            entries.map((entry) => entry.error),
            message
          ),
          LifecycleErrorCode.scopeDisposalFailed
        );
      }
      return [];
    }
  };
}
