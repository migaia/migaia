import { containAsyncRejection, createLifecycleError, type ILifecycleError } from './errors.js';
import { LifecycleErrorCode } from './error-code.js';
import { createAbortController, type IAbortController, type IAbortSignal } from './abort.js';
import { systemScheduler, type ILifecycleScheduler, type IScheduledTask } from './scheduler.js';

export type IGenerationToken = object;

export type IGenerationRequest = {
  readonly generation: number;
  readonly token: IGenerationToken;
  readonly signal: IAbortSignal;
};

export type IGenerationControllerOptions = {
  /** When this aborts, the currently-active generation's `signal` aborts too (L-T31). */
  readonly parentSignal?: IAbortSignal;
  /**
   * Diagnostic channel fired from `adopt()` whenever `token` is no longer current — before the
   * release attempt, regardless of whether it succeeds. The value is a
   * `GENERATION_SUPERSEDED`-tagged error used purely as a `(source, code)`-bearing carrier; this is
   * explicitly _not_ a failure signal (§4.10.2), just an observability hook for callers that want
   * to notice the race without treating it as an error.
   */
  readonly onSuperseded?: (info: ILifecycleError) => void;
  /** Runtime-neutral scheduler（默认 `systemScheduler`）；`begin({ timeoutMs })` 的超时计时经它。 */
  readonly scheduler?: ILifecycleScheduler;
};

export type IGenerationController = {
  readonly generation: number;
  readonly disposed: boolean;
  /**
   * Starts a new generation, superseding whatever was active. Optionally auto-aborts after
   * `timeoutMs`.
   */
  begin(options?: { readonly timeoutMs?: number }): IGenerationRequest;
  isCurrent(token: IGenerationToken): boolean;
  /**
   * Invalidates the current generation without disposing the controller — a later `begin()` still
   * works.
   */
  supersede(reason?: unknown): void;
  /**
   * Adopts `value` under `token`'s generation. Returns `true` and keeps `value` with the caller if
   * that generation is still current. Otherwise releases `value` via `release` and returns `false`
   * (L-T6) — a release failure is funneled to `onReleaseError` and never mutates controller state,
   * so it cannot poison whichever generation is current now (L-T30).
   */
  adopt<T>(
    token: IGenerationToken,
    value: T,
    release: (value: T) => void | PromiseLike<void>,
    onReleaseError?: (error: unknown) => void
  ): boolean;
  dispose(reason?: unknown): void;
};

/**
 * Merges `@migaia/reactive`'s `RequestControllerImpl`+`GenerationController` with `web-rpc`'s
 * `OperationScope`: token identity, an `AbortSignal` per generation, an optional per-generation
 * timeout, and automatic abort when a parent's closing signal fires.
 */
export function createGenerationController(
  options: IGenerationControllerOptions = {}
): IGenerationController {
  const scheduler = options.scheduler ?? systemScheduler;
  let generation = 0;
  let currentToken: IGenerationToken | undefined;
  let currentController: IAbortController | undefined;
  let currentParentListener: (() => void) | undefined;
  let currentTimer: IScheduledTask | undefined;
  let disposed = false;

  const abortCurrent = (reason?: unknown): void => {
    if (currentTimer) {
      currentTimer.cancel();
      currentTimer = undefined;
    }
    if (currentParentListener)
      options.parentSignal?.removeEventListener('abort', currentParentListener);
    currentController?.abort(reason);
    currentController = undefined;
    currentParentListener = undefined;
    currentToken = undefined;
  };

  const reportReleaseError = (
    onReleaseError: ((error: unknown) => void) | undefined,
    error: unknown
  ): void => {
    if (!onReleaseError) return;
    try {
      onReleaseError(error);
    } catch {
      // The release-error callback is itself the last boundary; it must not manufacture a new
      // unhandled failure by throwing back out.
    }
  };

  return {
    get generation() {
      return generation;
    },
    get disposed() {
      return disposed;
    },
    begin(beginOptions) {
      if (disposed) {
        throw createLifecycleError(
          LifecycleErrorCode.generationDisposed,
          '[lifecycle] cannot begin a new generation on a disposed GenerationController'
        );
      }
      abortCurrent('superseded by a new generation');
      generation++;
      const token: IGenerationToken = {};
      const controller = createAbortController();
      currentToken = token;
      currentController = controller;
      // parent abort 与 timeout 都原子作废当前 token（AF-14）：作废 = 取消 timer + 移除 parent listener。
      let invalidatedByParent = false;
      if (options.parentSignal) {
        if (options.parentSignal.aborted) {
          // 已 abort 的 parent：本次 generation 立即失效，不建 timer、不建 listener。
          abortCurrent(options.parentSignal.reason);
          invalidatedByParent = true;
        } else {
          const listener = (): void => abortCurrent(options.parentSignal!.reason);
          currentParentListener = listener;
          options.parentSignal.addEventListener('abort', listener, { once: true });
        }
      }
      if (!invalidatedByParent && beginOptions?.timeoutMs !== undefined) {
        currentTimer = scheduler.schedule(
          () => abortCurrent('generation timed out'),
          beginOptions.timeoutMs
        );
      }
      return { generation, token, signal: controller.signal };
    },
    isCurrent(token) {
      return !disposed && currentToken === token;
    },
    supersede(reason) {
      if (disposed) return;
      generation++;
      abortCurrent(reason);
    },
    adopt(token, value, release, onReleaseError) {
      if (!disposed && currentToken === token) return true;
      if (options.onSuperseded) {
        try {
          options.onSuperseded(
            createLifecycleError(
              LifecycleErrorCode.generationSuperseded,
              '[lifecycle] generation superseded before its result could be adopted'
            )
          );
        } catch {
          // The diagnostic callback is the last boundary for its own synchronous failures.
        }
      }
      let result: void | PromiseLike<void>;
      try {
        result = release(value);
      } catch (error) {
        reportReleaseError(onReleaseError, error);
        return false;
      }
      containAsyncRejection(result, (error) => reportReleaseError(onReleaseError, error));
      return false;
    },
    dispose(reason) {
      if (disposed) return;
      disposed = true;
      generation++;
      abortCurrent(reason);
    }
  };
}
