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
  type IUndoImage,
  type ILogPayload
} from '@migaia/logger/plugins/durable'
import { StorageError, StorageErrorCode } from '../errors.js'
import { StorageErrorText } from '../error-text.js'
import type { IStorageJournalBackendAccess } from './binding.js'
import type {
  IStorageJournalImage,
  IStorageJournalChange,
  IStorageJournalNamespace,
  IStorageJournalTarget,
  IStorageJournalUndoRunner
} from './types.js'
import {
  invalidStorageJournalRecord,
  readStorageJournalTarget,
  storageJournalTargetIdentity,
  storageJournalTargetWire
} from './targets.js'
import { StorageJournalKind } from './constants.js'

/** Persisted target and images are detached before waiting for any business lock. */
type IStorageUndoRow = {
  readonly target: IStorageJournalTarget
  readonly before: IStorageJournalImage
  readonly after: IStorageJournalImage
  readonly afterRevision: ILogPayload
}
/** Logger JSON has no cycles; compare complete revisions linearly without key sorting or recursion. */
export function equalStorageJournalPayload(left: ILogPayload, right: ILogPayload): boolean {
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
  if (value.present === false && !Object.hasOwn(value, 'value')) return { present: false }
  if (value.present === true && typeof value.value === 'string')
    return { present: true, value: value.value }
  return invalidStorageJournalRecord()
}
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

/** Validate this owned mirror once before restore or external recovery publishes it. */
export function readStorageUndoRows(
  input: unknown,
  owner: Readonly<{ namespace: string; backendInstanceId: string; orgId: string }>,
  backend: IBackendKind
): readonly IStorageUndoRow[] {
  try {
    /** Reuse logger's one JSON snapshot validator rather than a second persistence codec. */
    const captured = snapshotLogRecords([
      { kind: StorageJournalKind.commit, payload: input as readonly IUndoImage[] }
    ])[0]!.payload
    if (!Array.isArray(captured) || captured.length === 0) invalidStorageJournalRecord()
    /** Only this decoded record is deduplicated; value and deadline remain distinct image rows. */
    const seen = new Set<string>()
    return captured.map((entry) => {
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
        target.namespace !== owner.namespace ||
        target.backendInstanceId !== owner.backendInstanceId ||
        target.orgId !== owner.orgId ||
        !Object.hasOwn(target, 'afterRevision')
      )
        invalidStorageJournalRecord()
      /** The original target codec distinguishes image identity from its potentially shared lock. */
      const decoded = readStorageJournalTarget(target.identity, backend)
      /** Repeated persisted rows could otherwise restore two different before images in sequence. */
      const key = storageJournalTargetIdentity(decoded, backend)
      if (seen.has(key)) invalidStorageJournalRecord()
      seen.add(key)
      return {
        target: decoded,
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
    /** All mirror validation completes before the original business locks are acquired. */
    const rows = readStorageUndoRows(stored, options.target, options.backend)
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
          !equalStorageJournalPayload(revision, row.afterRevision) ||
          current.present !== row.after.present ||
          (current.present && row.after.present && current.value !== row.after.value)
        )
          throw new StorageError(StorageErrorCode.undoConflict, {}, StorageErrorText.undoConflict)
      }
      for (const row of rows) await binding.writeImage!(scope, row.target, row.before)
      return { txId: info.id }
    })
  }
}
