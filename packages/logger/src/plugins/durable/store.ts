import { createConcurrencyLimiter, deferred } from '@migaia/utils/promise'
import { asyncDisposeKey } from '@migaia/plugin-host'
import { createEventChannel, invokeEachLive } from '@migaia/event-subscriber'
import {
  createLoggerError,
  createLoggerTypeError,
  LoggerErrorCode,
  LOGGER_SOURCE
} from '../../errors.js'
import { snapshotLogRecords } from './snapshot.js'
import {
  createObservation,
  durableReporter,
  observeResult,
  captureStoreOptions
} from './observation.js'
import { DurableKind, LogOperation, LogRecordState, LogStage } from './state-constants.js'
import { DurableText } from './text.js'
import {
  createOwnedLogStoreIndex,
  prepareLogAppend,
  assertLogInteger,
  type ILogStoreSnapshot
} from './committed-index.js'
import type { ILogAppendNotice, ILogRecord, ILogStore, ILogStoreOptions } from './types.js'

/** Durable adapters commit once before the common in-memory indexes change. */
export type ILogStorePersistence = {
  append(records: readonly ILogRecord[], lastSeq: number, time: number): void
  truncate(beforeSeq: number): void
  setState(seq: number, state: LogRecordState): void
  close(): void
}
/** Standardizes raw I/O failures while retaining known logger errors and native cause identity. */
export function logStorageFailure(error: unknown): Error {
  if (
    error instanceof Error &&
    Object.getOwnPropertyDescriptor(error, 'source')?.value === LOGGER_SOURCE
  )
    return error
  return createLoggerError(LoggerErrorCode.logStoreIoFailed, DurableText.ioFailed, { cause: error })
}
/** One canonical resource implementation owns serialization, indexes, notifications, and closing. */
export function createLogStore(
  options: ILogStoreOptions = {},
  snapshot: ILogStoreSnapshot = { lastSeq: 0, time: 0, floor: 1, records: [] },
  persistence?: ILogStorePersistence
): ILogStore {
  /** All ordinary operations use the existing FIFO limiter. */
  const limiter = createConcurrencyLimiter({ concurrency: 1 })
  /** One original committed index is shared with asynchronous native adapters. */
  const { index, clear } = createOwnedLogStoreIndex(snapshot)
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
      observe(() => ({ stage: LogStage.beforeLogOperation, owner: DurableKind.store, operation }))
      try {
        const result = task()
        observe(() => ({ stage: LogStage.afterLogOperation, owner: DurableKind.store, operation }))
        return result
      } catch (error) {
        const coded = logStorageFailure(error)
        observe(() => ({
          stage: LogStage.onLogOperationError,
          owner: DurableKind.store,
          operation
        }))
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
  const store: ILogStore = {
    append: (input) => {
      let captured: ReturnType<typeof snapshotLogRecords>
      try {
        admit()
        captured = snapshotLogRecords(input)
      } catch (error) {
        return Promise.reject(error)
      }
      return run(LogOperation.append, () => {
        if (captured.length === 0) return []
        const batch = prepareLogAppend(captured, index)
        write(() =>
          persistence?.append(batch, batch[batch.length - 1]!.seq, batch[batch.length - 1]!.time)
        )
        index.applyAppend(batch)
        if (appended.size > 0) {
          const notice = Object.freeze({ lastSeq: index.lastSeq, count: batch.length })
          invokeEachLive(appended, notice, (invocation) =>
            observeResult(() => invocation.invoke(), report)
          )
        }
        observe(() => ({
          stage: LogStage.onAppend,
          owner: DurableKind.store,
          operation: LogOperation.append,
          seq: index.lastSeq,
          count: batch.length
        }))
        return batch.map((row) => row.seq)
      })
    },
    read: (fromSeq, limit) => {
      try {
        assertLogInteger(fromSeq)
        assertLogInteger(limit, 0)
      } catch (error) {
        return Promise.reject(error)
      }
      return run(LogOperation.read, () => index.read(fromSeq, limit))
    },
    lastSeq: () => run(LogOperation.lastSeq, () => index.lastSeq),
    onAppend: (listener) => {
      admit()
      if (typeof listener !== 'function')
        throw createLoggerTypeError(LoggerErrorCode.invalidOption, DurableText.invalidOption)
      return appended.subscribe((event) => listener(event.value))
    },
    truncate: (beforeSeq) => {
      try {
        assertLogInteger(beforeSeq)
      } catch (error) {
        return Promise.reject(error)
      }
      return run(LogOperation.truncate, () => {
        if (!index.checkTruncate(beforeSeq)) return
        write(() => persistence?.truncate(beforeSeq))
        index.applyTruncate(beforeSeq)
      })
    },
    setState: (seq, state) => {
      try {
        assertLogInteger(seq)
        if (!Object.values(LogRecordState).includes(state))
          throw createLoggerTypeError(LoggerErrorCode.invalidOption, DurableText.invalidOption)
      } catch (error) {
        return Promise.reject(error)
      }
      return run(LogOperation.setState, () => {
        if (!index.checkState(seq, state)) return
        write(() => persistence?.setState(seq, state))
        index.applyState(seq, state)
      })
    },
    states: (filter) => {
      if (filter !== LogRecordState.pending)
        return Promise.reject(
          createLoggerTypeError(LoggerErrorCode.invalidOption, DurableText.invalidOption)
        )
      return run(LogOperation.states, () => index.pending())
    },
    dispose: () => {
      if (disposePromise) return disposePromise
      /** Publish completion before observations can synchronously reenter disposal. */
      const completion = deferred<void>()
      disposePromise = completion.promise
      accepting = false
      observe(() => ({
        stage: LogStage.beforeLogClose,
        owner: DurableKind.store,
        operation: LogOperation.close
      }))
      void (async () => {
        await limiter.whenIdle()
        limiter.close()
        appended.clear()
        clear()
        try {
          persistence?.close()
          observe(() => ({
            stage: LogStage.afterLogClose,
            owner: DurableKind.store,
            operation: LogOperation.close
          }))
        } catch (error) {
          observe(() => ({
            stage: LogStage.onLogCloseError,
            owner: DurableKind.store,
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
  const captured = captureStoreOptions(options)
  const observe = createObservation(captured, durableReporter(captured.report))
  observe(() => ({
    stage: LogStage.beforeLogOpen,
    owner: DurableKind.store,
    operation: LogOperation.open
  }))
  const store = createLogStore(captured)
  observe(() => ({
    stage: LogStage.afterLogOpen,
    owner: DurableKind.store,
    operation: LogOperation.open
  }))
  return store
}
