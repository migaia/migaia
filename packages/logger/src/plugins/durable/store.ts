import { createConcurrencyLimiter, deferred } from '@migaia/utils/promise'
import { asyncDisposeKey } from '@migaia/plugin-host'
import { createEventChannel, invokeEachLive } from '@migaia/event-subscriber'
import {
  createLoggerError,
  createLoggerTypeError,
  tagLoggerError,
  LoggerErrorCode,
  LOGGER_SOURCE
} from '../../errors.js'
import { snapshotPayload, snapshotRecords } from './snapshot.js'
import { createObservation, durableReporter, observeResult } from './observation.js'
import { LogOperation, LogRecordState, LogStage } from './state-constants.js'
import { DurableText } from './text.js'
import type {
  ILogAppendNotice,
  ILogPayload,
  ILogRecord,
  ILogStore,
  ILogStoreOptions
} from './types.js'

/** Adapter snapshots include permanent watermarks even when no records remain. */
export type ILogStoreSnapshot = {
  lastSeq: number
  time: number
  floor: number
  records: readonly (ILogRecord & { state: LogRecordState })[]
}
/** Durable adapters commit once before the common in-memory indexes change. */
export type ILogStorePersistence = {
  append(records: readonly ILogRecord[], lastSeq: number, time: number): void
  truncate(beforeSeq: number): void
  setState(seq: number, state: LogRecordState): void
  close(): void
}
/** Constant-time unlink for active pending records. */
type IPendingNode = { seq: number; previous?: IPendingNode; next?: IPendingNode }
/** Standardizes raw I/O failures while retaining known logger errors and native cause identity. */
export function logStorageFailure(error: unknown): Error {
  if (
    error instanceof Error &&
    Object.getOwnPropertyDescriptor(error, 'source')?.value === LOGGER_SOURCE
  )
    return error
  return createLoggerError(LoggerErrorCode.logStoreIoFailed, DurableText.ioFailed, { cause: error })
}
/** Public numeric admission keeps argument errors distinct from representational exhaustion. */
export function requireInteger(value: unknown, minimum = 1): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) {
    const exhausted =
      typeof value === 'number' && Number.isInteger(value) && value > Number.MAX_SAFE_INTEGER
    throw tagLoggerError(
      new RangeError(exhausted ? DurableText.exhausted : DurableText.invalidOption),
      exhausted ? LoggerErrorCode.logSequenceExhausted : LoggerErrorCode.invalidOption
    )
  }
}
/** One canonical resource implementation owns serialization, indexes, notifications, and closing. */
export function createLogStore(
  options: ILogStoreOptions = {},
  snapshot: ILogStoreSnapshot = { lastSeq: 0, time: 0, floor: 1, records: [] },
  persistence?: ILogStorePersistence
): ILogStore {
  /** All ordinary operations use the existing FIFO limiter. */
  const limiter = createConcurrencyLimiter({ concurrency: 1 })
  /** Retained committed rows are indexed by actual sequence, never historical array position. */
  const records = new Map<number, ILogRecord & { state: LogRecordState }>()
  /** Pending nodes support constant-time terminal removal. */
  const pending = new Map<number, IPendingNode>()
  /** Pending creation order is also the sequence order. */
  let head: IPendingNode | undefined
  let tail: IPendingNode | undefined
  /** Watermarks survive complete prefix truncation. */
  let last = snapshot.lastSeq
  let time = snapshot.time
  let floor = snapshot.floor
  /** Disposal closes admission immediately without dropping accepted work. */
  let accepting = true
  let failure: Error | undefined
  /** Explicit and symbolic disposal have separate stable Promise identities. */
  let disposePromise: Promise<void> | undefined
  let symbolPromise: Promise<void> | undefined
  /** Reports remain observer-only and cannot roll back a commit. */
  const report = durableReporter(options.report)
  const observe = createObservation(options, report)
  /** The resource owns this channel across plugin reinstallations. */
  const appended = createEventChannel<ILogAppendNotice, void>()
  /** Adds one pending row to creation order. */
  const addPending = (seq: number): void => {
    const node: IPendingNode = { seq, previous: tail }
    if (tail) tail.next = node
    else head = node
    tail = node
    pending.set(seq, node)
  }
  /** Unlinks one retained pending row without scanning history. */
  const removePending = (seq: number): void => {
    const node = pending.get(seq)
    if (!node) return
    if (node.previous) node.previous.next = node.next
    else head = node.next
    if (node.next) node.next.previous = node.previous
    else tail = node.previous
    pending.delete(seq)
  }
  for (const row of snapshot.records) {
    records.set(row.seq, row)
    if (row.state === LogRecordState.pending) addPending(row.seq)
  }
  /** Checks admission before enqueue; accepted callbacks never re-check the later close flag. */
  const admit = (): void => {
    if (failure) throw failure
    if (!accepting) throw createLoggerError(LoggerErrorCode.runtimeShuttingDown, DurableText.closed)
  }
  /** Executes one accepted operation and contains failures from a native adapter. */
  const run = <T>(operation: string, task: () => T): Promise<T> => {
    try {
      admit()
    } catch (error) {
      return Promise.reject(error)
    }
    return limiter.run(() => {
      if (failure) throw failure
      observe(() => ({ stage: LogStage.beforeLogOperation, owner: 'store', operation }))
      try {
        const result = task()
        observe(() => ({ stage: LogStage.afterLogOperation, owner: 'store', operation }))
        return result
      } catch (error) {
        const coded = logStorageFailure(error)
        observe(() => ({ stage: LogStage.onLogOperationError, owner: 'store', operation }))
        throw coded
      }
    })
  }
  /** Native writes stop the instance after failure, including uncertain COMMIT results. */
  const write = (task: () => void): void => {
    try {
      task()
    } catch (error) {
      failure = logStorageFailure(error)
      throw failure
    }
  }
  /** Public read results never reveal an index-owned payload. */
  const copy = (row: ILogRecord): ILogRecord => ({
    seq: row.seq,
    time: row.time,
    kind: row.kind,
    payload: snapshotPayload(row.payload)
  })
  const store: ILogStore = {
    append: (input) => {
      let captured: readonly { readonly kind: string; readonly payload: ILogPayload }[]
      try {
        admit()
        captured = snapshotRecords(input)
      } catch (error) {
        return Promise.reject(error)
      }
      return run(LogOperation.append, () => {
        if (captured.length === 0) return []
        if (!Number.isSafeInteger(last + captured.length))
          throw createLoggerError(LoggerErrorCode.logSequenceExhausted, DurableText.exhausted)
        const stamp = Math.max(time, Date.now())
        const batch = captured.map((row, index) => ({ seq: last + index + 1, time: stamp, ...row }))
        write(() => persistence?.append(batch, last + batch.length, stamp))
        for (const row of batch) {
          records.set(row.seq, { ...row, state: LogRecordState.pending })
          addPending(row.seq)
        }
        last += batch.length
        time = stamp
        if (appended.size > 0) {
          const notice = Object.freeze({ lastSeq: last, count: batch.length })
          invokeEachLive(appended, notice, (invocation) =>
            observeResult(() => invocation.invoke(), report)
          )
        }
        observe(() => ({
          stage: LogStage.onAppend,
          owner: 'store',
          operation: LogOperation.append,
          seq: last,
          count: batch.length
        }))
        return batch.map((row) => row.seq)
      })
    },
    read: (fromSeq, limit) => {
      try {
        requireInteger(fromSeq)
        requireInteger(limit, 0)
      } catch (error) {
        return Promise.reject(error)
      }
      return run(LogOperation.read, () => {
        const result: ILogRecord[] = []
        for (let seq = Math.max(fromSeq, floor); seq <= last && result.length < limit; seq++) {
          const row = records.get(seq)
          if (row) result.push(copy(row))
        }
        return result
      })
    },
    lastSeq: () => run(LogOperation.lastSeq, () => last),
    onAppend: (listener) => {
      admit()
      if (typeof listener !== 'function')
        throw createLoggerTypeError(LoggerErrorCode.invalidOption, DurableText.invalidOption)
      return appended.subscribe((event) => listener(event.value))
    },
    truncate: (beforeSeq) => {
      try {
        requireInteger(beforeSeq)
      } catch (error) {
        return Promise.reject(error)
      }
      return run(LogOperation.truncate, () => {
        if (beforeSeq > last + 1)
          throw tagLoggerError(
            new RangeError(DurableText.invalidOption),
            LoggerErrorCode.invalidOption
          )
        if (beforeSeq <= floor) return
        write(() => persistence?.truncate(beforeSeq))
        for (let seq = floor; seq < beforeSeq; seq++) {
          records.delete(seq)
          removePending(seq)
        }
        floor = beforeSeq
      })
    },
    setState: (seq, state) => {
      try {
        requireInteger(seq)
        if (!Object.values(LogRecordState).includes(state))
          throw createLoggerTypeError(LoggerErrorCode.invalidOption, DurableText.invalidOption)
      } catch (error) {
        return Promise.reject(error)
      }
      return run(LogOperation.setState, () => {
        const row = records.get(seq)
        if (!row || row.state !== LogRecordState.pending)
          throw createLoggerError(LoggerErrorCode.walRecordInvalid, DurableText.walInvalid)
        if (state === LogRecordState.pending) return
        write(() => persistence?.setState(seq, state))
        row.state = state
        removePending(seq)
      })
    },
    states: (filter) => {
      if (filter !== LogRecordState.pending)
        return Promise.reject(
          createLoggerTypeError(LoggerErrorCode.invalidOption, DurableText.invalidOption)
        )
      return run(LogOperation.states, () => {
        const result: number[] = []
        for (let node = head; node; node = node.next) result.push(node.seq)
        return result
      })
    },
    dispose: () => {
      if (disposePromise) return disposePromise
      /** Publish completion before observations can synchronously reenter disposal. */
      const completion = deferred<void>()
      disposePromise = completion.promise
      accepting = false
      observe(() => ({
        stage: LogStage.beforeLogClose,
        owner: 'store',
        operation: LogOperation.close
      }))
      void (async () => {
        await limiter.whenIdle()
        limiter.close()
        appended.clear()
        records.clear()
        pending.clear()
        head = undefined
        tail = undefined
        try {
          persistence?.close()
          observe(() => ({
            stage: LogStage.afterLogClose,
            owner: 'store',
            operation: LogOperation.close
          }))
        } catch (error) {
          observe(() => ({
            stage: LogStage.onLogCloseError,
            owner: 'store',
            operation: LogOperation.close
          }))
          throw logStorageFailure(error)
        }
      })().then(completion.resolve, completion.reject)
      return disposePromise
    },
    [asyncDisposeKey]: () => {
      if (symbolPromise) return symbolPromise
      /** The derived completion also exists before explicit disposal can invoke observers. */
      const completion = deferred<void>()
      symbolPromise = completion.promise
      void store.dispose().then(completion.resolve, (error) => {
        report(error)
        completion.resolve()
      })
      return symbolPromise
    }
  } as ILogStore
  return store
}
/** Creates a process-local atomic log resource; no physical durability is implied. */
export function memoryLogStore(options: ILogStoreOptions = {}): ILogStore {
  return createLogStore(options)
}
