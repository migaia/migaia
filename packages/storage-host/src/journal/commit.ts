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
  type IUndoImage,
  type ILogPayload,
  type ILogStore
} from '@migaia/logger/plugins/durable'
import { encodeFlatStorageKey } from '../core/key-domain.js'
import type { IStorageJournalBackendAccess } from './binding.js'
import { resolveStorageLogNativeAccess } from './append-port.js'
import type { IStorageJournalChange } from './types.js'
import { createStorageOperationReporter, reportCleanupError } from '../core/operation-reporter.js'
import { isStorageErrorFamily } from '../core/error-family.js'

import { StorageJournalKind } from './constants.js'
import { createStorageExternalWal } from './wal.js'
import { storageJournalTargetWire, storageJournalTargetIdentity } from './targets.js'
import { createStorageJournalUndo } from './undo.js'
/** Private terminal access shares the original namespace resource and never enters business KV. */
const terminalNamespace = 'storage.journal.terminal'
/** Complete undo targets survive the original logger's target/before/after projection. */
export type IStorageUndoTarget = Readonly<{
  version: 1
  namespace: string
  backendInstanceId: string
  orgId: string
  identity: ILogPayload
  afterRevision: ILogPayload
}>

/** Repeated writes keep their first before image and last actual after image and full revision. */
export function storageJournalUndoImages(
  target: Readonly<{ namespace: string; backendInstanceId: string; orgId: string }>,
  changes: readonly IStorageJournalChange[],
  backend: IBackendKind
): readonly IUndoImage[] {
  /** Only this commit's canonical identities participate; no history index or authority is added. */
  const merged = new Map<string, IUndoImage>()
  for (const change of changes) {
    /** The original target codec keeps every persisted business key in its existing domain. */
    const identity = storageJournalTargetWire(change.target)
    /** Metadata and native point identities remain distinct even when their strings coincide. */
    const key = storageJournalTargetIdentity(change.target, backend)
    /** First-before ownership survives every later overwrite of this same physical identity. */
    const previous = merged.get(key)
    merged.set(key, {
      target: {
        version: 1,
        ...target,
        identity,
        afterRevision: change.afterRevision
      } satisfies IStorageUndoTarget,
      before: previous?.before ?? change.before,
      after: change.after
    })
  }
  /** The original logger validator supplies the detached immutable JSON domain once. */
  return snapshotLogRecords([
    { kind: StorageJournalKind.commit, payload: [...merged.values()] }
  ])[0]!.payload as readonly IUndoImage[]
}

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
  if ((undo !== undefined && atomicUndo === undefined) || access.binding.changes === undefined)
    throw new StorageContractError(StorageContractErrorCode.unsupported)
  /** Stable target fields come only from the host's original fixed-org access closure. */
  const target = Object.freeze({
    namespace,
    backendInstanceId: access.backendInstanceId,
    orgId: access.orgId
  })
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
    if (!terminal.nativeAtomic) throw new StorageContractError(StorageContractErrorCode.unsupported)
    access.retain(terminal)
    if (logger.wal !== undefined && binlogNative === undefined)
      wal = await createStorageExternalWal({
        access,
        target,
        binlog,
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
  return Object.freeze({
    headLocks,
    undo: undoExecution,
    /** Only the native owner's authentic callback view may activate capture for this attempt. */
    begin: (scope: Omit<ITransactionScope, 'use'>) => {
      /** Do not trust an arbitrary caller id or an unrelated object with matching fields. */
      const info = terminal.transactionInfo(scope)
      access.binding.changes!(scope)
      /** Only the actual original terminal starts external I/O; rollback leaves it absent. */
      let external: Promise<void> | undefined
      return Object.freeze({
        txId: info.id,
        ...(binlog !== undefined && binlogNative === undefined
          ? { settle: () => external ?? Promise.resolve() }
          : {}),
        /** Called by the original owner after its final business plan and before actual COMMIT. */
        record: async (current: Omit<ITransactionScope, 'use'>): Promise<void> => {
          if (terminal.transactionInfo(current).id !== info.id)
            throw new StorageContractError(StorageContractErrorCode.invalidArgument)
          /** The original owner supplies its final physical plan, including complete revisions. */
          const changes = access.binding.changes!(current)
          if (changes.length === 0) return
          if (binlog !== undefined) {
            /** The shared logger validates and snapshots this one actual ordered commit payload. */
            const payload = snapshotLogRecords([
              {
                kind: StorageJournalKind.commit,
                payload: {
                  version: 1,
                  target,
                  txId: info.id,
                  changes: changes.map((change) => ({
                    target: storageJournalTargetWire(change.target),
                    present: change.after.present,
                    ...(binlogValues && change.after.present ? { value: change.after.value } : {})
                  }))
                }
              }
            ])[0]!.payload
            if (binlogNative !== undefined)
              await binlog.append(StorageJournalKind.commit, payload, {
                transaction: binlogNative.createPort(current)
              })
            else {
              /** Intent is durable before the original owner stages its same-transaction marker. */
              const intent = await wal?.begin(
                current,
                payload,
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
                  try {
                    if (intent === undefined)
                      await binlog.append(StorageJournalKind.commit, payload)
                    else await intent.complete()
                  } catch (error) {
                    if (options.onBinlogAppendError !== undefined)
                      options.onBinlogAppendError(info.id, error)
                    else reportCleanupError(createStorageOperationReporter(), error)
                  }
                })()
              })
            }
          }
          if (undo !== undefined)
            await undo.record(info.id, storageJournalUndoImages(target, changes, options.backend), {
              transaction: undoNative!.createPort(current)
            })
        }
      })
    }
  })
}
