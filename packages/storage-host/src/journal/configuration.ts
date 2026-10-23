import { StorageContractError, StorageContractErrorCode } from '@migaia/storage-contract'
import type { IBinlogExt, IUndoLogExt, IWalExt, ILogStore } from '@migaia/logger/plugins/durable'
import type { IStorageJournalConfiguration } from './types.js'
import { createStorageNativeJournal } from './commit.js'
import type { IStorageJournalBackendAccess } from './binding.js'
import { isStorageErrorFamily } from '../core/error-family.js'

/** Configuration data stays with the original org cell; these maps grant no backend authority. */
export type IStorageJournalConfigurationSnapshot = Readonly<{
  logger: Partial<IBinlogExt & IUndoLogExt & IWalExt>
  namespace: string
  binlogValues: boolean | undefined
  atomicBinlog: Readonly<Record<string, ILogStore>> | undefined
  atomicUndo: Readonly<Record<string, ILogStore>> | undefined
  indexedDbUndo: boolean | undefined
  telemetry: boolean | undefined
}>

/** Capture native handle selections once, preserving each exact original store object. */
function snapshotSelections(input: Readonly<Record<string, ILogStore>> | undefined) {
  if (input === undefined) return undefined
  if (typeof input !== 'object' || input === null || Array.isArray(input))
    throw new StorageContractError(StorageContractErrorCode.invalidArgument)
  const result: Record<string, ILogStore> = Object.create(null)
  for (const key of Object.keys(input)) result[key] = input[key]!
  return Object.freeze(result)
}

/** Snapshot public options without invoking native I/O or revisiting caller getters later. */
export function snapshotStorageJournalConfiguration(
  input: Exclude<IStorageJournalConfiguration, Function>
): IStorageJournalConfigurationSnapshot {
  try {
    const { logger, namespace, binlogValues, atomicBinlog, atomicUndo, indexedDbUndo, telemetry } =
      input
    if (
      typeof logger !== 'object' ||
      logger === null ||
      typeof namespace !== 'string' ||
      namespace.length === 0 ||
      [binlogValues, indexedDbUndo, telemetry].some(
        (value) => value !== undefined && typeof value !== 'boolean'
      )
    )
      throw new StorageContractError(StorageContractErrorCode.invalidArgument)
    return Object.freeze({
      logger: Object.freeze({
        binlog: Reflect.get(logger, 'binlog') as IBinlogExt['binlog'] | undefined,
        undo: Reflect.get(logger, 'undo') as IUndoLogExt['undo'] | undefined,
        wal: Reflect.get(logger, 'wal') as IWalExt['wal'] | undefined
      }),
      namespace,
      binlogValues,
      atomicBinlog: snapshotSelections(atomicBinlog),
      atomicUndo: snapshotSelections(atomicUndo),
      indexedDbUndo,
      telemetry
    })
  } catch (cause) {
    if (isStorageErrorFamily(cause)) throw cause
    throw new StorageContractError(StorageContractErrorCode.invalidArgument, { cause })
  }
}

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
  if (
    options.telemetry ||
    (options.logger.wal !== undefined && options.logger.binlog === undefined)
  )
    return Promise.reject(new StorageContractError(StorageContractErrorCode.unsupported))
  if (options.logger.binlog === undefined && options.logger.undo === undefined)
    return Promise.resolve(undefined)
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
