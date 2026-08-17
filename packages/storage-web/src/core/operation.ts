import type { IOperationContext } from '@migaia/storage-contract';
import {
  StorageContractError,
  StorageContractErrorCode,
  snapshotOperationContext,
  type IOperationContextSnapshot
} from '@migaia/storage-contract';
import { isStorageErrorFamily } from './error-family.js';
import {
  createStorageOperationRuntime,
  reportCleanupError,
  type IStorageOperationReporter,
  type IStorageOperationRuntime
} from './operation-reporter.js';

// operation context / sync-write 纯校验已迁往 `@migaia/storage-contract`；re-export 保持既有 import 路径不变。
export {
  snapshotOperationContext,
  assertOperationContext,
  snapshotSyncWriteOptions,
  assertSyncWriteOptions,
  type IOperationContextSnapshot
} from '@migaia/storage-contract';

type IOperationValidationContext = IOperationContext & {
  readonly conflictPolicy?: unknown;
};

/** 结构化取消信号（与 contract 的 `IOperationContext.signal` 同源，避免直接 import `@migaia/lifecycle`）。 */
export type IWebAbortSignal = NonNullable<IOperationContext['signal']>;

/** Read mutable abort state without allowing a hostile getter to escape the storage protocol. */
const readSignalAborted = (signal: IWebAbortSignal | undefined): boolean => {
  if (signal === undefined) return false;
  try {
    return signal.aborted;
  } catch (cause) {
    throw new StorageContractError(StorageContractErrorCode.invalidArgument, { cause });
  }
};

/** Treat an inaccessible abort reason as the cancellation cause instead of leaking its getter. */
export const readAbortReason = (signal: IWebAbortSignal | undefined): unknown => {
  if (signal === undefined) return undefined;
  try {
    return signal.reason;
  } catch (cause) {
    return cause;
  }
};

/** Subscribe once with race closure and return cleanup that cannot mask an operation result. */
export const subscribeToAbort = (
  signal: IWebAbortSignal | undefined,
  onAbort: () => void,
  reporter: IStorageOperationReporter
): (() => void) => {
  if (signal === undefined) return () => {};
  /** Prevents host cleanup from being re-entered by racing IDB and abort events. */
  let disposed = false;
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    try {
      signal.removeEventListener('abort', handleAbort);
    } catch (cause) {
      reportCleanupError(reporter, cause);
    }
  };
  const handleAbort = (): void => {
    dispose();
    onAbort();
  };
  if (readSignalAborted(signal)) {
    handleAbort();
    return dispose;
  }
  try {
    signal.addEventListener('abort', handleAbort, { once: true });
    if (readSignalAborted(signal)) handleAbort();
  } catch (cause) {
    dispose();
    if (isStorageErrorFamily(cause)) throw cause;
    throw new StorageContractError(StorageContractErrorCode.invalidArgument, { cause });
  }
  return dispose;
};

/** Throw the stable storage error when an operation signal has already been cancelled. */
export const throwIfAborted = (signal: IWebAbortSignal | undefined): void => {
  if (readSignalAborted(signal))
    throw new StorageContractError(StorageContractErrorCode.aborted, {
      cause: readAbortReason(signal)
    });
};

/** Merge timeout and caller cancellation into one signal and expose deterministic cleanup. */
export const mergeSignals = (
  ctx: IOperationValidationContext | undefined,
  reporter: IStorageOperationReporter
): {
  readonly signal: AbortSignal | undefined;
  readonly dispose: () => void;
  readonly context: IOperationContextSnapshot | undefined;
} => {
  const context = snapshotOperationContext(ctx);
  const timeoutMs = context?.timeoutMs;
  // 运行时值恒为真实 DOM AbortSignal（调用方传入），结构类型收窄回 DOM 供 IDB/后端使用。
  const externalSignal = context?.signal as AbortSignal | undefined;
  if (timeoutMs === undefined) return { signal: externalSignal, dispose: () => {}, context };
  const externalAborted = readSignalAborted(externalSignal);

  const controller = new AbortController();
  const timer =
    timeoutMs === 0
      ? undefined
      : setTimeout(
          () => controller.abort(new StorageContractError(StorageContractErrorCode.aborted)),
          timeoutMs
        );
  const onExternalAbort = (): void =>
    controller.abort(externalSignal === undefined ? undefined : readAbortReason(externalSignal));

  /** Prevents repeated cleanup from re-entering hostile host listener methods. */
  let disposed = false;
  /** Cleanup must never turn an already-completed operation into a reported failure. */
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    if (timer !== undefined) clearTimeout(timer);
    if (externalSignal === undefined) return;
    try {
      externalSignal.removeEventListener('abort', onExternalAbort);
    } catch (cause) {
      reportCleanupError(reporter, cause);
    }
  };

  if (externalAborted)
    controller.abort(externalSignal === undefined ? undefined : readAbortReason(externalSignal));
  else if (timeoutMs === 0)
    controller.abort(new StorageContractError(StorageContractErrorCode.aborted));
  else if (externalSignal) {
    try {
      externalSignal.addEventListener('abort', onExternalAbort, { once: true });
      // Close the check→subscribe race when abort happened immediately before registration.
      if (readSignalAborted(externalSignal)) onExternalAbort();
    } catch (cause) {
      dispose();
      if (isStorageErrorFamily(cause)) throw cause;
      throw new StorageContractError(StorageContractErrorCode.invalidArgument, { cause });
    }
  }

  return {
    signal: controller.signal,
    context,
    dispose
  };
};

/** Run an async operation with unified cancellation and guaranteed timer/listener cleanup. */
export const withAbort = async <T>(
  ctx: IOperationValidationContext | undefined,
  run: (
    signal: AbortSignal | undefined,
    context: IOperationContextSnapshot | undefined,
    runtime: IStorageOperationRuntime
  ) => Promise<T>
): Promise<T> => {
  const runtime = createStorageOperationRuntime();
  const { signal, dispose, context } = mergeSignals(ctx, runtime.reporter);
  try {
    throwIfAborted(signal);
    return await run(signal, context, runtime);
  } finally {
    dispose();
  }
};
