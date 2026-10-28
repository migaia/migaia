import type { IBackendKind } from '@migaia/storage-contract'
import { StorageOperation } from '../constants.ts'
import { StorageError } from '../types/errors.ts'
import { StorageBrowserErrorCode } from '@migaia/storage-contract/error-code'
import { StorageErrorText } from '../error-text.ts'

// Transaction types and option validation guards belong to `@migaia/storage-contract`. Re-exports preserve existing import paths.
export type { ITransactionScope, ITransactionWriteOptions } from '@migaia/storage-contract'
export { assertTransactionCallback, readTransactionConflictPolicy } from '@migaia/storage-contract'

/**
 * Rejects work after the owning transaction callback settles. Throws the web-owned
 * `transactionFailed` error.
 */
export const assertTransactionScopeActive = (active: boolean, backend: IBackendKind): void => {
  if (active) return
  throw new StorageError(StorageBrowserErrorCode.transactionFailed, {
    backend,
    operation: StorageOperation.transactionScope,
    cause: new Error(StorageErrorText.transactionScopeInactive)
  })
}
