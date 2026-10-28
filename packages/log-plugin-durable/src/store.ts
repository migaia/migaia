import { DurableErrorField } from './errors.ts'
import { createConcurrencyLimiter, deferred } from '@migaia/utils/promise'
import { asyncDisposeKey } from '@migaia/plugin-host'
import { createEventChannel, invokeEachLive } from '@migaia/event-subscriber'
import {
  createDurableError,
  createDurableTypeError,
  LogDurableErrorCode,
  ERROR_SOURCE
} from './errors.ts'
import { snapshotLogRecords } from './snapshot.ts'
import {
  createObservation,
  durableReporter,
  observeResult,
  captureStoreOptions
} from './observation.ts'
import { DurableKind, LogOperation, LogRecordState, LogStage } from './state-constants.ts'
import { DurableText } from './error-text.ts'
import {
  createOwnedLogStoreIndex,
  prepareLogAppend,
  assertLogInteger,
  type ILogStoreSnapshot,
  type ILogStoreIndex
} from './committed-index.ts'
import type {
  ILogAppendNotice,
  ILogRecord,
  ILogRecordInput,
  ILogStore,
  ILogStoreOptions
} from './types.ts'

/** Native adapters persist once before the common in-memory indexes change. */
export type ILogStorePersistence = {
  append(records: readonly ILogRecord[], lastSeq: number, time: number): void
  truncate(beforeSeq: number): void
  setState(seq: number, state: LogRecordState): void
  close(): void
}

/** Retain known durable errors; raw native failures stay reachable through their exact cause. */
export function logStorageFailure(error: unknown): Error {
  if (
    error instanceof Error &&
    Object.getOwnPropertyDescriptor(error, DurableErrorField.source)?.value === ERROR_SOURCE
  )
    return error
  return createDurableError(LogDurableErrorCode.logStoreIoFailed, DurableText.ioFailed, {
    cause: error
  })
}

/** One resource owns FIFO admission, committed indexes, notifications and terminal cleanup. */
class DurableLogStore implements ILogStore {
  /** The shared utility limiter serializes accepted operations without a second queue. */
  readonly #limiter = createConcurrencyLimiter({ concurrency: 1 })
  /** Only a successful native commit mutates this original data-only index. */
  readonly #index: ILogStoreIndex
  /** The resource alone receives the index cleanup receipt. */
  readonly #clear: () => void
  /** Optional native persistence is borrowed until this resource closes it. */
  readonly #persistence: ILogStorePersistence | undefined
  /** Disposal revokes admission immediately while accepted FIFO work drains. */
  #accepting = true
  /** An uncertain native write stops all later operations on this instance. */
  #failure: Error | undefined
  /** Explicit disposal has one stable success or rejection Promise. */
  #disposePromise: Promise<void> | undefined
  /** Symbolic disposal has a distinct stable, always fulfilled Promise. */
  #symbolPromise: Promise<void> | undefined
  /** Observer diagnostics cannot roll back a successful commit. */
  readonly #report: ReturnType<typeof durableReporter>
  /** Immutable metadata observation stays separate from storage outcomes. */
  readonly #observe: ReturnType<typeof createObservation>
  /** The resource owns one canonical append channel across plugin reinstallations. */
  readonly #appended = createEventChannel<ILogAppendNotice, void>()

  /** Borrow native persistence and rebuild indexes from the admitted committed snapshot. */
  constructor(
    options: ILogStoreOptions,
    snapshot: ILogStoreSnapshot,
    persistence?: ILogStorePersistence
  ) {
    const { index, clear } = createOwnedLogStoreIndex(snapshot)
    this.#index = index
    this.#clear = clear
    this.#persistence = persistence
    this.#report = durableReporter(options.report)
    this.#observe = createObservation(options, this.#report)
  }
  /** Own callable fields preserve method extraction and the original object-spread surface. */
  readonly append: ILogStore['append'] = (input) => this.#append(input)
  /** Public reads validate before entering the original FIFO. */
  readonly read: ILogStore['read'] = (fromSeq, limit) => this.#read(fromSeq, limit)
  /** Read the committed high watermark in FIFO order. */
  readonly lastSeq: ILogStore['lastSeq'] = () => this.#run(LogOperation.lastSeq, this.#readLastSeq)
  /** Append listener registration belongs to this resource rather than a borrowing plugin. */
  readonly onAppend: ILogStore['onAppend'] = (listener) => this.#subscribe(listener)
  /** Persist a prefix truncation before changing retained memory. */
  readonly truncate: ILogStore['truncate'] = (beforeSeq) => this.#truncate(beforeSeq)
  /** Persist a legal pending-to-terminal transition before publishing it in memory. */
  readonly setState: ILogStore['setState'] = (seq, state) => this.#setState(seq, state)
  /** Only the original pending filter is supported. */
  readonly states: ILogStore['states'] = (filter) => this.#states(filter)
  /** Explicit disposal preserves its original rejection semantics and Promise identity. */
  readonly dispose: ILogStore['dispose'] = () => this.#dispose()
  /** Symbolic disposal observes a cleanup failure once and still fulfills. */
  readonly [asyncDisposeKey] = (): Promise<void> => this.#disposeSymbol()

  /** Admission occurs before enqueue, and accepted work never rechecks later close admission. */
  #admit(): void {
    if (this.#failure) throw this.#failure
    if (!this.#accepting)
      throw createDurableError(LogDurableErrorCode.runtimeShuttingDown, DurableText.closed)
  }
  /** Accepted callbacks reuse the existing concurrency limiter. */
  #run<T>(operation: string, task: () => T): Promise<T> {
    try {
      this.#admit()
    } catch (error) {
      return Promise.reject(error)
    }
    return this.#limiter.run(() => this.#runAccepted(operation, task))
  }
  /** Execute once, preserving the old observation order and original storage rejection. */
  #runAccepted<T>(operation: string, task: () => T): T {
    if (this.#failure) throw this.#failure
    this.#observe(() => ({
      stage: LogStage.beforeLogOperation,
      owner: DurableKind.store,
      operation
    }))
    try {
      /** The callback performs the one admitted operation without receiving another owner. */
      const result = task()
      this.#observe(() => ({
        stage: LogStage.afterLogOperation,
        owner: DurableKind.store,
        operation
      }))
      return result
    } catch (error) {
      /** Identity is standardized once without hiding native causes. */
      const coded = logStorageFailure(error)
      this.#observe(() => ({
        stage: LogStage.onLogOperationError,
        owner: DurableKind.store,
        operation
      }))
      throw coded
    }
  }
  /** A native write failure poisons only this resource, including an uncertain COMMIT. */
  #write(task: () => void): void {
    try {
      task()
    } catch (error) {
      this.#failure = logStorageFailure(error)
      throw this.#failure
    }
  }
  /** Capture the entire JSON batch before any task is admitted. */
  #append(input: readonly ILogRecordInput[]): Promise<readonly number[]> {
    /** Captured records detach caller containers before a FIFO wait. */
    let captured: ReturnType<typeof snapshotLogRecords>
    try {
      this.#admit()
      captured = snapshotLogRecords(input)
    } catch (error) {
      return Promise.reject(error)
    }
    return this.#run(LogOperation.append, () => this.#appendCaptured(captured))
  }
  /** Native success precedes index changes and one frozen append notice. */
  #appendCaptured(captured: ReturnType<typeof snapshotLogRecords>): readonly number[] {
    if (captured.length === 0) return []
    /** Preparation assigns one monotonic sequence/time batch without changing memory yet. */
    const batch = prepareLogAppend(captured, this.#index)
    this.#write(() =>
      this.#persistence?.append(batch, batch[batch.length - 1]!.seq, batch[batch.length - 1]!.time)
    )
    this.#index.applyAppend(batch)
    if (this.#appended.size > 0) {
      /** One immutable notice describes the whole nonempty committed batch. */
      const notice = Object.freeze({ lastSeq: this.#index.lastSeq, count: batch.length })
      invokeEachLive(this.#appended, notice, (invocation) => this.#deliverNotice(invocation))
    }
    this.#observe(() => ({
      stage: LogStage.onAppend,
      owner: DurableKind.store,
      operation: LogOperation.append,
      seq: this.#index.lastSeq,
      count: batch.length
    }))
    return batch.map(recordSequence)
  }
  /** Subscriber invocation retains the channel's original receiver and failure observation. */
  #deliverNotice(invocation: { invoke(): unknown }): void {
    observeResult(() => invocation.invoke(), this.#report)
  }
  /** Validate inclusive numeric bounds before borrowing a committed read. */
  #read(fromSeq: number, limit: number): Promise<readonly ILogRecord[]> {
    try {
      assertLogInteger(fromSeq)
      assertLogInteger(limit, 0)
    } catch (error) {
      return Promise.reject(error)
    }
    return this.#run(LogOperation.read, () => this.#index.read(fromSeq, limit))
  }
  /** The stable task reads the current committed watermark when its FIFO turn executes. */
  readonly #readLastSeq = (): number => this.#index.lastSeq
  /** Subscribe once to the existing event-subscriber owner. */
  #subscribe(listener: (notice: ILogAppendNotice) => void): () => void {
    this.#admit()
    if (typeof listener !== 'function')
      throw createDurableTypeError(LogDurableErrorCode.invalidOption, DurableText.invalidOption)
    return this.#appended.subscribe((event) => listener(event.value))
  }
  /** Admission validation occurs before the original persistence/index sequence. */
  #truncate(beforeSeq: number): Promise<void> {
    try {
      assertLogInteger(beforeSeq)
    } catch (error) {
      return Promise.reject(error)
    }
    return this.#run(LogOperation.truncate, () => this.#truncateAccepted(beforeSeq))
  }
  /** No-op truncations do not perform native writes or mutate the high watermark. */
  #truncateAccepted(beforeSeq: number): void {
    if (!this.#index.checkTruncate(beforeSeq)) return
    this.#write(() => this.#persistence?.truncate(beforeSeq))
    this.#index.applyTruncate(beforeSeq)
  }
  /** Preserve the original fixed pending/done/aborted admission domain. */
  #setState(seq: number, state: LogRecordState): Promise<void> {
    try {
      assertLogInteger(seq)
      // The domain has exactly three compile-time keys in LogRecordState.
      if (!Object.values(LogRecordState).includes(state))
        throw createDurableTypeError(LogDurableErrorCode.invalidOption, DurableText.invalidOption)
    } catch (error) {
      return Promise.reject(error)
    }
    return this.#run(LogOperation.setState, () => this.#setStateAccepted(seq, state))
  }
  /** Terminal transitions only change memory after their one successful native commit. */
  #setStateAccepted(seq: number, state: LogRecordState): void {
    if (!this.#index.checkState(seq, state)) return
    this.#write(() => this.#persistence?.setState(seq, state))
    this.#index.applyState(seq, state)
  }
  /** Unsupported filters reject instead of silently widening the original query. */
  #states(filter: typeof LogRecordState.pending): Promise<readonly number[]> {
    if (filter !== LogRecordState.pending)
      return Promise.reject(
        createDurableTypeError(LogDurableErrorCode.invalidOption, DurableText.invalidOption)
      )
    return this.#run(LogOperation.states, this.#index.pending)
  }
  /** Publish the explicit Promise before close observation can synchronously reenter. */
  #dispose(): Promise<void> {
    if (this.#disposePromise) return this.#disposePromise
    /** This exact completion is shared by every explicit close caller. */
    const completion = deferred<void>()
    this.#disposePromise = completion.promise
    this.#accepting = false
    this.#observe(() => ({
      stage: LogStage.beforeLogClose,
      owner: DurableKind.store,
      operation: LogOperation.close
    }))
    void this.#close().then(completion.resolve, completion.reject)
    return this.#disposePromise
  }
  /** Drain accepted work, release the channel/index, and close native persistence once. */
  async #close(): Promise<void> {
    await this.#limiter.whenIdle()
    this.#limiter.close()
    this.#appended.clear()
    this.#clear()
    try {
      this.#persistence?.close()
      this.#observe(() => ({
        stage: LogStage.afterLogClose,
        owner: DurableKind.store,
        operation: LogOperation.close
      }))
    } catch (error) {
      this.#observe(() => ({
        stage: LogStage.onLogCloseError,
        owner: DurableKind.store,
        operation: LogOperation.close
      }))
      throw logStorageFailure(error)
    }
  }
  /** Symbolic completion is distinct and published before explicit close invokes observers. */
  #disposeSymbol(): Promise<void> {
    if (this.#symbolPromise) return this.#symbolPromise
    /** A symbolic cleanup failure is reported once while its own Promise fulfills. */
    const completion = deferred<void>()
    this.#symbolPromise = completion.promise
    void this.dispose().then(completion.resolve, (error) => this.#finishSymbol(error, completion))
    return this.#symbolPromise
  }
  /** Report the explicit failure without replacing its Promise or original cause. */
  #finishSymbol(error: unknown, completion: ReturnType<typeof deferred<void>>): void {
    this.#report(error)
    completion.resolve()
  }
}

/** Return the existing sequence projection without allocating a closure per append. */
function recordSequence(row: ILogRecord): number {
  return row.seq
}

/** Construct the canonical store owner for memory or an existing native adapter. */
export function createLogStore(
  options: ILogStoreOptions = {},
  snapshot: ILogStoreSnapshot = { lastSeq: 0, time: 0, floor: 1, records: [] },
  persistence?: ILogStorePersistence
): ILogStore {
  return new DurableLogStore(options, snapshot, persistence)
}

/** Create a process-local atomic resource; physical durability belongs to native adapters. */
export function memoryLogStore(options: ILogStoreOptions = {}): ILogStore {
  /** Options are captured before the first resource observation or side effect. */
  const captured = captureStoreOptions(options)
  /** Standalone observations use the same host-owned default reporter. */
  const observe = createObservation(captured, durableReporter(captured.report))
  observe(() => ({
    stage: LogStage.beforeLogOpen,
    owner: DurableKind.store,
    operation: LogOperation.open
  }))
  /** The creator owns disposal; borrowing plugins never acquire that authority. */
  const store = createLogStore(captured)
  observe(() => ({
    stage: LogStage.afterLogOpen,
    owner: DurableKind.store,
    operation: LogOperation.open
  }))
  return store
}
