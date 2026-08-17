import type { IBackendKind } from '@migaia/storage-contract';
import { StorageOperation } from '../constants.js';
import { StorageError, StorageErrorCode } from '../types/errors.js';

// 类型与选项校验 guard 已迁往 `@migaia/storage-contract`；re-export 保持既有 import 路径不变。
export type { ITransactionScope, ITransactionWriteOptions } from '@migaia/storage-contract';
export { assertTransactionCallback, readTransactionConflictPolicy } from '@migaia/storage-contract';

/**
 * Reject work attempted after the owning transaction callback has settled（抛 web
 * `transactionFailed`，留 web）。
 */
export const assertTransactionScopeActive = (active: boolean, backend: IBackendKind): void => {
  if (active) return;
  throw new StorageError(StorageErrorCode.transactionFailed, {
    backend,
    operation: StorageOperation.transactionScope,
    cause: new Error('transaction scope is no longer active')
  });
};
