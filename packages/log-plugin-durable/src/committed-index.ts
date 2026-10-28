import { DurableErrorField } from './errors.ts'
import {
  createDurableError,
  createDurableTypeError,
  tagDurableError,
  LogDurableErrorCode,
  ERROR_SOURCE
} from './errors.ts'
import { snapshotPayload } from './snapshot.ts'
import { LogRecordState } from './state-constants.ts'
import { DurableText } from './error-text.ts'
import type { ILogPayload, ILogRecord } from './types.ts'

/** Admitted records retain the original portable payload snapshot without assigning a sequence. */
export type ILogRecordSnapshot = Readonly<{ kind: string; payload: ILogPayload }>
/** Recovery facts retain permanent watermarks even when the committed record set is empty. */
export type ILogStoreSnapshot = {
  readonly lastSeq: number
  readonly time: number
  readonly floor: number
  readonly records: readonly (ILogRecord & { readonly state: LogRecordState })[]
}
/**
 * Native adapters pass decoded row fields while their own codec controls the payload
 * representation.
 */
export type ILogStoreRecoveryRow = Readonly<
  Omit<ILogRecord, 'payload'> & { payload: unknown; state: LogRecordState }
>
/**
 * The index contains committed data only; native persistence and notifications stay with its
 * caller.
 */
export type ILogStoreIndex = {
  readonly lastSeq: number
  readonly time: number
  readonly floor: number
  read(fromSeq: number, limit: number): readonly ILogRecord[]
  pending(): readonly number[]
  checkTruncate(beforeSeq: number): boolean
  applyTruncate(beforeSeq: number): void
  checkState(seq: number, state: LogRecordState): boolean
  applyState(seq: number, state: LogRecordState): void
  applyAppend(records: readonly ILogRecord[]): void
}
/** Constant-time unlink retains only active pending entries, exactly as in the original store. */
type IPendingNode = { seq: number; previous?: IPendingNode; next?: IPendingNode }

/** Original numeric admission distinguishes invalid arguments from sequence exhaustion. */
export function assertLogInteger(value: unknown, minimum = 1): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) {
    /** Representational exhaustion remains distinct from malformed numeric arguments. */
    const exhausted =
      typeof value === 'number' && Number.isInteger(value) && value > Number.MAX_SAFE_INTEGER
    throw tagDurableError(
      new RangeError(exhausted ? DurableText.exhausted : DurableText.invalidOption),
      exhausted ? LogDurableErrorCode.logSequenceExhausted : LogDurableErrorCode.invalidOption
    )
  }
}

/**
 * Assign original monotonic sequence/time facts to an already captured batch. Preparation changes
 * no index, publishes no notice and performs no I/O; adapters apply the result only after commit.
 */
export function prepareLogAppend(
  records: readonly ILogRecordSnapshot[],
  head: Pick<ILogStoreSnapshot, 'lastSeq' | 'time'>,
  now?: number
): readonly ILogRecord[] {
  if (records.length === 0) return []
  /** Native adapters supply one stable committed head, captured before their first write. */
  let lastSeq: number
  let time: number
  try {
    lastSeq = head.lastSeq
    assertLogInteger(lastSeq, 0)
    time = head.time
    if (
      !Number.isFinite(time) ||
      time < 0 ||
      (now !== undefined && (!Number.isFinite(now) || now < 0))
    )
      throw createDurableTypeError(LogDurableErrorCode.invalidOption, DurableText.invalidOption)
  } catch (cause) {
    if (
      cause instanceof Error &&
      Object.getOwnPropertyDescriptor(cause, DurableErrorField.source)?.value === ERROR_SOURCE
    )
      throw cause
    throw createDurableTypeError(LogDurableErrorCode.invalidOption, DurableText.invalidOption, {
      cause
    })
  }
  if (!Number.isSafeInteger(lastSeq + records.length))
    throw createDurableError(LogDurableErrorCode.logSequenceExhausted, DurableText.exhausted)
  /** Empty batches and exhausted heads never consult the native clock. */
  const stamp = Math.max(time, now === undefined ? Date.now() : now)
  return records.map((row, index) => ({ seq: lastSeq + index + 1, time: stamp, ...row }))
}

/**
 * Reuse the original file recovery checks for native rows. Payload decoding occurs only after the
 * row's identity/state bounds validate, retaining the original corruption cause and error order.
 */
export function snapshotLogStoreState(
  head: Pick<ILogStoreSnapshot, 'lastSeq' | 'time' | 'floor'>,
  rows: Iterable<ILogStoreRecoveryRow>,
  decodePayload: (value: unknown) => unknown = (value) => value
): ILogStoreSnapshot {
  try {
    if (
      !head ||
      !Number.isSafeInteger(head.lastSeq) ||
      head.lastSeq < 0 ||
      !Number.isSafeInteger(head.floor) ||
      head.floor < 1 ||
      head.floor > head.lastSeq + 1 ||
      !Number.isFinite(head.time) ||
      head.time < 0
    )
      corruptStore()
    /** Only actual retained rows enter the recovery snapshot. */
    const records: (ILogRecord & { state: LogRecordState })[] = []
    /** The persistent floor determines the first required retained sequence. */
    let expected = head.floor
    /** Retained row time can never move backwards or exceed the committed head. */
    let previousTime = 0
    for (const row of rows) {
      if (
        row.seq !== expected++ ||
        !Number.isSafeInteger(row.seq) ||
        row.seq > head.lastSeq ||
        !Number.isFinite(row.time) ||
        row.time < previousTime ||
        row.time > head.time ||
        typeof row.kind !== 'string' ||
        !row.kind ||
        !Object.values(LogRecordState).includes(row.state)
      )
        corruptStore()
      try {
        records.push({ ...row, payload: snapshotPayload(decodePayload(row.payload)) })
        previousTime = row.time
      } catch (cause) {
        throw createDurableError(LogDurableErrorCode.logStoreCorrupt, DurableText.corrupt, {
          cause
        })
      }
    }
    if (expected !== head.lastSeq + 1) corruptStore()
    return { lastSeq: head.lastSeq, time: head.time, floor: head.floor, records }
  } catch (cause) {
    if (
      cause instanceof Error &&
      Object.getOwnPropertyDescriptor(cause, DurableErrorField.source)?.value === ERROR_SOURCE
    )
      throw cause
    throw createDurableError(LogDurableErrorCode.logStoreCorrupt, DurableText.corrupt, { cause })
  }
}

/** Recovery corruption never escapes without the durable identity. */
function corruptStore(): never {
  throw createDurableError(LogDurableErrorCode.logStoreCorrupt, DurableText.corrupt)
}

/** Committed data and its linked pending index share one owner without lifecycle authority. */
class CommittedLogIndex implements ILogStoreIndex {
  /** Sequence lookup retains only actual committed rows. */
  readonly #records = new Map<number, ILogRecord & { state: LogRecordState }>()
  /** Pending nodes unlink in constant time after a terminal transition or prefix truncation. */
  readonly #pending = new Map<number, IPendingNode>()
  /** The oldest active pending record starts the ordered cursor. */
  #head: IPendingNode | undefined
  /** The newest active pending record receives the next append. */
  #tail: IPendingNode | undefined
  /** Permanent sequence watermark survives a fully truncated record set. */
  #last: number
  /** Committed timestamps never decrease across reopened resources. */
  #time: number
  /** Retained contiguous records begin at this persistent floor. */
  #floor: number
  /** Public watermarks remain own enumerable getters, as in the original data index. */
  declare readonly lastSeq: number
  /** Public timestamp is borrowed read-only by native adapter preparation. */
  declare readonly time: number
  /** Public retained floor is borrowed read-only by native adapter recovery. */
  declare readonly floor: number

  /** Populate exactly the admitted recovery snapshot without adding a queue or resource. */
  constructor(snapshot: ILogStoreSnapshot) {
    this.#last = snapshot.lastSeq
    this.#time = snapshot.time
    this.#floor = snapshot.floor
    Object.defineProperties(this, {
      lastSeq: { enumerable: true, get: () => this.#last },
      time: { enumerable: true, get: () => this.#time },
      floor: { enumerable: true, get: () => this.#floor }
    })
    for (const row of snapshot.records) {
      this.#records.set(row.seq, { ...row })
      if (row.state === LogRecordState.pending) this.#addPending(row.seq)
    }
  }
  /** The creator alone receives cleanup; the public index has no clear or dispose member. */
  static owned(snapshot: ILogStoreSnapshot): { index: ILogStoreIndex; clear: () => void } {
    /** One owner supplies the existing data-only interface and its private cleanup receipt. */
    const index = new CommittedLogIndex(snapshot)
    return { index, clear: () => index.#clear() }
  }
  /** Stable own callbacks preserve extraction and object-spread behavior of the old index. */
  readonly read: ILogStoreIndex['read'] = (fromSeq, limit) => this.#read(fromSeq, limit)
  /** Pending traversal visits only live pending entries. */
  readonly pending: ILogStoreIndex['pending'] = () => this.#readPending()
  /** Validate the persistent prefix before native persistence changes it. */
  readonly checkTruncate: ILogStoreIndex['checkTruncate'] = (beforeSeq) =>
    this.#checkTruncate(beforeSeq)
  /** Apply a successfully persisted prefix deletion. */
  readonly applyTruncate: ILogStoreIndex['applyTruncate'] = (beforeSeq) =>
    this.#applyTruncate(beforeSeq)
  /** Validate one-way pending state before the adapter commits it. */
  readonly checkState: ILogStoreIndex['checkState'] = (seq, state) => this.#checkState(seq, state)
  /** Apply a committed terminal state without reopening old entries. */
  readonly applyState: ILogStoreIndex['applyState'] = (seq, state) => this.#applyState(seq, state)
  /** Commit the prepared batch to the shared in-memory index after native success. */
  readonly applyAppend: ILogStoreIndex['applyAppend'] = (batch) => this.#applyAppend(batch)

  /** Append a single pending node in the same sequence order as committed rows. */
  #addPending(seq: number): void {
    /** Each sequence owns its exact neighbors until terminal state or truncation. */
    const node: IPendingNode = { seq, previous: this.#tail }
    if (this.#tail) this.#tail.next = node
    else this.#head = node
    this.#tail = node
    this.#pending.set(seq, node)
  }
  /** Remove one pending node without scanning historical records. */
  #removePending(seq: number): void {
    /** Missing or already terminal rows have no active pending link. */
    const node = this.#pending.get(seq)
    if (!node) return
    if (node.previous) node.previous.next = node.next
    else this.#head = node.next
    if (node.next) node.next.previous = node.previous
    else this.#tail = node.previous
    this.#pending.delete(seq)
  }
  /** Public reads detach payloads while preserving original retained-sequence order. */
  #read(fromSeq: number, limit: number): readonly ILogRecord[] {
    /** Only actual retained rows are copied into the caller-owned result. */
    const result: ILogRecord[] = []
    for (
      let seq = Math.max(fromSeq, this.#floor);
      seq <= this.#last && result.length < limit;
      seq++
    ) {
      /** The committed Map is authoritative after truncation. */
      const row = this.#records.get(seq)
      if (row)
        result.push({
          seq: row.seq,
          time: row.time,
          kind: row.kind,
          payload: snapshotPayload(row.payload)
        })
    }
    return result
  }
  /** Pending results retain linked-list order and never sort a growable collection. */
  #readPending(): readonly number[] {
    /** The caller owns this independent pending sequence snapshot. */
    const result: number[] = []
    for (let node = this.#head; node; node = node.next) result.push(node.seq)
    return result
  }
  /** A prefix cannot advance beyond the next legal sequence. */
  #checkTruncate(beforeSeq: number): boolean {
    if (beforeSeq > this.#last + 1)
      throw tagDurableError(
        new RangeError(DurableText.invalidOption),
        LogDurableErrorCode.invalidOption
      )
    return beforeSeq > this.#floor
  }
  /** Every removed sequence and pending node is visited once. */
  #applyTruncate(beforeSeq: number): void {
    for (let seq = this.#floor; seq < beforeSeq; seq++) {
      this.#records.delete(seq)
      this.#removePending(seq)
    }
    this.#floor = beforeSeq
  }
  /** Only retained pending records may make a terminal transition. */
  #checkState(seq: number, state: LogRecordState): boolean {
    /** Membership and one-way state are checked before persistence. */
    const row = this.#records.get(seq)
    if (!row || row.state !== LogRecordState.pending)
      throw createDurableError(LogDurableErrorCode.walRecordInvalid, DurableText.walInvalid)
    return state !== LogRecordState.pending
  }
  /** A successful adapter commit removes its pending link exactly once. */
  #applyState(seq: number, state: LogRecordState): void {
    /** A transition cannot revive a missing or already terminal row. */
    const row = this.#records.get(seq)
    if (!row || row.state !== LogRecordState.pending)
      throw createDurableError(LogDurableErrorCode.walRecordInvalid, DurableText.walInvalid)
    row.state = state
    this.#removePending(seq)
  }
  /** Apply a batch only after the native owner's successful atomic commit. */
  #applyAppend(batch: readonly ILogRecord[]): void {
    for (const row of batch) {
      this.#records.set(row.seq, { ...row, state: LogRecordState.pending })
      this.#addPending(row.seq)
    }
    if (batch.length === 0) return
    this.#last = batch[batch.length - 1]!.seq
    this.#time = batch[batch.length - 1]!.time
  }
  /** Disposal of the resource releases retained data without granting cleanup to index users. */
  #clear(): void {
    this.#records.clear()
    this.#pending.clear()
    this.#head = undefined
    this.#tail = undefined
  }
}

/** The original resource owner alone receives cleanup alongside its data-only index. */
export function createOwnedLogStoreIndex(
  snapshot: ILogStoreSnapshot = { lastSeq: 0, time: 0, floor: 1, records: [] }
): { index: ILogStoreIndex; clear: () => void } {
  return CommittedLogIndex.owned(snapshot)
}

/** Native adapters retain complete commit and lifecycle ownership of their original resource. */
export function createLogStoreIndex(snapshot?: ILogStoreSnapshot): ILogStoreIndex {
  return createOwnedLogStoreIndex(
    snapshot === undefined ? undefined : snapshotLogStoreState(snapshot, snapshot.records)
  ).index
}
