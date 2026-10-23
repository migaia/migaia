import {
  assertLogInteger,
  LogRecordState,
  prepareLogAppend,
  snapshotLogStoreState,
  type ILogRecord,
  type ILogRecordSnapshot,
  type ILogStoreRecoveryRow,
  type ILogStoreSnapshot
} from '@migaia/logger/plugins/durable'
import { StorageError, StorageErrorCode } from '../errors.js'
import { StorageErrorText } from '../error-text.js'
import type { IStorageJournalNamespaceView } from './types.js'

/** The private wire is versioned independently of business codecs and never enters their keys. */
export const StorageLogWire = {
  format: 1,
  head: 'head',
  record: 'record:',
  state: 'state:'
} as const
/** One atomic head replacement is the sole visibility point for both native and non-native I/O. */
export type IStorageLogHead = {
  readonly format: typeof StorageLogWire.format
  readonly generation: number
  readonly lastSeq: number
  readonly time: number
  readonly floor: number
}
/** Records are immutable after their append generation commits. */
type IStorageLogRow = { readonly generation: number; readonly record: ILogRecord }
/** An unconfirmed state candidate retains its previous committed state for reopening. */
type IStorageLogState = {
  readonly generation: number
  readonly state: typeof LogRecordState.done | typeof LogRecordState.aborted
  readonly previous: typeof LogRecordState.pending
}
/** Corrupt private bytes carry no record data in their stable public diagnostic. */
function invalid(cause?: unknown): never {
  throw new StorageError(
    StorageErrorCode.journalRecordInvalid,
    { cause },
    StorageErrorText.journalRecordInvalid
  )
}
/** Parse the original JSON wire while preserving native parse failures on cause. */
function parse(raw: string): Record<string, unknown> {
  try {
    const value = JSON.parse(raw) as unknown
    if (value === null || typeof value !== 'object' || Array.isArray(value)) invalid()
    return value as Record<string, unknown>
  } catch (cause) {
    if (cause instanceof StorageError) throw cause
    return invalid(cause)
  }
}
/** Safe fixed-width decimal identities preserve sequence order without comparing stored rows. */
function sequenceKey(prefix: string, seq: number): string {
  return prefix + String(seq).padStart(16, '0')
}
/** Only canonical owned keys can participate in recovery or physical reclamation. */
function sequenceOf(key: string, prefix: string): number | undefined {
  if (!key.startsWith(prefix)) return undefined
  const suffix = key.slice(prefix.length)
  if (!/^\d{16}$/.test(suffix)) invalid()
  const seq = Number(suffix)
  if (!Number.isSafeInteger(seq) || seq < 1) invalid()
  return seq
}
/** Capture all head fields once; recovery validates their committed record bounds as well. */
export async function readStorageLogHead(
  view: IStorageJournalNamespaceView
): Promise<IStorageLogHead> {
  const raw = await view.get(StorageLogWire.head)
  if (raw === null)
    return { format: StorageLogWire.format, generation: 0, lastSeq: 0, time: 0, floor: 1 }
  const value = parse(raw)
  if (
    value.format !== StorageLogWire.format ||
    !Number.isSafeInteger(value.generation) ||
    (value.generation as number) < 0 ||
    !Number.isSafeInteger(value.lastSeq) ||
    (value.lastSeq as number) < 0 ||
    !Number.isSafeInteger(value.floor) ||
    (value.floor as number) < 1 ||
    (value.floor as number) > (value.lastSeq as number) + 1 ||
    typeof value.time !== 'number' ||
    !Number.isFinite(value.time) ||
    value.time < 0
  )
    invalid()
  return value as IStorageLogHead
}
/** Every mutating operation advances one safe generation before its first physical write. */
function nextHead(head: IStorageLogHead): IStorageLogHead {
  const generation = head.generation + 1
  assertLogInteger(generation, 0)
  return { ...head, generation }
}
/** Reclaim only actual obsolete rows; the committed floor remains authoritative on failure. */
export async function reclaimStorageLogRows(
  view: IStorageJournalNamespaceView,
  head: IStorageLogHead,
  beforeWrite?: () => void
): Promise<void> {
  for (const key of await view.keys()) {
    const seq = sequenceOf(key, StorageLogWire.record) ?? sequenceOf(key, StorageLogWire.state)
    if (seq !== undefined && (seq < head.floor || seq > head.lastSeq)) {
      beforeWrite?.()
      await view.remove(key)
    } else if (seq === undefined && key !== StorageLogWire.head) invalid()
  }
}
/** Recover actual retained rows, then let the logger's sole index owner validate the sequence. */
export async function recoverStorageLog(
  view: IStorageJournalNamespaceView
): Promise<ILogStoreSnapshot> {
  const head = await readStorageLogHead(view)
  const records = new Map<number, ILogStoreRecoveryRow>()
  for (const key of await view.keys()) {
    const seq = sequenceOf(key, StorageLogWire.record)
    if (seq === undefined) {
      if (key !== StorageLogWire.head && sequenceOf(key, StorageLogWire.state) === undefined)
        invalid()
      continue
    }
    if (seq < head.floor || seq > head.lastSeq) continue
    const raw = await view.get(key)
    if (raw === null) invalid()
    const row = parse(raw) as unknown as IStorageLogRow
    if (!Number.isSafeInteger(row.generation) || row.generation < 1) invalid()
    if (row.generation > head.generation) continue
    const record = row.record
    if (!record || record.seq !== seq) invalid()
    let state: LogRecordState = LogRecordState.pending
    const stateRaw = await view.get(sequenceKey(StorageLogWire.state, seq))
    if (stateRaw !== null) {
      const candidate = parse(stateRaw) as unknown as IStorageLogState
      if (
        !Number.isSafeInteger(candidate.generation) ||
        candidate.generation < 1 ||
        candidate.previous !== LogRecordState.pending ||
        (candidate.state !== LogRecordState.done && candidate.state !== LogRecordState.aborted)
      )
        invalid()
      state = candidate.generation <= head.generation ? candidate.state : candidate.previous
      /** A later committed operation must never make this failed candidate retroactively visible. */
      if (candidate.generation > head.generation)
        await view.remove(sequenceKey(StorageLogWire.state, seq))
    }
    records.set(seq, { ...record, state })
  }
  /** Sequential lookup has no comparison sort and does not scan absent historical prefixes. */
  const rows = function* (): IterableIterator<ILogStoreRecoveryRow> {
    for (let seq = head.floor; seq <= head.lastSeq; seq++) {
      const row = records.get(seq)
      if (row === undefined) invalid()
      yield row
    }
  }
  const snapshot = snapshotLogStoreState(head, rows())
  await reclaimStorageLogRows(view, head)
  return snapshot
}
/** Write invisible append rows first and atomically replace the one commit head last. */
export async function appendStorageLog(
  view: IStorageJournalNamespaceView,
  captured: readonly ILogRecordSnapshot[],
  prepared?: readonly ILogRecord[],
  beforeWrite?: () => void
): Promise<readonly ILogRecord[]> {
  if (captured.length === 0) return []
  const head = await readStorageLogHead(view)
  /** An ordinary FIFO can prepare before native admission without wrapping pure logger errors. */
  const first = prepared?.[0]
  const batch =
    first !== undefined && first.seq === head.lastSeq + 1 && first.time >= head.time
      ? prepared!
      : prepareLogAppend(captured, head, first?.time)
  const last = batch[batch.length - 1]!
  const next = { ...nextHead(head), lastSeq: last.seq, time: last.time }
  beforeWrite?.()
  for (const record of batch) {
    await view.set(
      sequenceKey(StorageLogWire.record, record.seq),
      JSON.stringify({ generation: next.generation, record })
    )
    await view.remove(sequenceKey(StorageLogWire.state, record.seq))
  }
  await view.set(StorageLogWire.head, JSON.stringify(next))
  return batch
}
/** Stage one one-way state candidate before committing its generation in the original head. */
export async function setStorageLogState(
  view: IStorageJournalNamespaceView,
  seq: number,
  state: LogRecordState,
  beforeWrite?: () => void
): Promise<void> {
  const next = nextHead(await readStorageLogHead(view))
  beforeWrite?.()
  await view.set(
    sequenceKey(StorageLogWire.state, seq),
    JSON.stringify({ generation: next.generation, state, previous: LogRecordState.pending })
  )
  await view.set(StorageLogWire.head, JSON.stringify(next))
}
/** Commit the floor before physical cleanup so reopening cannot resurrect removed records. */
export async function truncateStorageLog(
  view: IStorageJournalNamespaceView,
  beforeSeq: number,
  beforeWrite?: () => void
): Promise<IStorageLogHead> {
  const next = { ...nextHead(await readStorageLogHead(view)), floor: beforeSeq }
  beforeWrite?.()
  await view.set(StorageLogWire.head, JSON.stringify(next))
  return next
}
