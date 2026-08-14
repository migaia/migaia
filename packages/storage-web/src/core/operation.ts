import type { IConflictPolicy, IOperationContext } from '../types/context';
import { StorageError, StorageErrorCode } from '../types/errors';

type IOperationValidationContext = IOperationContext & {
  readonly conflictPolicy?: unknown;
};

export type IOperationContextSnapshot = IOperationContext & {
  readonly conflictPolicy?: IConflictPolicy;
};

/** Tracks frozen snapshots created here so layered consumers never re-read host getters. */
const operationContextSnapshots = new WeakSet<object>();

/** Read operation options once, validate them, and return an immutable-by-ownership snapshot. */
export const snapshotOperationContext = (
  ctx: IOperationValidationContext | undefined
): IOperationContextSnapshot | undefined => {
  if (ctx === undefined) return undefined;
  if (operationContextSnapshots.has(ctx)) return ctx as IOperationContextSnapshot;
  if (typeof ctx !== 'object' || ctx === null || Array.isArray(ctx))
    throw new StorageError(StorageErrorCode.invalidArgument, {
      cause: new TypeError('operation context must be an object')
    });
  let signal: unknown;
  let timeoutMs: unknown;
  let pageSize: unknown;
  let conflictPolicy: unknown;
  try {
    signal = ctx.signal;
    timeoutMs = ctx.timeoutMs;
    pageSize = ctx.pageSize;
    conflictPolicy = ctx.conflictPolicy;
  } catch (cause) {
    throw new StorageError(StorageErrorCode.invalidArgument, { cause });
  }
  let signalAborted: unknown;
  let signalAddEventListener: unknown;
  let signalRemoveEventListener: unknown;
  if (typeof signal === 'object' && signal !== null) {
    try {
      signalAborted = (signal as AbortSignal).aborted;
      signalAddEventListener = (signal as AbortSignal).addEventListener;
      signalRemoveEventListener = (signal as AbortSignal).removeEventListener;
    } catch (cause) {
      throw new StorageError(StorageErrorCode.invalidArgument, { cause });
    }
  }
  if (
    signal !== undefined &&
    (typeof signal !== 'object' ||
      signal === null ||
      typeof signalAborted !== 'boolean' ||
      typeof signalAddEventListener !== 'function' ||
      typeof signalRemoveEventListener !== 'function')
  )
    throw new StorageError(StorageErrorCode.invalidArgument, {
      cause: new TypeError('signal must implement the AbortSignal surface')
    });
  if (timeoutMs !== undefined && (!Number.isSafeInteger(timeoutMs) || (timeoutMs as number) < 0))
    throw new StorageError(StorageErrorCode.invalidArgument, {
      cause: new RangeError('timeoutMs must be a non-negative safe integer')
    });
  if (
    pageSize !== undefined &&
    (!Number.isInteger(pageSize) || (pageSize as number) < 1 || (pageSize as number) > 4096)
  )
    throw new StorageError(StorageErrorCode.invalidArgument, {
      cause: new RangeError('pageSize must be an integer between 1 and 4096')
    });
  if (conflictPolicy !== undefined && conflictPolicy !== 'conflict' && conflictPolicy !== 'replace')
    throw new StorageError(StorageErrorCode.invalidArgument, {
      cause: new TypeError('conflictPolicy must be conflict or replace')
    });
  const snapshot: IOperationContextSnapshot = Object.freeze({
    signal: signal as AbortSignal | undefined,
    timeoutMs: timeoutMs as number | undefined,
    pageSize: pageSize as number | undefined,
    conflictPolicy: conflictPolicy as IConflictPolicy | undefined
  });
  operationContextSnapshots.add(snapshot);
  return snapshot;
};

/** Validate operation timing options before creating timers or merged signals. */
export const assertOperationContext = (ctx: IOperationValidationContext | undefined): void => {
  snapshotOperationContext(ctx);
};

/** Validate the reduced write context supported by synchronous channels. */
export const snapshotSyncWriteOptions = (
  options: unknown
): { readonly conflictPolicy?: IConflictPolicy } => {
  if (
    options !== undefined &&
    (typeof options !== 'object' || options === null || Array.isArray(options))
  )
    throw new StorageError(StorageErrorCode.invalidArgument, {
      cause: new TypeError('sync write options must be an object')
    });
  const candidate = options as
    | { readonly signal?: unknown; readonly timeoutMs?: unknown; readonly conflictPolicy?: unknown }
    | undefined;
  let signal: unknown;
  let timeoutMs: unknown;
  let conflictPolicy: unknown;
  try {
    signal = candidate?.signal;
    timeoutMs = candidate?.timeoutMs;
    conflictPolicy = candidate?.conflictPolicy;
  } catch (cause) {
    throw new StorageError(StorageErrorCode.invalidArgument, { cause });
  }
  if (signal !== undefined || timeoutMs !== undefined)
    throw new StorageError(StorageErrorCode.invalidArgument, {
      cause: new TypeError('sync writes do not support signal or timeoutMs')
    });
  if (conflictPolicy !== undefined && conflictPolicy !== 'conflict' && conflictPolicy !== 'replace')
    throw new StorageError(StorageErrorCode.invalidArgument, {
      cause: new TypeError('conflictPolicy must be conflict or replace')
    });
  return { conflictPolicy: conflictPolicy as IConflictPolicy | undefined };
};

/** Validate the reduced write context supported by synchronous channels. */
export const assertSyncWriteOptions = (options: unknown): void => {
  snapshotSyncWriteOptions(options);
};

/** Read mutable abort state without allowing a hostile getter to escape the storage protocol. */
const readSignalAborted = (signal: AbortSignal | undefined): boolean => {
  if (signal === undefined) return false;
  try {
    return signal.aborted;
  } catch (cause) {
    throw new StorageError(StorageErrorCode.invalidArgument, { cause });
  }
};

/** Treat an inaccessible abort reason as the cancellation cause instead of leaking its getter. */
export const readAbortReason = (signal: AbortSignal | undefined): unknown => {
  if (signal === undefined) return undefined;
  try {
    return signal.reason;
  } catch (cause) {
    return cause;
  }
};

/** Subscribe once with race closure and return cleanup that cannot mask an operation result. */
export const subscribeToAbort = (
  signal: AbortSignal | undefined,
  onAbort: () => void
): (() => void) => {
  if (signal === undefined) return () => {};
  /** Prevents host cleanup from being re-entered by racing IDB and abort events. */
  let disposed = false;
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    try {
      signal.removeEventListener('abort', handleAbort);
    } catch {
      // Cleanup must not replace a settled operation outcome.
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
    if (cause instanceof StorageError) throw cause;
    throw new StorageError(StorageErrorCode.invalidArgument, { cause });
  }
  return dispose;
};

/** Throw the stable storage error when an operation signal has already been cancelled. */
export const throwIfAborted = (signal: AbortSignal | undefined): void => {
  if (readSignalAborted(signal))
    throw new StorageError(StorageErrorCode.aborted, {
      cause: readAbortReason(signal as AbortSignal)
    });
};

/** Merge timeout and caller cancellation into one signal and expose deterministic cleanup. */
export const mergeSignals = (
  ctx: IOperationValidationContext | undefined
): {
  readonly signal: AbortSignal | undefined;
  readonly dispose: () => void;
  readonly context: IOperationContextSnapshot | undefined;
} => {
  const context = snapshotOperationContext(ctx);
  const timeoutMs = context?.timeoutMs;
  const externalSignal = context?.signal;
  if (timeoutMs === undefined) return { signal: externalSignal, dispose: () => {}, context };
  const externalAborted = readSignalAborted(externalSignal);

  const controller = new AbortController();
  const timer =
    timeoutMs === 0
      ? undefined
      : setTimeout(() => controller.abort(new StorageError(StorageErrorCode.aborted)), timeoutMs);
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
    } catch {
      // Host cleanup is best-effort; surfacing it could misreport a committed write as failed.
    }
  };

  if (externalAborted)
    controller.abort(externalSignal === undefined ? undefined : readAbortReason(externalSignal));
  else if (timeoutMs === 0) controller.abort(new StorageError(StorageErrorCode.aborted));
  else if (externalSignal) {
    try {
      externalSignal.addEventListener('abort', onExternalAbort, { once: true });
      // Close the check→subscribe race when abort happened immediately before registration.
      if (readSignalAborted(externalSignal)) onExternalAbort();
    } catch (cause) {
      dispose();
      if (cause instanceof StorageError) throw cause;
      throw new StorageError(StorageErrorCode.invalidArgument, { cause });
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
    context: IOperationContextSnapshot | undefined
  ) => Promise<T>
): Promise<T> => {
  const { signal, dispose, context } = mergeSignals(ctx);
  try {
    throwIfAborted(signal);
    return await run(signal, context);
  } finally {
    dispose();
  }
};
