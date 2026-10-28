import { createDurableError, createDurableTypeError, LogDurableErrorCode } from './errors.ts'
import { assertLogInteger } from './committed-index.ts'
import { snapshotPayload, snapshotLogRecords } from './snapshot.ts'
import {
  captureDurableOptions,
  captureAppendPort,
  captureLimit,
  createDurableRuntime,
  type IDurableRuntime,
  type IDurableCore
} from './plugin-runtime.ts'
import { DurableKind, LogOperation, LogStage } from './state-constants.ts'
import { DurableText } from './error-text.ts'
import type {
  IBinlogExt,
  IBinlogOptions,
  IDurablePlugin,
  ILogAppendOptions,
  ILogRecord,
  ILogRecordInput
} from './types.ts'

/** One cursor has at most one in-flight listener, with no retained live-record queue. */
type ICursor = {
  nextSeq: number
  active: boolean
  running: boolean
  wake: boolean
  listener: (record: ILogRecord) => void | Promise<void>
}

/** One installed binlog owns cursors while borrowing the original atomic store. */
class BinlogController {
  /** Runtime owns canonical peer cleanup and FIFO accounting. */
  readonly #runtime: IDurableRuntime
  /** Metadata-only echo is fixed at cold construction. */
  readonly #echoEnabled: boolean
  /** Each subscriber advances independently after its own listener completes. */
  readonly #cursors = new Set<ICursor>()
  /** One source notice wakes every cursor without copying record data. */
  #offSource: (() => void) | undefined
  /** Public methods keep their original extraction-safe callable identities. */
  readonly api: IBinlogExt['binlog']

  /** Register cursor cleanup on the same installation that borrowed the store. */
  constructor(core: IDurableCore, options: IBinlogOptions) {
    this.#runtime = createDurableRuntime(core, options, DurableKind.binlog)
    this.#echoEnabled = options.echo ?? false
    this.#runtime.cleanups.add(this.#clearCursors)
    this.api = {
      ready: this.#runtime.ready,
      whenIdle: this.#runtime.whenIdle,
      append: (kind, payload, appendOptions) => this.#append(kind, payload, appendOptions),
      appendBatch: (records, appendOptions) => this.#appendBatch(records, appendOptions),
      read: (fromSeq, readOptions) => this.#read(fromSeq, readOptions),
      lastSeq: () => this.#runtime.run(LogOperation.lastSeq, this.#readLastSeq),
      truncate: (beforeSeq) => this.#truncate(beforeSeq),
      subscribe: (fromSeq, listener) => this.#subscribe(fromSeq, listener)
    }
  }
  /** Echo never leaks payloads and remains ordinary asynchronous host logging. */
  async #echo(seqs: readonly number[]): Promise<void> {
    if (!this.#echoEnabled || !this.#runtime.active()) return
    for (const seq of seqs) {
      /** Fetch only the committed row whose metadata is being echoed. */
      const row = (await this.#runtime.store.read(seq, 1))[0]
      if (row && this.#runtime.active())
        this.#runtime.core.dispatchRaw({
          tag: DurableKind.binlog,
          message: row.kind,
          meta: { seq: row.seq, time: row.time }
        })
    }
  }
  /** A native commit observes echo failure on the same original sink failure channel. */
  readonly #echoCommitted = (seqs: readonly number[]): void => {
    void this.#echo(seqs).catch(this.#runtime.report)
  }
  /** Stop one cursor and return its shared source registration after the last subscriber. */
  #cancel(cursor: ICursor): void {
    if (!cursor.active) return
    this.#runtime.observe(() => ({
      stage: LogStage.beforeLogOperation,
      owner: DurableKind.binlog,
      operation: LogOperation.cancel
    }))
    cursor.active = false
    this.#cursors.delete(cursor)
    if (this.#cursors.size === 0) {
      this.#offSource?.()
      this.#offSource = undefined
    }
    this.#runtime.observe(() => ({
      stage: LogStage.afterLogOperation,
      owner: DurableKind.binlog,
      operation: LogOperation.cancel
    }))
  }
  /** Listener completion advances only this cursor and never occupies the write FIFO. */
  async #pump(cursor: ICursor): Promise<void> {
    if (cursor.running || !cursor.active || !this.#runtime.active()) return
    cursor.running = true
    try {
      do {
        cursor.wake = false
        while (cursor.active && this.#runtime.active()) {
          /** Public store reads preserve the history/live handoff without a second record queue. */
          const rows = await this.#runtime.store.read(cursor.nextSeq, 1)
          if (!cursor.active || !this.#runtime.active()) break
          /** Missing or skipped retained positions distinguish truncation from an idle tail. */
          const row = rows[0]
          if (!row) {
            if ((await this.#runtime.store.lastSeq()) >= cursor.nextSeq)
              throw subscriptionTruncated()
            break
          }
          if (row.seq !== cursor.nextSeq) throw subscriptionTruncated()
          this.#runtime.observe(() => ({
            stage: LogStage.beforeLogOperation,
            owner: DurableKind.binlog,
            operation: LogOperation.deliver,
            seq: row.seq
          }))
          try {
            await cursor.listener({ ...row, payload: snapshotPayload(row.payload) })
          } catch (error) {
            this.#cancel(cursor)
            this.#runtime.reportHook(error)
            this.#runtime.observe(() => ({
              stage: LogStage.onLogOperationError,
              owner: DurableKind.binlog,
              operation: LogOperation.deliver
            }))
            return
          }
          this.#runtime.observe(() => ({
            stage: LogStage.afterLogOperation,
            owner: DurableKind.binlog,
            operation: LogOperation.deliver,
            seq: row.seq
          }))
          cursor.nextSeq = row.seq + 1
        }
      } while (cursor.wake && cursor.active && this.#runtime.active())
    } catch (error) {
      this.#cancel(cursor)
      this.#runtime.reportHook(error)
    } finally {
      cursor.running = false
    }
  }
  /** Installation revocation immediately stops every cursor and its one source subscription. */
  readonly #clearCursors = (): void => {
    for (const cursor of this.#cursors) cursor.active = false
    this.#cursors.clear()
    this.#offSource?.()
    this.#offSource = undefined
  }
  /** Capture one record and the transaction capability before queueing or invoking native work. */
  #append(kind: string, payload: unknown, options?: ILogAppendOptions): Promise<number> {
    /** Scalar admission preserves its direct rejected Promise before sequence projection. */
    let captured: ReturnType<typeof snapshotLogRecords>
    /** The original transaction capability is read after payload capture. */
    let port: ReturnType<typeof captureAppendPort>
    try {
      this.#runtime.admit()
      captured = snapshotLogRecords([{ kind, payload }])
      port = captureAppendPort(options)
    } catch (error) {
      return Promise.reject(error)
    }
    /** Scalar success alone adds the original first-sequence projection continuation. */
    const result = port
      ? this.#runtime.appendPort(port, captured, this.#echoCommitted)
      : this.#runtime.run(LogOperation.append, () => this.#appendOrdinary(captured))
    return result.then(firstSequence)
  }
  /** Batch calls keep the original transaction-port Promise or ordinary FIFO result. */
  #appendBatch(
    records: readonly ILogRecordInput[],
    options?: ILogAppendOptions
  ): Promise<readonly number[]> {
    /** Detach caller payloads synchronously before any deferred execution. */
    let captured: ReturnType<typeof snapshotLogRecords>
    /** The exact optional transaction authority is captured once before admission finishes. */
    let port: ReturnType<typeof captureAppendPort>
    try {
      this.#runtime.admit()
      captured = snapshotLogRecords(records)
      port = captureAppendPort(options)
    } catch (error) {
      return Promise.reject(error)
    }
    if (port) return this.#runtime.appendPort(port, captured, this.#echoCommitted)
    return this.#runtime.run(LogOperation.append, () => this.#appendOrdinary(captured))
  }
  /** Ordinary appends finish their commit and optional metadata echo before returning sequences. */
  async #appendOrdinary(
    captured: ReturnType<typeof snapshotLogRecords>
  ): Promise<readonly number[]> {
    /** A single actual append owns the complete atomic batch. */
    const seqs = await this.#runtime.store.append(captured)
    await this.#echo(seqs)
    return seqs
  }
  /** Preserve validation order before entering the original read FIFO. */
  #read(fromSeq: number, options?: { readonly limit?: number }): Promise<readonly ILogRecord[]> {
    /** Inclusive-zero limits keep the original empty-page behavior. */
    let limit: number
    try {
      assertLogInteger(fromSeq)
      limit = captureLimit(options)
    } catch (error) {
      return Promise.reject(error)
    }
    return this.#runtime.run(LogOperation.read, () => this.#runtime.store.read(fromSeq, limit))
  }
  /** A stable task reads the resource's current committed high watermark. */
  readonly #readLastSeq = (): Promise<number> => this.#runtime.store.lastSeq()
  /** Truncate only after public integer admission, then stop every overtaken cursor once. */
  #truncate(beforeSeq: number): Promise<void> {
    try {
      assertLogInteger(beforeSeq)
    } catch (error) {
      return Promise.reject(error)
    }
    return this.#runtime.run(LogOperation.truncate, () => this.#truncateAccepted(beforeSeq))
  }
  /** Resource truncation remains authoritative before subscriber failures are observed. */
  async #truncateAccepted(beforeSeq: number): Promise<void> {
    await this.#runtime.store.truncate(beforeSeq)
    for (const cursor of this.#cursors)
      if (cursor.nextSeq < beforeSeq) {
        this.#cancel(cursor)
        this.#runtime.reportHook(subscriptionTruncated())
      }
  }
  /** One accepted registration bridges history to live notices without duplicate records. */
  #subscribe(fromSeq: number, listener: ICursor['listener']): () => void {
    this.#runtime.admit()
    assertLogInteger(fromSeq)
    if (typeof listener !== 'function')
      throw createDurableTypeError(LogDurableErrorCode.invalidOption, DurableText.invalidOption)
    /** Each cursor retains only its own progress and one listener. */
    const cursor: ICursor = { nextSeq: fromSeq, active: true, running: false, wake: true, listener }
    void this.#runtime
      .run(LogOperation.subscribe, () => this.#registerCursor(cursor))
      .catch(() => markCursorStopped(cursor))
    return () => this.#cancel(cursor)
  }
  /** Source subscription precedes high-watermark inspection to avoid losing a live append. */
  async #registerCursor(cursor: ICursor): Promise<void> {
    if (!cursor.active || !this.#runtime.active()) return
    this.#cursors.add(cursor)
    if (!this.#offSource) this.#offSource = this.#runtime.store.onAppend(this.#wakeCursors)
    await this.#runtime.store.lastSeq()
    void this.#pump(cursor)
  }
  /** A metadata notice wakes every current cursor without copying the store's records. */
  readonly #wakeCursors = (): void => {
    for (const cursor of this.#cursors) {
      cursor.wake = true
      void this.#pump(cursor)
    }
  }
}

/** A scalar append returns its original first assigned sequence. */
function firstSequence(seqs: readonly number[]): number {
  return seqs[0]!
}
/** Failed registration has already been reported by its runtime boundary. */
function markCursorStopped(cursor: ICursor): void {
  cursor.active = false
}
/** Every cursor truncation uses one maintained durable error contract. */
function subscriptionTruncated(): Error {
  return createDurableError(LogDurableErrorCode.logSubscriptionTruncated, DurableText.truncated)
}

/** Add ordered history/live operations while borrowing the creator-owned atomic store. */
export function binlogPlugin(options: IBinlogOptions): IDurablePlugin<IBinlogExt> {
  /** Cold option capture precedes registration or resource acquisition. */
  const captured = captureDurableOptions(options)
  if (captured.echo !== undefined && typeof captured.echo !== 'boolean')
    throw createDurableTypeError(LogDurableErrorCode.invalidOption, DurableText.invalidOption)
  return {
    name: DurableKind.binlog,
    config: {},
    install: (core) => ({ binlog: new BinlogController(core, captured).api })
  }
}
