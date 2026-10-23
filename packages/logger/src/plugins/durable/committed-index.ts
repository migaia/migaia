import {
  createLoggerError,
  createLoggerTypeError,
  tagLoggerError,
  LoggerErrorCode,
  LOGGER_SOURCE
} from '../../errors.js'
import { snapshotPayload } from './snapshot.js'
import { LogRecordState } from './state-constants.js'
import { DurableText } from './text.js'
import type { ILogPayload, ILogRecord } from './types.js'

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
    throw tagLoggerError(
      new RangeError(exhausted ? DurableText.exhausted : DurableText.invalidOption),
      exhausted ? LoggerErrorCode.logSequenceExhausted : LoggerErrorCode.invalidOption
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
      throw createLoggerTypeError(LoggerErrorCode.invalidOption, DurableText.invalidOption)
  } catch (cause) {
    if (
      cause instanceof Error &&
      Object.getOwnPropertyDescriptor(cause, 'source')?.value === LOGGER_SOURCE
    )
      throw cause
    throw createLoggerTypeError(LoggerErrorCode.invalidOption, DurableText.invalidOption, { cause })
  }
  if (!Number.isSafeInteger(lastSeq + records.length))
    throw createLoggerError(LoggerErrorCode.logSequenceExhausted, DurableText.exhausted)
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
  /** Every malformed owned record stops recovery before committed data becomes public. */
  const fail = (): never => {
    throw createLoggerError(LoggerErrorCode.logStoreCorrupt, DurableText.corrupt)
  }
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
      fail()
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
        fail()
      try {
        records.push({ ...row, payload: snapshotPayload(decodePayload(row.payload)) })
        previousTime = row.time
      } catch (cause) {
        throw createLoggerError(LoggerErrorCode.logStoreCorrupt, DurableText.corrupt, { cause })
      }
    }
    if (expected !== head.lastSeq + 1) fail()
    return { lastSeq: head.lastSeq, time: head.time, floor: head.floor, records }
  } catch (cause) {
    if (
      cause instanceof Error &&
      Object.getOwnPropertyDescriptor(cause, 'source')?.value === LOGGER_SOURCE
    )
      throw cause
    throw createLoggerError(LoggerErrorCode.logStoreCorrupt, DurableText.corrupt, { cause })
  }
}

/** The original resource owner keeps cleanup private while sharing exactly the same index body. */
export function createOwnedLogStoreIndex(
  snapshot: ILogStoreSnapshot = { lastSeq: 0, time: 0, floor: 1, records: [] }
) {
  /** Sequence lookup never relies on historical array positions. */
  const records = new Map<number, ILogRecord & { state: LogRecordState }>()
  /** Only pending entries retain list nodes. */
  const pending = new Map<number, IPendingNode>()
  /** Creation order is also sequence order. */
  let head: IPendingNode | undefined
  /** The tail appends one new pending node in constant time. */
  let tail: IPendingNode | undefined
  /** Watermarks survive full prefix truncation. */
  let last = snapshot.lastSeq
  /** Time remains nondecreasing across reopened resources. */
  let time = snapshot.time
  /** Retained rows start at the persistent floor. */
  let floor = snapshot.floor
  /** Append one pending row without scanning any historical record. */
  const addPending = (seq: number): void => {
    /** Each sequence owns its exact neighboring links until terminal state or truncation. */
    const node: IPendingNode = { seq, previous: tail }
    if (tail) tail.next = node
    else head = node
    tail = node
    pending.set(seq, node)
  }
  /** Remove one active node without sorting or scanning the committed index. */
  const removePending = (seq: number): void => {
    /** Missing or already terminal rows have no active pending link. */
    const node = pending.get(seq)
    if (!node) return
    if (node.previous) node.previous.next = node.next
    else head = node.next
    if (node.next) node.next.previous = node.previous
    else tail = node.previous
    pending.delete(seq)
  }
  for (const row of snapshot.records) {
    records.set(row.seq, { ...row })
    if (row.state === LogRecordState.pending) addPending(row.seq)
  }
  /** The author index owns no queue, close state, native resource or publication channel. */
  const index: ILogStoreIndex = {
    get lastSeq() {
      return last
    },
    get time() {
      return time
    },
    get floor() {
      return floor
    },
    read: (fromSeq, limit) => {
      /** Public results detach payloads exactly as the original log resource did. */
      const result: ILogRecord[] = []
      for (let seq = Math.max(fromSeq, floor); seq <= last && result.length < limit; seq++) {
        /** Actual retained membership determines output after committed truncation. */
        const row = records.get(seq)
        if (row)
          result.push({
            seq: row.seq,
            time: row.time,
            kind: row.kind,
            payload: snapshotPayload(row.payload)
          })
      }
      return result
    },
    pending: () => {
      /** Pending reads visit only the active linked list. */
      const result: number[] = []
      for (let node = head; node; node = node.next) result.push(node.seq)
      return result
    },
    checkTruncate: (beforeSeq) => {
      if (beforeSeq > last + 1)
        throw tagLoggerError(
          new RangeError(DurableText.invalidOption),
          LoggerErrorCode.invalidOption
        )
      return beforeSeq > floor
    },
    applyTruncate: (beforeSeq) => {
      for (let seq = floor; seq < beforeSeq; seq++) {
        records.delete(seq)
        removePending(seq)
      }
      floor = beforeSeq
    },
    checkState: (seq, state) => {
      /** Membership and the one-way terminal rule are checked before native persistence. */
      const row = records.get(seq)
      if (!row || row.state !== LogRecordState.pending)
        throw createLoggerError(LoggerErrorCode.walRecordInvalid, DurableText.walInvalid)
      return state !== LogRecordState.pending
    },
    applyState: (seq, state) => {
      /** Apply only an admitted pending transition after the caller's native commit. */
      const row = records.get(seq)
      if (!row || row.state !== LogRecordState.pending)
        throw createLoggerError(LoggerErrorCode.walRecordInvalid, DurableText.walInvalid)
      row.state = state
      removePending(seq)
    },
    applyAppend: (batch) => {
      for (const row of batch) {
        records.set(row.seq, { ...row, state: LogRecordState.pending })
        addPending(row.seq)
      }
      if (batch.length === 0) return
      last = batch[batch.length - 1]!.seq
      time = batch[batch.length - 1]!.time
    }
  }
  return {
    index,
    clear: (): void => {
      records.clear()
      pending.clear()
      head = undefined
      tail = undefined
    }
  }
}

/** Create one committed data index; native adapters retain complete commit and lifecycle ownership. */
export function createLogStoreIndex(snapshot?: ILogStoreSnapshot): ILogStoreIndex {
  return createOwnedLogStoreIndex(
    snapshot === undefined ? undefined : snapshotLogStoreState(snapshot, snapshot.records)
  ).index
}
