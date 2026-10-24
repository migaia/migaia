import { StorageContractError, StorageContractErrorCode } from '@migaia/storage-contract'
import type { IBinlogExt, IUndoLogExt, IWalExt, ILogStore } from '@migaia/logger/plugins/durable'
import type { ILevelPluginExt } from '@migaia/logger/plugins'
import type { IStorageJournalConfiguration } from './types.js'

/** Configuration data stays with the original org cell; these maps grant no backend authority. */
export type IStorageJournalConfigurationSnapshot = Readonly<{
  logger: Partial<IBinlogExt & IUndoLogExt & IWalExt>
  namespace: string
  binlogValues: boolean | undefined
  atomicBinlog: Readonly<Record<string, ILogStore>> | undefined
  atomicUndo: Readonly<Record<string, ILogStore>> | undefined
  redoWal: IWalExt['wal'] | undefined
  indexedDbUndo: boolean | undefined
  telemetry: boolean | undefined
  atLevel?: ILevelPluginExt['atLevel']
}>

/** Capture native handle selections once, preserving each exact original store object. */
function snapshotSelections(input: Readonly<Record<string, ILogStore>> | undefined) {
  if (input === undefined) return undefined
  if (typeof input !== 'object' || input === null || Array.isArray(input))
    throw new StorageContractError(StorageContractErrorCode.invalidArgument)
  const result: Record<string, ILogStore> = Object.create(null)
  for (const key of Object.keys(input)) result[key] = input[key]!
  return result
}

/**
 * Detach caller-selected maps and scalar policy before asynchronous org preparation; native
 * extension objects remain borrowed.
 */
export function snapshotStorageJournalConfiguration(
  input: Exclude<IStorageJournalConfiguration, Function>
): IStorageJournalConfigurationSnapshot {
  const {
    logger,
    namespace,
    binlogValues,
    atomicBinlog,
    atomicUndo,
    indexedDbUndo,
    redoWal,
    telemetry
  } = input
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
  /** The actual level extension is borrowed only for explicitly selected telemetry. */
  const atLevel: unknown =
    telemetry === true ? (logger as Partial<ILevelPluginExt>).atLevel : undefined
  if (telemetry === true && typeof atLevel !== 'function')
    throw new StorageContractError(StorageContractErrorCode.unsupported)
  /** Preserve the original binlog, undo, wal observation order and receiver identities. */
  const binlog = (logger as Partial<IBinlogExt>).binlog
  const undo = (logger as Partial<IUndoLogExt>).undo
  const wal = (logger as Partial<IWalExt>).wal
  if (redoWal !== undefined && redoWal !== wal)
    throw new StorageContractError(StorageContractErrorCode.unsupported)
  return {
    ...(typeof atLevel === 'function'
      ? {
          atLevel: (...args: Parameters<ILevelPluginExt['atLevel']>) =>
            (logger as unknown as ILevelPluginExt).atLevel(...args)
        }
      : {}),
    logger: {
      binlog,
      undo,
      wal
    },
    namespace,
    binlogValues,
    atomicBinlog: snapshotSelections(atomicBinlog),
    atomicUndo: snapshotSelections(atomicUndo),
    indexedDbUndo,
    redoWal,
    telemetry
  }
}
