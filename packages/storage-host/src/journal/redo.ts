import {
  StorageContractError,
  StorageContractErrorCode,
  type IOperationContext,
  type IBackendKind,
  type ILockKey
} from '@migaia/storage-contract'
import {
  snapshotLogRecords,
  type IBinlogExt,
  type IWalExt,
  type ILogPayload
} from '@migaia/logger/plugins/durable'
import type { IStorageJournalBackendAccess } from './binding.js'
import { StorageJournalKind } from './constants.js'
import { storageJournalTargetWire } from './targets.js'
import {
  readStorageJournalIntent,
  readStorageJournalIntentTarget,
  storageJournalTargetsMatch
} from './wal.js'
import { StorageError, StorageErrorCode } from '../errors.js'
import { StorageErrorText } from '../error-text.js'
import { createStorageOperationReporter, reportCleanupError } from '../core/operation-reporter.js'

/** Redo borrows the original WAL index and text draft; it owns no queue or native terminal. */
type IStorageRedoOptions = {
  readonly access: IStorageJournalBackendAccess
  readonly backend: IBackendKind
  readonly namespace: string
  readonly logger: Partial<IBinlogExt & IWalExt>
  readonly binlogValues?: boolean
  readonly report?: (error: unknown) => void
  readonly onBinlogAppendError?: (txId: string, error: unknown) => void
  readonly beforeRecover?: () => void
  readonly afterRecover?: (count: number, elapsedMs: number) => void
  readonly onRecoverError?: (error: unknown) => void
}
/** Redo retains one original text binding and borrowed WAL, never a second terminal or queue. */
type IStorageRedoContext = {
  readonly options: IStorageRedoOptions
  readonly binding: NonNullable<IStorageJournalBackendAccess['binding']['redo']>
  readonly wal: NonNullable<IWalExt['wal']>
  readonly binlog: IBinlogExt['binlog'] | undefined
  readonly target: {
    readonly namespace: string
    readonly backendInstanceId: string
    readonly orgId: string
  }
}
/** A possibly applied draft or durable completion never becomes a false rollback. */
function failStorageRedo(context: IStorageRedoContext, cause: unknown): never {
  const error =
    cause instanceof StorageError && cause.code === StorageErrorCode.journalRecordInvalid
      ? cause
      : new StorageError(
          StorageErrorCode.journalRecoveryFailed,
          { cause },
          StorageErrorText.journalRecoveryFailed
        )
  context.binding.seal(error)
  throw error
}
/** Replay and publication share the original pending record; duplicate binlog is allowed by txId. */
async function publishStorageRedo(
  context: IStorageRedoContext,
  pending: ReturnType<typeof readStorageJournalIntent>
) {
  if (!pending.binlog) return
  if (context.binlog === undefined)
    throw new StorageContractError(StorageContractErrorCode.unsupported)
  try {
    await context.binlog.append(StorageJournalKind.commit, pending.commit)
  } catch (error) {
    context.options.onBinlogAppendError?.(pending.txId, error)
    throw error
  }
}
/** Called only inside this original text owner's protection, including already-open readers. */
async function recoverStorageRedo(context: IStorageRedoContext): Promise<void> {
  const started = Date.now()
  let count = 0
  context.options.beforeRecover?.()
  try {
    for (const row of await context.wal.pending()) {
      if (row.kind !== StorageJournalKind.redo) continue
      if (!storageJournalTargetsMatch(readStorageJournalIntentTarget(row.payload), context.target))
        continue
      const pending = readStorageJournalIntent(row.payload, context.options.backend, true)
      const notify = context.binding.replay(pending.changes!)
      await publishStorageRedo(context, pending)
      await context.wal.complete(row.seq)
      if (notify !== undefined)
        try {
          notify()
        } catch (error) {
          reportCleanupError(context.options.report ?? createStorageOperationReporter(), error)
        }
      count += 1
    }
    context.options.afterRecover?.(count, Date.now() - started)
  } catch (cause) {
    try {
      failStorageRedo(context, cause)
    } catch (error) {
      context.options.onRecoverError?.(error)
      throw error
    }
  }
}
/** Detach one ordered native draft before WAL I/O, then apply and durably complete it. */
async function recordStorageRedo(
  context: IStorageRedoContext,
  txId: string,
  current: object
): Promise<void> {
  if (context.binding.transactionInfo(current).id !== txId)
    throw new StorageContractError(StorageContractErrorCode.invalidArgument)
  const changes = context.binding.changes(current)
  if (changes.length === 0) return
  /** Every target and full image is detached before WAL or the first physical assignment. */
  const payload = snapshotLogRecords([
    {
      kind: StorageJournalKind.redo,
      payload: {
        version: 1,
        target: context.target,
        txId: txId,
        binlog: context.binlog !== undefined,
        undo: false,
        commit: {
          version: 1,
          target: context.target,
          txId: txId,
          changes: changes.map((change) => ({
            target: storageJournalTargetWire(change.target),
            present: change.after.present,
            ...(context.options.binlogValues && change.after.present
              ? { value: change.after.value }
              : {})
          }))
        },
        changes: changes.map((change) => ({
          target: storageJournalTargetWire(change.target),
          before: change.before,
          after: change.after,
          afterRevision: change.afterRevision
        }))
      }
    }
  ])[0]!.payload
  const pending = readStorageJournalIntent(payload, context.options.backend, true)
  try {
    const sequence = await context.wal.begin(StorageJournalKind.redo, payload as ILogPayload)
    context.binding.apply(current)
    await publishStorageRedo(context, pending)
    await context.wal.complete(sequence)
  } catch (cause) {
    failStorageRedo(context, cause)
  }
}
/** Activate capture only on the text owner's authentic original scope. */
function beginStorageRedo(context: IStorageRedoContext, scope: object) {
  const info = context.binding.transactionInfo(scope)
  context.binding.changes(scope)
  return {
    txId: info.id,
    record: (current: object) => recordStorageRedo(context, info.id, current)
  }
}
/** Initial recovery finishes before publication; native protection still encloses all later work. */
export async function createStorageRedoJournal(options: IStorageRedoOptions) {
  const { access, logger } = options
  const binding = access.binding.redo
  const wal = logger.wal
  const binlog = logger.binlog
  if (binding === undefined || wal === undefined)
    throw new StorageContractError(StorageContractErrorCode.unsupported)
  const context: IStorageRedoContext = {
    options,
    binding,
    wal,
    binlog,
    target: {
      namespace: options.namespace,
      backendInstanceId: access.backendInstanceId,
      orgId: access.orgId
    }
  }
  await Promise.all([wal.ready(), binlog?.ready()])
  await binding.protect(() => recoverStorageRedo(context))
  return {
    headLocks: [] as readonly ILockKey[],
    undo: undefined,
    runRedo: <R>(run: () => Promise<R>, signal?: IOperationContext['signal']): Promise<R> =>
      binding.protect(async () => {
        await recoverStorageRedo(context)
        return run()
      }, signal),
    begin: (scope: object) => beginStorageRedo(context, scope)
  }
}
