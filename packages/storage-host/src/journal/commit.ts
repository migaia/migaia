import {
  StorageContractError,
  StorageContractErrorCode,
  snapshotConcurrencyLockKeys,
  type IBackendKind,
  type ILockKey,
  type ITransactionScope
} from '@migaia/storage-contract'
import {
  snapshotLogRecords,
  type IBinlogExt,
  type IWalExt,
  type IUndoLogExt,
  type ILogStore
} from '@migaia/logger/plugins/durable'
import { encodeFlatStorageKey } from '../core/key-domain.js'
import type { IStorageJournalBackendAccess } from './binding.js'
import { resolveStorageLogNativeAccess } from './append-port.js'
import { createStorageOperationReporter, reportCleanupError } from '../core/operation-reporter.js'
import { isStorageErrorFamily } from '../core/error-family.js'

import { StorageJournalKind } from './constants.js'
import { createStorageExternalWal } from './wal.js'
import { storageJournalTargetWire } from './targets.js'
import { createStorageJournalUndo, storageJournalUndoImages } from './undo.js'
/** Private terminal access shares the original namespace resource and never enters business KV. */
const terminalNamespace = 'storage.journal.terminal'
/**
 * Join selected real logger stores to the same native transaction. Preparation finishes before
 * callers take the returned head locks or open a business scope; no queue or terminal is created.
 */
export async function createStorageNativeJournal(options: {
  readonly access: IStorageJournalBackendAccess
  readonly backend: IBackendKind
  readonly namespace: string
  readonly logger: Partial<IBinlogExt & IUndoLogExt & IWalExt>
  readonly atomicBinlog?: ILogStore
  readonly atomicUndo?: ILogStore
  readonly binlogValues?: boolean
  readonly onBinlogAppendError?: (txId: string, error: unknown) => void
  readonly report?: (error: unknown) => void
  readonly beforeRecover?: () => void
  readonly afterRecover?: (count: number, elapsedMs: number) => void
  readonly onRecoverError?: (error: unknown) => void
}) {
  const { access, logger } = options
  /** Borrow exact installed extension objects once; the bridge never closes or reconfigures them. */
  const binlog = logger.binlog
  /** Undo keeps the logger's original committed index and reservations. */
  const undo = logger.undo
  const { atomicBinlog, atomicUndo, binlogValues, namespace } = options
  if (
    (binlog === undefined && undo === undefined) ||
    typeof namespace !== 'string' ||
    namespace.length === 0 ||
    (binlogValues !== undefined && typeof binlogValues !== 'boolean')
  )
    throw new StorageContractError(StorageContractErrorCode.invalidArgument)
  if (
    (undo !== undefined && atomicUndo === undefined && logger.wal === undefined) ||
    access.binding.changes === undefined
  )
    throw new StorageContractError(StorageContractErrorCode.unsupported)
  /** Stable target fields come only from the host's original fixed-org access closure. */
  const target = {
    namespace,
    backendInstanceId: access.backendInstanceId,
    orgId: access.orgId
  }
  /** Certify original registration identity before any selected native log scope can be opened. */
  const selected = (store: ILogStore | undefined) => {
    if (store === undefined) return undefined
    /** This closure is issued by the exact original storageLogStore object. */
    const native = resolveStorageLogNativeAccess(store)
    if (!native.matches(access))
      throw new StorageContractError(StorageContractErrorCode.unsupported)
    return native
  }
  /** The original native scopes will receive only these already-certified append providers. */
  const binlogNative = selected(atomicBinlog)
  /** Separate selected stores retain separate original head locks and logger indexes. */
  const undoNative = selected(atomicUndo)
  await Promise.all([binlog?.ready(), undo?.ready(), logger.wal?.ready()])
  /** Recovery uses only the original terminal after its native guarantee is admitted. */
  let wal: Awaited<ReturnType<typeof createStorageExternalWal>> | undefined
  /** The same resource-construction boundary owns rejected undo binding preparation. */
  let undoExecution: ReturnType<typeof createStorageJournalUndo> | undefined
  /** The existing namespace owns authentication and eventual cleanup, rather than a new scope. */
  const terminal = await access.binding.openNamespace(
    encodeFlatStorageKey([terminalNamespace, namespace, access.backendInstanceId])
  )
  try {
    /** Pure commit-only external binlog needs authentic success, not rollback atomicity. */
    const commitOnly =
      binlog !== undefined &&
      undo === undefined &&
      logger.wal === undefined &&
      atomicBinlog === undefined &&
      atomicUndo === undefined
    /** This original fact is captured once and never weakened for WAL, undo or native log stores. */
    const nativeAtomic = terminal.nativeAtomic
    if (nativeAtomic !== true && !(nativeAtomic === false && commitOnly))
      throw new StorageContractError(StorageContractErrorCode.unsupported)
    access.retain(terminal)
    if (
      logger.wal !== undefined &&
      ((binlog !== undefined && binlogNative === undefined) ||
        (undo !== undefined && undoNative === undefined))
    )
      wal = await createStorageExternalWal({
        access,
        target,
        binlog: binlogNative === undefined ? binlog : undefined,
        undo: undoNative === undefined ? undo : undefined,
        wal: logger.wal,
        backend: options.backend,
        report: options.report,
        beforeRecover: options.beforeRecover,
        afterRecover: options.afterRecover,
        onRecoverError: options.onRecoverError
      })
    if (undo !== undefined)
      undoExecution = createStorageJournalUndo({
        access,
        backend: options.backend,
        target,
        undo,
        terminal
      })
  } catch (cause) {
    try {
      await terminal.dispose()
    } catch (cleanup) {
      reportCleanupError(createStorageOperationReporter(), cleanup)
    }
    if (isStorageErrorFamily(cause)) throw cause
    throw new StorageContractError(StorageContractErrorCode.invalidArgument, { cause })
  }
  /** Original canonical ordering/deduplication runs before the real transaction's first acquire. */
  const headLocks: readonly ILockKey[] = snapshotConcurrencyLockKeys(
    [binlogNative?.headLock, undoNative?.headLock].filter((key) => key !== undefined),
    options.backend
  ).keys
  return {
    headLocks,
    undo: undoExecution,
    /** Only the native owner's authentic callback view may activate capture for this attempt. */
    begin: (scope: Omit<ITransactionScope, 'use'>) => {
      /** Do not trust an arbitrary caller id or an unrelated object with matching fields. */
      const info = terminal.transactionInfo(scope)
      access.binding.changes!(scope)
      /** Only the actual original terminal starts external I/O; rollback leaves it absent. */
      let external: Promise<void> | undefined
      return {
        txId: info.id,
        ...((binlog !== undefined && binlogNative === undefined) ||
        (undo !== undefined && undoNative === undefined)
          ? { settle: () => external ?? Promise.resolve() }
          : {}),
        /** Called by the original owner after its final business plan and before actual COMMIT. */
        record: async (current: Omit<ITransactionScope, 'use'>): Promise<void> => {
          if (terminal.transactionInfo(current).id !== info.id)
            throw new StorageContractError(StorageContractErrorCode.invalidArgument)
          /** The original owner supplies its final physical plan, including complete revisions. */
          const changes = access.binding.changes!(current)
          if (changes.length === 0) return
          /** One canonical ordered payload also carries the full external undo intent's txId. */
          const payload =
            binlog !== undefined || (undo !== undefined && undoNative === undefined)
              ? snapshotLogRecords([
                  {
                    kind: StorageJournalKind.commit,
                    payload: {
                      version: 1,
                      target,
                      txId: info.id,
                      changes: changes.map((change) => ({
                        target: storageJournalTargetWire(change.target),
                        present: change.after.present,
                        ...(binlogValues && change.after.present
                          ? { value: change.after.value }
                          : {})
                      }))
                    }
                  }
                ])[0]!.payload
              : undefined
          if (binlog !== undefined && binlogNative !== undefined)
            await binlog.append(StorageJournalKind.commit, payload!, {
              transaction: binlogNative.createPort(current)
            })
          if (
            (binlog !== undefined && binlogNative === undefined) ||
            (undo !== undefined && undoNative === undefined)
          ) {
            /** Full images become durable before the original same-transaction marker is staged. */
            const intent = await wal?.begin(
              current,
              payload!,
              changes.map((change) => ({
                ...change,
                target: storageJournalTargetWire(change.target)
              }))
            )
            if (intent !== undefined)
              terminal.onRollback(current, () => {
                external = intent.abort()
              })
            terminal.onCommit(current, () => {
              /** Awaited native results cannot be replaced after data is actually committed. */
              external = (async () => {
                /** Binlog observers describe append failures only; undo/WAL failures use report. */
                let binlogReported = false
                const onBinlogFailure = (error: unknown) => {
                  if (options.onBinlogAppendError !== undefined) {
                    binlogReported = true
                    options.onBinlogAppendError(info.id, error)
                  }
                }
                try {
                  if (intent === undefined) {
                    try {
                      await binlog!.append(StorageJournalKind.commit, payload!)
                    } catch (error) {
                      onBinlogFailure(error)
                      throw error
                    }
                  } else await intent.complete(onBinlogFailure)
                } catch (error) {
                  if (!binlogReported)
                    reportCleanupError(options.report ?? createStorageOperationReporter(), error)
                }
              })()
            })
          }
          if (undo !== undefined && undoNative !== undefined)
            await undo.record(info.id, storageJournalUndoImages(target, changes, options.backend), {
              transaction: undoNative.createPort(current)
            })
        }
      }
    }
  }
}
