import {
  assertOperationContext,
  StorageContractError,
  StorageContractErrorCode,
  type IBackendKind,
  type ITransactionScope
} from '@migaia/storage-contract'
import {
  snapshotLogRecords,
  type IBinlogExt,
  type IWalExt,
  type IUndoLogExt,
  type ILogPayload
} from '@migaia/logger/plugins/durable'
import { readStorageJournalTarget, storageJournalTargetIdentity } from './targets.js'
import { createStorageOperationReporter, reportCleanupError } from '../core/operation-reporter.js'
import { StorageError, StorageErrorCode } from '../errors.js'
import { StorageErrorText } from '../error-text.js'
import type { IStorageJournalBackendAccess } from './binding.js'
import { StorageJournalKind } from './constants.js'
import {
  equalStorageJournalPayload,
  readStorageUndoRows,
  storageJournalUndoImages
} from './undo.js'
import type { IStorageJournalChange, IStorageJournalImage } from './types.js'

/** Complete immutable recovery target; matching names never authenticate a native transaction. */
type IStorageJournalTargetIdentity = Readonly<{
  namespace: string
  backendInstanceId: string
  orgId: string
}>
/** Only this bridge's own persisted kind is interpreted, preserving original causes on damage. */
function invalid(cause?: unknown): never {
  throw new StorageError(
    StorageErrorCode.journalRecordInvalid,
    { cause },
    StorageErrorText.journalRecordInvalid
  )
}
/** Durable logger JSON is already detached; structural checks do not invent a second value codec. */
function object(input: unknown): Record<string, unknown> {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) invalid()
  return input as Record<string, unknown>
}
/** Stable targets carry the canonical org UUID validated by the original operation-context owner. */
function identity(input: unknown): IStorageJournalTargetIdentity {
  const value = object(input)
  if (
    typeof value.namespace !== 'string' ||
    value.namespace.length === 0 ||
    typeof value.backendInstanceId !== 'string' ||
    value.backendInstanceId.length === 0
  )
    invalid()
  assertOperationContext({ orgId: value.orgId as string })
  return value as IStorageJournalTargetIdentity
}
/** Compare the full fixed target before any recovery marker I/O or durable mutation. */
function matches(
  left: IStorageJournalTargetIdentity,
  right: IStorageJournalTargetIdentity
): boolean {
  return (
    left.namespace === right.namespace &&
    left.backendInstanceId === right.backendInstanceId &&
    left.orgId === right.orgId
  )
}
/** WAL images always retain full encoded values, independently of binlogValues. */
function image(input: unknown): IStorageJournalImage {
  const value = object(input)
  if (value.present !== false && value.present !== true) invalid()
  if (value.present === true && typeof value.value !== 'string') invalid()
  if (value.present === false && Object.hasOwn(value, 'value')) invalid()
  return value as IStorageJournalImage
}
/** Read one original intent; unrelated kinds are ignored by the caller, damaged owned kinds stop. */
function intent(input: unknown, backend: IBackendKind) {
  try {
    const value = object(input)
    const owner = identity(value.target)
    if (value.version !== 1 || typeof value.txId !== 'string' || value.txId.length === 0) invalid()
    const commit = object(value.commit)
    if (
      commit.version !== 1 ||
      commit.txId !== value.txId ||
      !matches(identity(commit.target), owner) ||
      !Array.isArray(commit.changes) ||
      !Array.isArray(value.changes) ||
      commit.changes.length !== value.changes.length ||
      value.changes.length === 0
    )
      invalid()
    if (
      (value.binlog !== undefined && typeof value.binlog !== 'boolean') ||
      (value.undo !== undefined && typeof value.undo !== 'boolean') ||
      (value.binlog === false && value.undo !== true)
    )
      invalid()
    /** Recovery derives undo from the same full ordered changes, rather than a second wire catalog. */
    const changes: IStorageJournalChange[] | undefined = value.undo === true ? [] : undefined
    for (const [index, entry] of value.changes.entries()) {
      const change = object(entry)
      const logged = object(commit.changes[index])
      const target = readStorageJournalTarget(change.target, backend)
      if (
        storageJournalTargetIdentity(target, backend) !==
        storageJournalTargetIdentity(readStorageJournalTarget(logged.target, backend), backend)
      )
        invalid()
      const before = image(change.before)
      const after = image(change.after)
      if (!Object.hasOwn(change, 'afterRevision') || logged.present !== after.present) invalid()
      if (
        Object.hasOwn(logged, 'value') &&
        (after.present !== true || logged.value !== after.value)
      )
        invalid()
      changes?.push({
        target,
        before,
        after,
        afterRevision: change.afterRevision as ILogPayload
      })
    }
    return {
      target: owner,
      txId: value.txId,
      commit: value.commit as ILogPayload,
      binlog: value.binlog !== false,
      undo: value.undo === true,
      images: value.undo === true ? storageJournalUndoImages(owner, changes!, backend) : undefined
    }
  } catch (cause) {
    if (cause instanceof StorageError && cause.code === StorageErrorCode.journalRecordInvalid)
      throw cause
    return invalid(cause)
  }
}

/**
 * External intent/marker protocol belongs to the existing bridge. Logger retains durable FIFO,
 * pending indexes and resources; the native backend retains the only data commit decision.
 */
export async function createStorageExternalWal(options: {
  readonly access: IStorageJournalBackendAccess
  readonly target: IStorageJournalTargetIdentity
  readonly backend: IBackendKind
  readonly binlog: IBinlogExt['binlog'] | undefined
  readonly wal: IWalExt['wal']
  readonly undo?: IUndoLogExt['undo']
  readonly report?: (error: unknown) => void
  readonly beforeRecover?: () => void
  readonly afterRecover?: (count: number, elapsedMs: number) => void
  readonly onRecoverError?: (error: unknown) => void
}) {
  const { access, wal, binlog, undo } = options
  const binding = access.binding
  if (
    (binlog === undefined && undo === undefined) ||
    binding.externalWal !== true ||
    binding.writeCommitMarker === undefined ||
    binding.hasCommitMarker === undefined ||
    binding.removeCommitMarker === undefined
  )
    throw new StorageContractError(StorageContractErrorCode.unsupported)
  /** Cleanup reports without converting an already-known native outcome into a false rollback. */
  const report = options.report ?? createStorageOperationReporter()
  /** The original logger owns append/index serialization; repeated undo publication is exact-only. */
  const publish = async (
    pending: ReturnType<typeof intent>,
    onBinlogFailure?: (error: unknown) => void
  ) => {
    if (pending.binlog) {
      if (binlog === undefined) throw new StorageContractError(StorageContractErrorCode.unsupported)
      try {
        await binlog.append(StorageJournalKind.commit, pending.commit)
      } catch (error) {
        onBinlogFailure?.(error)
        throw error
      }
    }
    if (pending.undo) {
      if (undo === undefined) throw new StorageContractError(StorageContractErrorCode.unsupported)
      /** An interrupted completion may already have committed the original txId's mirror. */
      const existing = await undo.get(pending.txId)
      if (existing === undefined) await undo.record(pending.txId, pending.images!)
      else {
        readStorageUndoRows(existing, options.target, options.backend)
        if (!equalStorageJournalPayload(existing as ILogPayload, pending.images! as ILogPayload))
          invalid()
      }
    }
  }
  /** Recovery scans the original logger's pending index only, never committed history. */
  const started = Date.now()
  let recovered = 0
  options.beforeRecover?.()
  try {
    for (const record of await wal.pending()) {
      if (record.kind !== StorageJournalKind.intent) continue
      /** A foreign complete target grants no authority to interpret or repair its body. */
      let owner: IStorageJournalTargetIdentity
      try {
        owner = identity(object(record.payload).target)
      } catch (cause) {
        if (cause instanceof StorageError && cause.code === StorageErrorCode.journalRecordInvalid)
          throw cause
        invalid(cause)
      }
      if (!matches(owner, options.target)) continue
      const pending = intent(record.payload, options.backend)
      if (await binding.hasCommitMarker(pending.txId)) {
        await publish(pending)
        await wal.complete(record.seq)
        try {
          await binding.removeCommitMarker(pending.txId)
        } catch (error) {
          reportCleanupError(report, error)
        }
      } else await wal.abort(record.seq)
      recovered++
    }
    options.afterRecover?.(recovered, Date.now() - started)
  } catch (cause) {
    const failure =
      cause instanceof StorageError && cause.code === StorageErrorCode.journalRecordInvalid
        ? cause
        : new StorageError(
            StorageErrorCode.journalRecoveryFailed,
            { cause },
            StorageErrorText.journalRecoveryFailed
          )
    options.onRecoverError?.(failure)
    throw failure
  }
  return Object.freeze({
    /** A durable intent precedes the marker staged in the original native data transaction. */
    begin: async (
      scope: Omit<ITransactionScope, 'use'>,
      commit: ILogPayload,
      changes: readonly ILogPayload[]
    ) => {
      const txId = object(commit).txId as string
      const payload = snapshotLogRecords([
        {
          kind: StorageJournalKind.intent,
          payload: {
            version: 1,
            target: options.target,
            txId,
            commit,
            changes,
            binlog: binlog !== undefined,
            undo: undo !== undefined
          }
        }
      ])[0]!.payload
      const seq = await wal.begin(StorageJournalKind.intent, payload)
      try {
        await binding.writeCommitMarker!(scope, txId)
      } catch (cause) {
        try {
          await wal.abort(seq)
        } catch (cleanup) {
          reportCleanupError(report, cleanup)
        }
        throw cause
      }
      return Object.freeze({
        /** Known rollback aborts its intent without producing a false commit record. */
        abort: async () => {
          try {
            await wal.abort(seq)
          } catch (error) {
            reportCleanupError(report, error)
          }
        },
        /** Failure before complete leaves both marker and pending intent for the next open. */
        complete: async (onBinlogFailure?: (error: unknown) => void) => {
          await publish(intent(payload, options.backend), onBinlogFailure)
          await wal.complete(seq)
          try {
            await binding.removeCommitMarker!(txId)
          } catch (cleanup) {
            reportCleanupError(report, cleanup)
          }
        }
      })
    }
  })
}
