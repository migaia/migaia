import type { IConflictPolicy, IStorageKey } from '../types/context';
import type { IBackendKind } from '../types/capabilities';
import { StorageError, StorageErrorCode } from '../types/errors';

export type ITransactionWriteOptions = {
  readonly conflictPolicy?: IConflictPolicy;
};

/** Backend-neutral transaction scope shared by memory and IndexedDB commit engines. */
export type ITransactionScope<TValue = unknown> = {
  get(key: IStorageKey): Promise<TValue | undefined>;
  put(value: TValue, key?: IStorageKey, options?: ITransactionWriteOptions): Promise<IStorageKey>;
  delete(key: IStorageKey): Promise<void>;
};

/** Validate transaction entry callbacks before a backend allocates snapshot/connection state. */
export const assertTransactionCallback = (run: unknown, backend: IBackendKind): void => {
  if (typeof run === 'function') return;
  throw new StorageError(StorageErrorCode.invalidArgument, {
    backend,
    operation: 'transaction',
    cause: new TypeError('transaction callback must be a function')
  });
};

/** Validate and snapshot scope write options shared by both transaction engines. */
export const readTransactionConflictPolicy = (
  options: unknown,
  backend: IBackendKind
): IConflictPolicy => {
  if (options === undefined) return 'conflict';
  if (typeof options === 'object' && options !== null && !Array.isArray(options)) {
    let policy: unknown;
    try {
      policy = (options as { conflictPolicy?: unknown }).conflictPolicy;
    } catch (cause) {
      throw new StorageError(StorageErrorCode.invalidArgument, {
        backend,
        operation: 'transaction.put',
        cause
      });
    }
    if (policy === undefined || policy === 'conflict') return 'conflict';
    if (policy === 'replace') return 'replace';
  }
  throw new StorageError(StorageErrorCode.invalidArgument, {
    backend,
    operation: 'transaction.put',
    cause: new TypeError('transaction write options contain an invalid conflictPolicy')
  });
};

/** Reject work attempted after the owning transaction callback has settled. */
export const assertTransactionScopeActive = (active: boolean, backend: IBackendKind): void => {
  if (active) return;
  throw new StorageError(StorageErrorCode.transactionFailed, {
    backend,
    operation: 'transaction.scope',
    cause: new Error('transaction scope is no longer active')
  });
};
