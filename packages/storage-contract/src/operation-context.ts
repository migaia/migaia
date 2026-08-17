import type { IAbortSignal } from '@migaia/lifecycle';
import { StorageContractError, StorageContractErrorCode } from './errors.js';
import type { IConflictPolicy, IOperationContext } from './context.js';

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
    throw new StorageContractError(StorageContractErrorCode.invalidArgument, {
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
    throw new StorageContractError(StorageContractErrorCode.invalidArgument, { cause });
  }
  let signalAborted: unknown;
  let signalAddEventListener: unknown;
  let signalRemoveEventListener: unknown;
  if (typeof signal === 'object' && signal !== null) {
    try {
      signalAborted = (signal as IAbortSignal).aborted;
      signalAddEventListener = (signal as IAbortSignal).addEventListener;
      signalRemoveEventListener = (signal as IAbortSignal).removeEventListener;
    } catch (cause) {
      throw new StorageContractError(StorageContractErrorCode.invalidArgument, { cause });
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
    throw new StorageContractError(StorageContractErrorCode.invalidArgument, {
      cause: new TypeError('signal must implement the IAbortSignal surface')
    });
  if (timeoutMs !== undefined && (!Number.isSafeInteger(timeoutMs) || (timeoutMs as number) < 0))
    throw new StorageContractError(StorageContractErrorCode.invalidArgument, {
      cause: new RangeError('timeoutMs must be a non-negative safe integer')
    });
  if (
    pageSize !== undefined &&
    (!Number.isInteger(pageSize) || (pageSize as number) < 1 || (pageSize as number) > 4096)
  )
    throw new StorageContractError(StorageContractErrorCode.invalidArgument, {
      cause: new RangeError('pageSize must be an integer between 1 and 4096')
    });
  if (conflictPolicy !== undefined && conflictPolicy !== 'conflict' && conflictPolicy !== 'replace')
    throw new StorageContractError(StorageContractErrorCode.invalidArgument, {
      cause: new TypeError('conflictPolicy must be conflict or replace')
    });
  const snapshot: IOperationContextSnapshot = Object.freeze({
    signal: signal as IAbortSignal | undefined,
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
    throw new StorageContractError(StorageContractErrorCode.invalidArgument, {
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
    throw new StorageContractError(StorageContractErrorCode.invalidArgument, { cause });
  }
  if (signal !== undefined || timeoutMs !== undefined)
    throw new StorageContractError(StorageContractErrorCode.invalidArgument, {
      cause: new TypeError('sync writes do not support signal or timeoutMs')
    });
  if (conflictPolicy !== undefined && conflictPolicy !== 'conflict' && conflictPolicy !== 'replace')
    throw new StorageContractError(StorageContractErrorCode.invalidArgument, {
      cause: new TypeError('conflictPolicy must be conflict or replace')
    });
  return { conflictPolicy: conflictPolicy as IConflictPolicy | undefined };
};

/** Validate the reduced write context supported by synchronous channels. */
export const assertSyncWriteOptions = (options: unknown): void => {
  snapshotSyncWriteOptions(options);
};
