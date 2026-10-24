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
type IStorageNativeJournalOptions = {
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
}
/** One prepared native journal borrows the original terminal and actual logger extensions. */
type IStorageNativeJournalContext = {
  readonly options: IStorageNativeJournalOptions
  readonly access: IStorageJournalBackendAccess
  readonly binlog: IBinlogExt['binlog'] | undefined
  readonly undo: IUndoLogExt['undo'] | undefined
  readonly target: {
    readonly namespace: string
    readonly backendInstanceId: string
    readonly orgId: string
  }
  readonly terminal: Awaited<ReturnType<IStorageJournalBackendAccess['binding']['openNamespace']>>
  readonly binlogNative: ReturnType<typeof resolveStorageLogNativeAccess> | undefined
  readonly undoNative: ReturnType<typeof resolveStorageLogNativeAccess> | undefined
  readonly wal: Awaited<ReturnType<typeof createStorageExternalWal>> | undefined
  readonly headLocks: readonly ILockKey[]
  readonly undoExecution: ReturnType<typeof createStorageJournalUndo> | undefined
}
/** Exact registration identity is certified before opening a selected native log scope. */
function selectStorageNativeLog(
  access: IStorageJournalBackendAccess,
  store: ILogStore | undefined
) {
  if (store === undefined) return undefined
  const native = resolveStorageLogNativeAccess(store)
  if (!native.matches(access)) throw new StorageContractError(StorageContractErrorCode.unsupported)
  return native
}
/** Prepare authentic native resources and recovery before a business scope can begin. */
async function prepareStorageNativeJournal(
  options: IStorageNativeJournalOptions
): Promise<IStorageNativeJournalContext> {
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
  /** The original native scopes will receive only these already-certified append providers. */
  const binlogNative = selectStorageNativeLog(access, atomicBinlog)
  /** Separate selected stores retain separate original head locks and logger indexes. */
  const undoNative = selectStorageNativeLog(access, atomicUndo)
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
    options,
    access,
    binlog,
    undo,
    target,
    terminal,
    binlogNative,
    undoNative,
    wal,
    headLocks,
    undoExecution
  }
}
/** Only the original attempt's known terminal may start external post-commit work. */
type IStorageNativeAttemptContext = {
  readonly journal: IStorageNativeJournalContext
  readonly txId: string
  external: Promise<void> | undefined
}
/** Report post-commit publication failure without rewriting an authentic committed outcome. */
async function publishStorageNativeCommit(
  attempt: IStorageNativeAttemptContext,
  payload: import('@migaia/logger/plugins/durable').ILogPayload,
  intent: Awaited<ReturnType<NonNullable<IStorageNativeJournalContext['wal']>['begin']>> | undefined
): Promise<void> {
  /** Binlog observers describe append failures only; undo/WAL failures use report. */
  let binlogReported = false
  const onBinlogFailure = (error: unknown) => {
    if (attempt.journal.options.onBinlogAppendError !== undefined) {
      binlogReported = true
      attempt.journal.options.onBinlogAppendError(attempt.txId, error)
    }
  }
  try {
    if (intent === undefined) {
      try {
        await attempt.journal.binlog!.append(StorageJournalKind.commit, payload!)
      } catch (error) {
        onBinlogFailure(error)
        throw error
      }
    } else await intent.complete(onBinlogFailure)
  } catch (error) {
    if (!binlogReported)
      reportCleanupError(attempt.journal.options.report ?? createStorageOperationReporter(), error)
  }
}
/** Stage ordered commit/undo images before the original native owner issues COMMIT. */
async function recordStorageNativeAttempt(
  attempt: IStorageNativeAttemptContext,
  current: Omit<ITransactionScope, 'use'>
): Promise<void> {
  if (attempt.journal.terminal.transactionInfo(current).id !== attempt.txId)
    throw new StorageContractError(StorageContractErrorCode.invalidArgument)
  /** The original owner supplies its final physical plan, including complete revisions. */
  const changes = attempt.journal.access.binding.changes!(current)
  if (changes.length === 0) return
  /** One canonical ordered payload also carries the full external undo intent's txId. */
  const payload =
    attempt.journal.binlog !== undefined ||
    (attempt.journal.undo !== undefined && attempt.journal.undoNative === undefined)
      ? snapshotLogRecords([
          {
            kind: StorageJournalKind.commit,
            payload: {
              version: 1,
              target: attempt.journal.target,
              txId: attempt.txId,
              changes: changes.map((change) => ({
                target: storageJournalTargetWire(change.target),
                present: change.after.present,
                ...(attempt.journal.options.binlogValues && change.after.present
                  ? { value: change.after.value }
                  : {})
              }))
            }
          }
        ])[0]!.payload
      : undefined
  if (attempt.journal.binlog !== undefined && attempt.journal.binlogNative !== undefined)
    await attempt.journal.binlog.append(StorageJournalKind.commit, payload!, {
      transaction: attempt.journal.binlogNative.createPort(current)
    })
  if (
    (attempt.journal.binlog !== undefined && attempt.journal.binlogNative === undefined) ||
    (attempt.journal.undo !== undefined && attempt.journal.undoNative === undefined)
  ) {
    /** Full images become durable before the original same-transaction marker is staged. */
    const intent = await attempt.journal.wal?.begin(
      current,
      payload!,
      changes.map((change) => ({
        ...change,
        target: storageJournalTargetWire(change.target)
      }))
    )
    if (intent !== undefined)
      attempt.journal.terminal.onRollback(current, () => {
        attempt.external = intent.abort()
      })
    attempt.journal.terminal.onCommit(current, () => {
      /** Awaited native results cannot be replaced after data is actually committed. */
      attempt.external = publishStorageNativeCommit(attempt, payload!, intent)
    })
  }
  if (attempt.journal.undo !== undefined && attempt.journal.undoNative !== undefined)
    await attempt.journal.undo.record(
      attempt.txId,
      storageJournalUndoImages(attempt.journal.target, changes, attempt.journal.options.backend),
      {
        transaction: attempt.journal.undoNative.createPort(current)
      }
    )
}
/** Authentic native scope admission activates capture without creating another transaction. */
function beginStorageNativeAttempt(
  journal: IStorageNativeJournalContext,
  scope: Omit<ITransactionScope, 'use'>
) {
  const info = journal.terminal.transactionInfo(scope)
  journal.access.binding.changes!(scope)
  const attempt: IStorageNativeAttemptContext = { journal, txId: info.id, external: undefined }
  return {
    txId: info.id,
    ...((journal.binlog !== undefined && journal.binlogNative === undefined) ||
    (journal.undo !== undefined && journal.undoNative === undefined)
      ? { settle: () => attempt.external ?? Promise.resolve() }
      : {}),
    record: (current: Omit<ITransactionScope, 'use'>) =>
      recordStorageNativeAttempt(attempt, current)
  }
}
/** Join selected logger stores to the original prepared native transaction protocol. */
export async function createStorageNativeJournal(options: IStorageNativeJournalOptions) {
  const journal = await prepareStorageNativeJournal(options)
  return {
    headLocks: journal.headLocks,
    undo: journal.undoExecution,
    begin: (scope: Omit<ITransactionScope, 'use'>) => beginStorageNativeAttempt(journal, scope)
  }
}
