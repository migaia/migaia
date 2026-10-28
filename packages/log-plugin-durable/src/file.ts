import { DurableErrorField } from './errors.ts'
import { detectServerRuntime } from '@migaia/utils'
import { createDurableError, LogDurableErrorCode, ERROR_SOURCE } from './errors.ts'
import { createLogStore, type ILogStorePersistence } from './store.ts'
import {
  snapshotLogStoreState,
  type ILogStoreSnapshot,
  type ILogStoreRecoveryRow
} from './committed-index.ts'
import { requireText } from './snapshot.ts'
import { createObservation, durableReporter, captureStoreOptions } from './observation.ts'
import { DurableKind, LogOperation, LogRecordState, LogStage } from './state-constants.ts'
import { LogSql, LogSqliteModule } from './sql.ts'
import { DurableText } from './error-text.ts'
import type { ILogRecord, ILogStore, ILogStoreOptions } from './types.ts'

/** Minimal actual SQLite statement surface shared by Node/Deno and Bun. */
type IStatement = {
  all(...values: unknown[]): unknown[]
  run(...values: unknown[]): unknown
  finalize?(): void
}
/** The creator alone owns connection cleanup and its original statement order. */
type IDatabase = { exec(sql: string): void; prepare(sql: string): IStatement; close(): void }
/** Runtime-selected constructors remain structural and keep builtins lazy. */
type ISqliteBuiltin = {
  DatabaseSync?: new (path: string) => IDatabase
  Database?: new (path: string) => IDatabase
}

/** Driver failures retain their exact native cause under the unchanged durable semantic code. */
function sqliteFailure(error: unknown): Error {
  /** SQLite exposes equivalent native diagnostics under runtime-specific fields. */
  const row = error as { code?: unknown; errcode?: unknown; message?: unknown } | null
  /** Code and message inspection preserve the original classification order. */
  const code = typeof row?.code === 'string' ? row.code : ''
  /** Native message fallback remains necessary for engines without a string code. */
  const message = typeof row?.message === 'string' ? row.message : ''
  /** Lock ownership rejects reopening instead of silently weakening durability. */
  const locked =
    code.includes('BUSY') ||
    code.includes('LOCKED') ||
    row?.errcode === 5 ||
    row?.errcode === 6 ||
    message.includes('database is locked')
  /** Corrupt committed bytes remain distinct from a general native I/O failure. */
  const corrupt =
    code.includes('CORRUPT') ||
    code.includes('NOTADB') ||
    row?.errcode === 11 ||
    row?.errcode === 26 ||
    message.includes('not a database') ||
    message.includes('malformed')
  return createDurableError(
    locked
      ? LogDurableErrorCode.logStoreLocked
      : corrupt
        ? LogDurableErrorCode.logStoreCorrupt
        : LogDurableErrorCode.logStoreIoFailed,
    locked ? DurableText.locked : corrupt ? DurableText.corrupt : DurableText.ioFailed,
    { cause: error }
  )
}

/** Row I/O stays lazy so committed-head validation precedes any record query. */
function* recoveryRows(database: IDatabase): IterableIterator<ILogStoreRecoveryRow> {
  try {
    yield* database.prepare(LogSql.records).all() as ILogStoreRecoveryRow[]
  } catch (error) {
    throw sqliteFailure(error)
  }
}
/** The stored JSON codec changes no record envelope or payload representation. */
function decodePayload(payload: unknown): unknown {
  return JSON.parse(payload as string)
}
/** Validate committed metadata and actual rows before exposing a reopened resource. */
function recover(database: IDatabase): ILogStoreSnapshot {
  /** The retained head is queried before any lazy row iteration begins. */
  const meta = database.prepare(LogSql.meta).all()[0] as
    | { last_seq: number; time: number; floor: number }
    | undefined
  if (!meta) throw createDurableError(LogDurableErrorCode.logStoreCorrupt, DurableText.corrupt)
  return snapshotLogStoreState(
    { lastSeq: meta.last_seq, time: meta.time, floor: meta.floor },
    recoveryRows(database),
    decodePayload
  )
}

/** One connection owner finalizes original statements in reverse acquisition order. */
class OwnedDatabase implements IDatabase {
  /** The native connection is never replaced by a parallel persistence implementation. */
  readonly #native: IDatabase
  /** All actual builtin statements remain owned until connection close. */
  readonly #statements: IStatement[] = []
  /** Borrow the newly created native connection exactly once. */
  constructor(native: IDatabase) {
    this.#native = native
  }
  /** Execute the existing SQL contract on the original native receiver. */
  exec(sql: string): void {
    this.#native.exec(sql)
  }
  /** Retain each successfully acquired statement for deterministic reverse cleanup. */
  prepare(sql: string): IStatement {
    /** A failed native prepare never creates a phantom acquired statement. */
    const statement = this.#native.prepare(sql)
    this.#statements.push(statement)
    return statement
  }
  /** Attempt every statement finalizer and native close, preserving original primary order. */
  close(): void {
    /** Original cleanup failures remain independently reachable when more than one fails. */
    const errors: unknown[] = []
    for (let index = this.#statements.length - 1; index >= 0; index--) {
      try {
        this.#statements[index]!.finalize?.()
      } catch (error) {
        errors.push(error)
      }
    }
    this.#statements.length = 0
    try {
      this.#native.close()
    } catch (error) {
      errors.push(error)
    }
    if (errors.length === 1) throw errors[0]
    if (errors.length > 1)
      throw new AggregateError(errors, DurableText.ioFailed, { cause: errors[0] })
  }
}

/** The native connection remains the single owner of durable atomic writes. */
class FilePersistence implements ILogStorePersistence {
  /** Every SQL statement and native lock belongs to this exact opened connection. */
  readonly #connection: IDatabase
  /** Cleanup diagnostics cannot replace the primary native storage error. */
  readonly #report: (error: unknown) => void
  /** Existing append SQL persists records before the metadata head. */
  readonly #insert: IStatement
  /** The committed head changes within the same original transaction. */
  readonly #metadata: IStatement
  /** Truncation deletes the existing prefix before advancing its retained floor. */
  readonly #remove: IStatement
  /** The persistent retained floor survives complete truncation and reopening. */
  readonly #floor: IStatement
  /** Terminal record transitions keep the pre-existing storage representation. */
  readonly #state: IStatement
  /** Prepare the same five statements in their original acquisition order. */
  constructor(connection: IDatabase, report: (error: unknown) => void) {
    this.#connection = connection
    this.#report = report
    this.#insert = connection.prepare(LogSql.append)
    this.#metadata = connection.prepare(LogSql.appendMeta)
    this.#remove = connection.prepare(LogSql.truncate)
    this.#floor = connection.prepare(LogSql.floor)
    this.#state = connection.prepare(LogSql.state)
  }
  /** One transaction commits the complete batch and its head exactly once. */
  append(records: readonly ILogRecord[], lastSeq: number, time: number): void {
    this.#transaction(() => this.#appendRows(records, lastSeq, time))
  }
  /** Persist one entire retained-prefix change before the common memory index changes. */
  truncate(beforeSeq: number): void {
    this.#transaction(() => this.#truncateRows(beforeSeq))
  }
  /** The caller already validated the original pending-to-terminal transition. */
  setState(seq: number, next: LogRecordState): void {
    this.#transaction(() => this.#state.run(next, seq))
  }
  /** Native cleanup preserves its original driver classification and cause graph. */
  close(): void {
    try {
      this.#connection.close()
    } catch (error) {
      throw sqliteFailure(error)
    }
  }
  /** Execute unchanged SQL against the original prepared receivers. */
  #appendRows(records: readonly ILogRecord[], lastSeq: number, time: number): void {
    for (const row of records)
      this.#insert.run(
        row.seq,
        row.time,
        row.kind,
        JSON.stringify(row.payload),
        LogRecordState.pending
      )
    this.#metadata.run(lastSeq, time)
  }
  /** Prefix deletion and its floor update stay inside one original native transaction. */
  #truncateRows(beforeSeq: number): void {
    this.#remove.run(beforeSeq)
    this.#floor.run(beforeSeq)
  }
  /** A failed COMMIT stays uncertain; it is never replayed or replaced by a rollback error. */
  #transaction(effect: () => void): void {
    /** Only pre-COMMIT failures permit the original rollback attempt. */
    let committing = false
    try {
      this.#connection.exec(LogSql.begin)
      effect()
      committing = true
      this.#connection.exec(LogSql.commit)
    } catch (error) {
      if (!committing) {
        try {
          this.#connection.exec(LogSql.rollback)
        } catch (cleanup) {
          this.#report(sqliteFailure(cleanup))
        }
      }
      throw sqliteFailure(error)
    }
  }
}

/** Open one SQLite file with a retained native lock before recovering committed records. */
export async function fileLogStore(
  path: string,
  options: ILogStoreOptions = {}
): Promise<ILogStore> {
  requireText(path)
  options = captureStoreOptions(options)
  /** Standalone store diagnostics borrow the host's sole default reporter. */
  const report = durableReporter(options.report)
  /** Resource observations remain metadata-only and cannot change transaction outcomes. */
  const observe = createObservation(options, report)
  observe(() => ({
    stage: LogStage.beforeLogOpen,
    owner: DurableKind.store,
    operation: LogOperation.open
  }))
  /** Builtin selection retains existing Node/Deno and Bun carrier behavior. */
  const runtime = detectServerRuntime()
  /** Partial construction rollback closes only the actually acquired connection. */
  let database: IDatabase | undefined
  try {
    if (!runtime)
      throw createDurableError(LogDurableErrorCode.logStoreUnavailable, DurableText.unavailable)
    /** Bun uses its own SQLite module while Node and Deno use node:sqlite. */
    const moduleName = runtime === 'bun' ? LogSqliteModule.bun : LogSqliteModule.node
    /** The runtime builtin remains a lazy dependency outside browser entry imports. */
    let builtin: ISqliteBuiltin
    try {
      builtin = await import(moduleName)
    } catch (error) {
      throw createDurableError(LogDurableErrorCode.logStoreUnavailable, DurableText.unavailable, {
        cause: error
      })
    }
    /** Keep the existing runtime constructor choice and native connection semantics. */
    const Constructor = runtime === 'bun' ? builtin.Database : builtin.DatabaseSync
    if (!Constructor)
      throw createDurableError(LogDurableErrorCode.logStoreUnavailable, DurableText.unavailable)
    database = new OwnedDatabase(new Constructor(path))
    database.exec(LogSql.initialize)
    /** Recovery validates permanent watermarks before exposing any committed row. */
    const snapshot = recover(database)
    /** The common store changes memory only after this original persistence owner commits. */
    const store = createLogStore(options, snapshot, new FilePersistence(database, report))
    observe(() => ({
      stage: LogStage.afterLogOpen,
      owner: DurableKind.store,
      operation: LogOperation.open
    }))
    return store
  } catch (error) {
    /** Already coded durable failures retain identity while raw driver errors gain their cause. */
    const coded =
      error instanceof Error &&
      Object.getOwnPropertyDescriptor(error, DurableErrorField.source)?.value === ERROR_SOURCE
        ? error
        : sqliteFailure(error)
    if (database) {
      try {
        database.close()
      } catch (cleanup) {
        report(sqliteFailure(cleanup))
      }
    }
    observe(() => ({
      stage: LogStage.onLogOpenError,
      owner: DurableKind.store,
      operation: LogOperation.open
    }))
    throw coded
  }
}
