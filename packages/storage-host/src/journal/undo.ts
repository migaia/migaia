import {
  assertOperationContext,
  snapshotConcurrencyLockKeys,
  StorageContractError,
  StorageContractErrorCode,
  type IBackendKind
} from '@migaia/storage-contract'
import {
  snapshotLogRecords,
  type IUndoLogExt,
  type ILogPayload
} from '@migaia/logger/plugins/durable'
import { StorageError, StorageErrorCode } from '../errors.js'
import { StorageErrorText } from '../error-text.js'
import type { IStorageJournalBackendAccess } from './binding.js'
import type {
  IStorageJournalImage,
  IStorageJournalNamespace,
  IStorageJournalTarget,
  IStorageJournalUndoRunner
} from './types.js'
import { invalidStorageJournalRecord, readStorageJournalTarget } from './targets.js'
import { StorageJournalKind } from './constants.js'

/** Persisted target and images are detached before waiting for any business lock. */
type IStorageUndoRow = {
  readonly target: IStorageJournalTarget
  readonly before: IStorageJournalImage
  readonly after: IStorageJournalImage
  readonly afterRevision: ILogPayload
}
/** Logger JSON has no cycles; compare complete revisions linearly without key sorting or recursion. */
function equalPayload(left: ILogPayload, right: ILogPayload): boolean {
  /** Only unvisited revision pairs remain; this is not a retained history index. */
  const pending: Array<readonly [ILogPayload, ILogPayload]> = [[left, right]]
  while (pending.length !== 0) {
    const [a, b] = pending.pop()!
    if (a === b) continue
    if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false
    if (Array.isArray(a) || Array.isArray(b)) {
      if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
      for (let index = 0; index < a.length; index++) pending.push([a[index]!, b[index]!])
    } else {
      /** Own JSON keys compare by membership, preserving object semantic equality. */
      const keys = Object.keys(a)
      if (keys.length !== Object.keys(b).length) return false
      for (const key of keys) {
        if (!Object.hasOwn(b, key)) return false
        pending.push([
          (a as Record<string, ILogPayload>)[key]!,
          (b as Record<string, ILogPayload>)[key]!
        ])
      }
    }
  }
  return true
}
/** The original value codec owns the string; absence stays distinct from a legitimate null image. */
function image(input: unknown): IStorageJournalImage {
  if (input === null || typeof input !== 'object' || Array.isArray(input))
    invalidStorageJournalRecord()
  /** Presence is copied once; the backend retains ownership of the encoded value string. */
  const value = input as Record<string, unknown>
  if (value.present === false && !Object.hasOwn(value, 'value'))
    return Object.freeze({ present: false })
  if (value.present === true && typeof value.value === 'string')
    return Object.freeze({ present: true, value: value.value })
  return invalidStorageJournalRecord()
}
/** Undo borrows original committed images and executes only the backend's original lock builder. */
export function createStorageJournalUndo(options: {
  readonly access: IStorageJournalBackendAccess
  readonly backend: IBackendKind
  readonly target: Readonly<{ namespace: string; backendInstanceId: string; orgId: string }>
  readonly undo: IUndoLogExt['undo']
  readonly terminal: IStorageJournalNamespace
}) {
  const { binding } = options.access
  if (
    binding.readImage === undefined ||
    binding.writeImage === undefined ||
    binding.readRevision === undefined ||
    binding.lockTarget === undefined
  )
    throw new StorageContractError(StorageContractErrorCode.unsupported)
  return async (
    txId: string,
    run: IStorageJournalUndoRunner
  ): Promise<{ readonly txId: string }> => {
    if (typeof txId !== 'string' || txId.length === 0)
      throw new StorageContractError(StorageContractErrorCode.invalidArgument)
    /** The borrowed logger returns only its original committed transaction index entry. */
    const stored = await options.undo.get(txId)
    if (stored === undefined)
      throw new StorageError(StorageErrorCode.undoNotFound, {}, StorageErrorText.undoNotFound)
    /** All target/image validation completes before acquiring the original business locks. */
    let rows: readonly IStorageUndoRow[]
    try {
      /** Reuse logger's one JSON snapshot validator rather than a second persistence codec. */
      const captured = snapshotLogRecords([
        { kind: StorageJournalKind.commit, payload: stored }
      ])[0]!.payload
      if (!Array.isArray(captured) || captured.length === 0) invalidStorageJournalRecord()
      rows = captured.map((entry) => {
        if (entry === null || typeof entry !== 'object' || Array.isArray(entry))
          invalidStorageJournalRecord()
        /** Mirror target fields survive logger's existing target/before/after projection. */
        const record = entry as Record<string, ILogPayload>
        /** An encoded target never grants authority until it matches this exact fixed closure. */
        const raw = record.target
        if (raw === null || typeof raw !== 'object' || Array.isArray(raw))
          invalidStorageJournalRecord()
        /** The original org validator supplies the same UUID domain used by all host operations. */
        const target = raw as Record<string, ILogPayload>
        assertOperationContext({ orgId: target.orgId as string })
        if (
          target.version !== 1 ||
          target.namespace !== options.target.namespace ||
          target.backendInstanceId !== options.target.backendInstanceId ||
          target.orgId !== options.target.orgId ||
          !Object.hasOwn(target, 'afterRevision')
        )
          invalidStorageJournalRecord()
        return {
          target: readStorageJournalTarget(target.identity, options.backend),
          before: image(record.before),
          after: image(record.after),
          afterRevision: target.afterRevision!
        }
      })
    } catch (cause) {
      if (cause instanceof StorageError && cause.code === StorageErrorCode.journalRecordInvalid)
        throw cause
      return invalidStorageJournalRecord(cause)
    }
    /** The backend maps metadata onto its existing point; canonical ordering remains in tx().lock. */
    const keys = snapshotConcurrencyLockKeys(
      rows.map((row) => binding.lockTarget!(row.target)),
      options.backend
    ).keys
    return run(keys, async (scope) => {
      /** A successful undo returns the actual new native transaction identity. */
      const info = options.terminal.transactionInfo(scope)
      /** Check every complete revision and current semantic image before staging any restore. */
      for (const row of rows) {
        /** Clear epochs and tombstones remain opaque complete facts from the original backend. */
        const revision = await binding.readRevision!(scope, row.target)
        /** Compare the same codec wire and presence that were persisted at the original commit. */
        const current = await binding.readImage!(scope, row.target)
        if (
          !equalPayload(revision, row.afterRevision) ||
          current.present !== row.after.present ||
          (current.present && row.after.present && current.value !== row.after.value)
        )
          throw new StorageError(StorageErrorCode.undoConflict, {}, StorageErrorText.undoConflict)
      }
      for (const row of rows) await binding.writeImage!(scope, row.target, row.before)
      return Object.freeze({ txId: info.id })
    })
  }
}
