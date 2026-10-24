import {
  StorageContractError,
  StorageContractErrorCode,
  type IBackendKind,
  type ILockKey,
  type ITransactionScope
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

/** Redo borrows the original WAL index and text draft; it owns no queue or native terminal. */
export async function createStorageRedoJournal(options: {
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
}) {
  const { access, logger } = options
  const binding = access.binding.redo
  const wal = logger.wal
  const binlog = logger.binlog
  if (binding === undefined || wal === undefined || access.binding.changes === undefined)
    throw new StorageContractError(StorageContractErrorCode.unsupported)
  const target = Object.freeze({
    namespace: options.namespace,
    backendInstanceId: access.backendInstanceId,
    orgId: access.orgId
  })
  await Promise.all([wal.ready(), binlog?.ready()])
  /** A possibly applied draft or durable completion never becomes a false rollback. */
  const failed = (cause: unknown): never => {
    const error =
      cause instanceof StorageError && cause.code === StorageErrorCode.journalRecordInvalid
        ? cause
        : new StorageError(
            StorageErrorCode.journalRecoveryFailed,
            { cause },
            StorageErrorText.journalRecoveryFailed
          )
    binding.seal(error)
    throw error
  }
  /** Replay and publication share the original pending record; duplicate binlog is allowed by txId. */
  const publish = async (pending: ReturnType<typeof readStorageJournalIntent>) => {
    if (!pending.binlog) return
    if (binlog === undefined) throw new StorageContractError(StorageContractErrorCode.unsupported)
    try {
      await binlog.append(StorageJournalKind.commit, pending.commit)
    } catch (error) {
      options.onBinlogAppendError?.(pending.txId, error)
      throw error
    }
  }
  /** Called only inside this original text owner's protection, including already-open readers. */
  const recover = async (): Promise<void> => {
    const started = Date.now()
    let count = 0
    options.beforeRecover?.()
    try {
      for (const row of await wal.pending()) {
        if (row.kind !== StorageJournalKind.redo) continue
        if (!storageJournalTargetsMatch(readStorageJournalIntentTarget(row.payload), target))
          continue
        const pending = readStorageJournalIntent(row.payload, options.backend, true)
        binding.replay(pending.changes!)
        await publish(pending)
        await wal.complete(row.seq)
        count += 1
      }
      options.afterRecover?.(count, Date.now() - started)
    } catch (cause) {
      try {
        failed(cause)
      } catch (error) {
        options.onRecoverError?.(error)
        throw error
      }
    }
  }
  /** Initial recovery finishes before the original host publishes this selected configuration. */
  await binding.protect(recover)
  return Object.freeze({
    headLocks: Object.freeze([]) as readonly ILockKey[],
    undo: undefined,
    /** There is no second admission queue: native protection encloses recovery plus original work. */
    runRedo: <R>(run: () => Promise<R>): Promise<R> =>
      binding.protect(async () => {
        await recover()
        return run()
      }),
    begin: (scope: Omit<ITransactionScope, 'use'>) => {
      const info = binding.transactionInfo(scope)
      access.binding.changes!(scope)
      return Object.freeze({
        txId: info.id,
        record: async (current: Omit<ITransactionScope, 'use'>): Promise<void> => {
          if (binding.transactionInfo(current).id !== info.id)
            throw new StorageContractError(StorageContractErrorCode.invalidArgument)
          const changes = access.binding.changes!(current)
          if (changes.length === 0) return
          /** Every target and full image is detached before WAL or the first physical assignment. */
          const payload = snapshotLogRecords([
            {
              kind: StorageJournalKind.redo,
              payload: {
                version: 1,
                target,
                txId: info.id,
                binlog: binlog !== undefined,
                undo: false,
                commit: {
                  version: 1,
                  target,
                  txId: info.id,
                  changes: changes.map((change) => ({
                    target: storageJournalTargetWire(change.target),
                    present: change.after.present,
                    ...(options.binlogValues && change.after.present
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
          const pending = readStorageJournalIntent(payload, options.backend, true)
          try {
            const sequence = await wal.begin(StorageJournalKind.redo, payload as ILogPayload)
            binding.apply(current)
            await publish(pending)
            await wal.complete(sequence)
          } catch (cause) {
            failed(cause)
          }
        }
      })
    }
  })
}
