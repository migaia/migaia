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
export type IStorageJournalTargetIdentity = Readonly<{
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
export function storageJournalTargetsMatch(
  left: IStorageJournalTargetIdentity,
  right: IStorageJournalTargetIdentity
): boolean {
  return (
    left.namespace === right.namespace &&
    left.backendInstanceId === right.backendInstanceId &&
    left.orgId === right.orgId
  )
}
/** Read only the complete target before deciding whether its other persisted fields are owned. */
export function readStorageJournalIntentTarget(input: unknown): IStorageJournalTargetIdentity {
  try {
    return identity(object(input).target)
  } catch (cause) {
    if (cause instanceof StorageError && cause.code === StorageErrorCode.journalRecordInvalid)
      throw cause
    return invalid(cause)
  }
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
export function readStorageJournalIntent(input: unknown, backend: IBackendKind, redo = false) {
  try {
    const value = object(input)
    const owner = identity(value.target)
    if (value.version !== 1 || typeof value.txId !== 'string' || value.txId.length === 0) invalid()
    const commit = object(value.commit)
    if (
      commit.version !== 1 ||
      commit.txId !== value.txId ||
      !storageJournalTargetsMatch(identity(commit.target), owner) ||
      !Array.isArray(commit.changes) ||
      !Array.isArray(value.changes) ||
      commit.changes.length !== value.changes.length ||
      value.changes.length === 0
    )
      invalid()
    if (
      (value.binlog !== undefined && typeof value.binlog !== 'boolean') ||
      (value.undo !== undefined && typeof value.undo !== 'boolean') ||
      (value.binlog === false && value.undo !== true && !redo)
    )
      invalid()
    /** Recovery derives undo from the same full ordered changes, rather than a second wire catalog. */
    const changes: IStorageJournalChange[] | undefined =
      value.undo === true || redo ? [] : undefined
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
      images: value.undo === true ? storageJournalUndoImages(owner, changes!, backend) : undefined,
      changes
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
type IStorageExternalWalOptions = {
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
}
/** The bridge retains original logger objects and native marker authority, without its own FIFO. */
type IStorageExternalWalContext = {
  readonly options: IStorageExternalWalOptions
  readonly binding: IStorageJournalBackendAccess['binding']
  readonly wal: IWalExt['wal']
  readonly binlog: IBinlogExt['binlog'] | undefined
  readonly undo: IUndoLogExt['undo'] | undefined
  readonly report: (error: unknown) => void
}
/** The original logger owns append/index serialization; repeated undo publication is exact-only. */
async function publishStorageWal(
  context: IStorageExternalWalContext,
  pending: ReturnType<typeof readStorageJournalIntent>,
  onBinlogFailure?: (error: unknown) => void
) {
  if (pending.binlog) {
    if (context.binlog === undefined)
      throw new StorageContractError(StorageContractErrorCode.unsupported)
    try {
      await context.binlog.append(StorageJournalKind.commit, pending.commit)
    } catch (error) {
      onBinlogFailure?.(error)
      throw error
    }
  }
  if (pending.undo) {
    if (context.undo === undefined)
      throw new StorageContractError(StorageContractErrorCode.unsupported)
    /** An interrupted completion may already have committed the original txId's mirror. */
    const existing = await context.undo.get(pending.txId)
    if (existing === undefined) await context.undo.record(pending.txId, pending.images!)
    else {
      readStorageUndoRows(existing, context.options.target, context.options.backend)
      if (!equalStorageJournalPayload(existing as ILogPayload, pending.images! as ILogPayload))
        invalid()
    }
  }
}
/** Recovery examines the original pending index and exact target before native marker I/O. */
async function recoverStorageWal(context: IStorageExternalWalContext): Promise<void> {
  /** Recovery scans the original logger's pending index only, never committed history. */
  const started = Date.now()
  let recovered = 0
  context.options.beforeRecover?.()
  try {
    for (const record of await context.wal.pending()) {
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
      if (!storageJournalTargetsMatch(owner, context.options.target)) continue
      const pending = readStorageJournalIntent(record.payload, context.options.backend)
      if (await context.binding.hasCommitMarker!(pending.txId)) {
        await publishStorageWal(context, pending)
        await context.wal.complete(record.seq)
        try {
          await context.binding.removeCommitMarker!(pending.txId)
        } catch (error) {
          reportCleanupError(context.report, error)
        }
      } else await context.wal.abort(record.seq)
      recovered++
    }
    context.options.afterRecover?.(recovered, Date.now() - started)
  } catch (cause) {
    const failure =
      cause instanceof StorageError && cause.code === StorageErrorCode.journalRecordInvalid
        ? cause
        : new StorageError(
            StorageErrorCode.journalRecoveryFailed,
            { cause },
            StorageErrorText.journalRecoveryFailed
          )
    context.options.onRecoverError?.(failure)
    throw failure
  }
}
/** One durable pending record retains its original sequence, payload and marker identity. */
type IStorageWalIntentContext = {
  readonly journal: IStorageExternalWalContext
  readonly seq: number
  readonly txId: string
  readonly payload: ILogPayload
}
/** A known rollback aborts only its original intent; reporting preserves the native outcome. */
async function abortStorageWalIntent(intent: IStorageWalIntentContext): Promise<void> {
  try {
    await intent.journal.wal.abort(intent.seq)
  } catch (error) {
    reportCleanupError(intent.journal.report, error)
  }
}
/** Publication precedes durable completion; cleanup cannot turn known success into rollback. */
async function completeStorageWalIntent(
  intent: IStorageWalIntentContext,
  onBinlogFailure?: (error: unknown) => void
): Promise<void> {
  await publishStorageWal(
    intent.journal,
    readStorageJournalIntent(intent.payload, intent.journal.options.backend),
    onBinlogFailure
  )
  await intent.journal.wal.complete(intent.seq)
  try {
    await intent.journal.binding.removeCommitMarker!(intent.txId)
  } catch (cleanup) {
    reportCleanupError(intent.journal.report, cleanup)
  }
}
/** Durable intent capture precedes the marker staged in the authentic native data transaction. */
async function beginStorageWal(
  context: IStorageExternalWalContext,
  scope: Omit<ITransactionScope, 'use'>,
  commit: ILogPayload,
  changes: readonly ILogPayload[]
) {
  const txId = object(commit).txId as string
  const payload = snapshotLogRecords([
    {
      kind: StorageJournalKind.intent,
      payload: {
        version: 1,
        target: context.options.target,
        txId,
        commit,
        changes,
        binlog: context.binlog !== undefined,
        undo: context.undo !== undefined
      }
    }
  ])[0]!.payload
  const seq = await context.wal.begin(StorageJournalKind.intent, payload)
  try {
    await context.binding.writeCommitMarker!(scope, txId)
  } catch (cause) {
    try {
      await context.wal.abort(seq)
    } catch (cleanup) {
      reportCleanupError(context.report, cleanup)
    }
    throw cause
  }
  const intent: IStorageWalIntentContext = { journal: context, seq, txId, payload }
  return {
    abort: () => abortStorageWalIntent(intent),
    complete: (onBinlogFailure?: (error: unknown) => void) =>
      completeStorageWalIntent(intent, onBinlogFailure)
  }
}
/** Prepare the existing external intent/marker bridge before the host publishes this journal. */
export async function createStorageExternalWal(options: IStorageExternalWalOptions) {
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
  const context: IStorageExternalWalContext = {
    options,
    binding,
    wal,
    binlog,
    undo,
    report: options.report ?? createStorageOperationReporter()
  }
  await recoverStorageWal(context)
  return {
    begin: (
      scope: Omit<ITransactionScope, 'use'>,
      commit: ILogPayload,
      changes: readonly ILogPayload[]
    ) => beginStorageWal(context, scope, commit, changes)
  }
}
