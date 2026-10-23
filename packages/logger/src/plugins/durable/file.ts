import { detectServerRuntime } from '@migaia/utils'
import { createLoggerError, LoggerErrorCode } from '../../errors.js'
import { createLogStore, type ILogStoreSnapshot } from './store.js'
import { requireText, snapshotPayload } from './snapshot.js'
import { createObservation, durableReporter } from './observation.js'
import { LogOperation, LogRecordState, LogStage } from './state-constants.js'
import { LogSql, LogSqliteModule } from './sql.js'
import { DurableText } from './text.js'
import type { ILogRecord, ILogStore, ILogStoreOptions } from './types.js'

/** Minimal actual builtin SQLite surface shared by Node/Deno and Bun. */
type IStatement = { all(...values: unknown[]): unknown[]; run(...values: unknown[]): unknown }
/** Connections are created here and released exactly once by this resource. */
type IDatabase = { exec(sql: string): void; prepare(sql: string): IStatement; close(): void }
/** Driver failures preserve native causes while exposing durable error semantics. */
function sqliteFailure(error: unknown): Error {
  const row = error as { code?: unknown; errcode?: unknown; message?: unknown } | null
  const code = typeof row?.code === 'string' ? row.code : ''
  const message = typeof row?.message === 'string' ? row.message : ''
  const locked =
    code.includes('BUSY') ||
    code.includes('LOCKED') ||
    row?.errcode === 5 ||
    row?.errcode === 6 ||
    message.includes('database is locked')
  const corrupt =
    code.includes('CORRUPT') ||
    code.includes('NOTADB') ||
    row?.errcode === 11 ||
    row?.errcode === 26 ||
    message.includes('not a database') ||
    message.includes('malformed')
  return createLoggerError(
    locked
      ? LoggerErrorCode.logStoreLocked
      : corrupt
        ? LoggerErrorCode.logStoreCorrupt
        : LoggerErrorCode.logStoreIoFailed,
    locked ? DurableText.locked : corrupt ? DurableText.corrupt : DurableText.ioFailed,
    { cause: error }
  )
}
/** Validates committed rows and watermarks before exposing a reopened resource. */
function recover(database: IDatabase): ILogStoreSnapshot {
  const fail = (): never => {
    throw createLoggerError(LoggerErrorCode.logStoreCorrupt, DurableText.corrupt)
  }
  const meta = database.prepare(LogSql.meta).all()[0] as
    | { last_seq: number; time: number; floor: number }
    | undefined
  if (
    !meta ||
    !Number.isSafeInteger(meta.last_seq) ||
    meta.last_seq < 0 ||
    !Number.isSafeInteger(meta.floor) ||
    meta.floor < 1 ||
    meta.floor > meta.last_seq + 1 ||
    !Number.isFinite(meta.time) ||
    meta.time < 0
  )
    fail()
  const snapshot = meta!
  const records: (ILogRecord & { state: LogRecordState })[] = []
  let expected = snapshot.floor
  let previousTime = 0
  for (const value of database.prepare(LogSql.records).all()) {
    const row = value as ILogRecord & { payload: string; state: LogRecordState }
    if (
      row.seq !== expected++ ||
      !Number.isSafeInteger(row.seq) ||
      row.seq > snapshot.last_seq ||
      !Number.isFinite(row.time) ||
      row.time < previousTime ||
      row.time > snapshot.time ||
      typeof row.kind !== 'string' ||
      !row.kind ||
      !Object.values(LogRecordState).includes(row.state)
    )
      fail()
    try {
      records.push({ ...row, payload: snapshotPayload(JSON.parse(row.payload)) })
      previousTime = row.time
    } catch (error) {
      throw createLoggerError(LoggerErrorCode.logStoreCorrupt, DurableText.corrupt, {
        cause: error
      })
    }
  }
  if (expected !== snapshot.last_seq + 1) fail()
  return { lastSeq: snapshot.last_seq, time: snapshot.time, floor: snapshot.floor, records }
}
/** Opens one local SQLite file, taking a retained engine lock before recovering committed records. */
export async function fileLogStore(
  path: string,
  options: ILogStoreOptions = {}
): Promise<ILogStore> {
  requireText(path)
  const report = durableReporter(options.report)
  const observe = createObservation(options, report)
  observe(() => ({ stage: LogStage.beforeLogOpen, owner: 'store', operation: LogOperation.open }))
  const runtime = detectServerRuntime()
  let database: IDatabase | undefined
  try {
    if (!runtime)
      throw createLoggerError(LoggerErrorCode.logStoreUnavailable, DurableText.unavailable)
    const moduleName = runtime === 'bun' ? LogSqliteModule.bun : LogSqliteModule.node
    let builtin: {
      DatabaseSync?: new (path: string) => IDatabase
      Database?: new (path: string) => IDatabase
    }
    try {
      builtin = await import(moduleName)
    } catch (error) {
      throw createLoggerError(LoggerErrorCode.logStoreUnavailable, DurableText.unavailable, {
        cause: error
      })
    }
    const Constructor = runtime === 'bun' ? builtin.Database : builtin.DatabaseSync
    if (!Constructor)
      throw createLoggerError(LoggerErrorCode.logStoreUnavailable, DurableText.unavailable)
    database = new Constructor(path)
    database.exec(LogSql.initialize)
    const snapshot = recover(database)
    const connection = database
    /** A failed COMMIT remains uncertain; the common store stops admission instead of replaying it. */
    const transaction = (effect: () => void): void => {
      let committing = false
      try {
        connection.exec(LogSql.begin)
        effect()
        committing = true
        connection.exec(LogSql.commit)
      } catch (error) {
        if (!committing) {
          try {
            connection.exec(LogSql.rollback)
          } catch (cleanup) {
            report(sqliteFailure(cleanup))
          }
        }
        throw sqliteFailure(error)
      }
    }
    const insert = connection.prepare(LogSql.append)
    const metadata = connection.prepare(LogSql.appendMeta)
    const remove = connection.prepare(LogSql.truncate)
    const floor = connection.prepare(LogSql.floor)
    const state = connection.prepare(LogSql.state)
    const store = createLogStore(options, snapshot, {
      append: (records, lastSeq, time) =>
        transaction(() => {
          for (const row of records)
            insert.run(
              row.seq,
              row.time,
              row.kind,
              JSON.stringify(row.payload),
              LogRecordState.pending
            )
          metadata.run(lastSeq, time)
        }),
      truncate: (beforeSeq) =>
        transaction(() => {
          remove.run(beforeSeq)
          floor.run(beforeSeq)
        }),
      setState: (seq, next) =>
        transaction(() => {
          state.run(next, seq)
        }),
      close: () => {
        try {
          connection.close()
        } catch (error) {
          throw sqliteFailure(error)
        }
      }
    })
    observe(() => ({ stage: LogStage.afterLogOpen, owner: 'store', operation: LogOperation.open }))
    return store
  } catch (error) {
    const coded =
      error instanceof Error &&
      Object.getOwnPropertyDescriptor(error, 'source')?.value === '@migaia/logger'
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
      owner: 'store',
      operation: LogOperation.open
    }))
    throw coded
  }
}
