import { StorageContractError, StorageContractErrorCode } from '@migaia/storage-contract'
import { createStorageRedoJournal } from './redo.ts'
import { createStorageNativeJournal } from './commit.ts'
import type { IStorageJournalBackendAccess } from './binding.ts'
import type { IStorageJournalConfigurationSnapshot } from './configuration-options.ts'

/** Prepare only the implemented native guarantee; unimplemented selected guarantees fail closed. */
export function prepareStorageJournalConfiguration(
  options: IStorageJournalConfigurationSnapshot,
  access: IStorageJournalBackendAccess,
  backend: import('@migaia/storage-contract').IBackendKind,
  observation?: Pick<
    Parameters<typeof createStorageNativeJournal>[0],
    'report' | 'onBinlogAppendError' | 'beforeRecover' | 'afterRecover' | 'onRecoverError'
  >
) {
  if (access.binding.redo !== undefined) {
    if (
      options.logger.wal === undefined ||
      options.redoWal !== options.logger.wal ||
      options.logger.undo !== undefined ||
      options.atomicBinlog !== undefined ||
      options.atomicUndo !== undefined
    )
      return Promise.reject(new StorageContractError(StorageContractErrorCode.unsupported))
    return createStorageRedoJournal({
      access,
      backend,
      namespace: options.namespace,
      logger: options.logger,
      binlogValues: options.binlogValues,
      ...observation
    })
  }
  /** An unselected text owner must not silently accept WAL while bypassing redo capture. */
  if (options.logger.wal !== undefined && access.binding.changes === undefined)
    return Promise.reject(new StorageContractError(StorageContractErrorCode.unsupported))
  if (options.logger.binlog === undefined && options.logger.undo === undefined)
    return Promise.resolve(undefined)
  if (
    access.binding.requiresIndexedDbUndo === true &&
    options.logger.undo !== undefined &&
    options.indexedDbUndo !== true
  )
    return Promise.reject(new StorageContractError(StorageContractErrorCode.unsupported))
  return createStorageNativeJournal({
    access,
    backend,
    namespace: options.namespace,
    logger: options.logger,
    atomicBinlog: options.atomicBinlog?.[access.backendInstanceId],
    atomicUndo: options.atomicUndo?.[access.backendInstanceId],
    binlogValues: options.binlogValues,
    ...observation
  })
}
