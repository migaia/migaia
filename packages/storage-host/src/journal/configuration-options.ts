import { StorageContractError, StorageContractErrorCode } from '@migaia/storage-contract'
import type { IBinlogExt, IUndoLogExt, IWalExt, ILogStore } from '@migaia/logger/plugins/durable'
import type { ILevelPluginExt } from '@migaia/logger/plugins'
import type { IStorageJournalConfiguration } from './types.js'
import { isStorageErrorFamily } from '../core/error-family.js'

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

/** Snapshot public options without invoking native I/O or revisiting caller getters later. */
export function snapshotStorageJournalConfiguration(
  input: Exclude<IStorageJournalConfiguration, Function>
): IStorageJournalConfigurationSnapshot {
  try {
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
    const atLevel: unknown = telemetry === true ? Reflect.get(logger, 'atLevel') : undefined
    if (telemetry === true && typeof atLevel !== 'function')
      throw new StorageContractError(StorageContractErrorCode.unsupported)
    /** Preserve the original binlog, undo, wal observation order and receiver identities. */
    const binlog = Reflect.get(logger, 'binlog') as IBinlogExt['binlog'] | undefined
    const undo = Reflect.get(logger, 'undo') as IUndoLogExt['undo'] | undefined
    const wal = Reflect.get(logger, 'wal') as IWalExt['wal'] | undefined
    if (redoWal !== undefined && redoWal !== wal)
      throw new StorageContractError(StorageContractErrorCode.unsupported)
    return {
      ...(typeof atLevel === 'function'
        ? {
            atLevel: (...args: Parameters<ILevelPluginExt['atLevel']>) =>
              Reflect.apply(atLevel, logger, args)
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
  } catch (cause) {
    if (isStorageErrorFamily(cause)) throw cause
    throw new StorageContractError(StorageContractErrorCode.invalidArgument, { cause })
  }
}
