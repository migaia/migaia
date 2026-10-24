import { asyncDisposeKey } from '@migaia/plugin-host'
import {
  createStorageOperationReporter,
  reportCleanupError
} from '@migaia/storage-host/authoring/backend'
import type {
  ISqliteConnection,
  ISqliteStatement,
  ISqliteValue,
  ISqliteRow,
  ISqliteRunResult
} from './types.js'
import { normalizeSqliteFailure, sqliteError } from './errors.js'
import { SqliteErrorCode } from './error-code.js'
import { SqliteErrorText } from './error-text.js'
/** Native statements are captured by their actual adapter, without a second statement cache. */
export type INativeStatement = {
  run(...values: readonly ISqliteValue[]): {
    changes: number | bigint
    lastInsertRowid: number | bigint
  }
  get(...values: readonly ISqliteValue[]): Record<string, unknown> | null | undefined
  all(...values: readonly ISqliteValue[]): readonly Record<string, unknown>[]
}
/** Only connection construction owns this private native cleanup function. */
export type INativeDatabase = {
  exec(text: string): unknown
  prepare(text: string): INativeStatement
  close(): void
}
/** Keep exact integers outside the IEEE safe range; ordinary counts stay ergonomic numbers. */
function scalar(value: unknown): ISqliteValue {
  if (typeof value === 'bigint')
    return value >= BigInt(Number.MIN_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER)
      ? Number(value)
      : value
  if (value instanceof Uint8Array) return value.slice()
  return value as ISqliteValue
}
/** Native row bytes are detached, and each integer column is normalized exactly once. */
function row(value: Record<string, unknown>): ISqliteRow {
  /** Native column names, including **proto**, remain ordinary data properties. */
  const result: Record<string, ISqliteValue> = Object.create(null)
  for (const key of Object.keys(value)) result[key] = scalar(value[key])
  return result
}
/** One native connection owns logical closure and its original cached disposal promises. */
class SqliteConnection {
  /** Only this connection owner can close the native database. */
  readonly #database: INativeDatabase
  /** Calls are sealed synchronously before deferred native close begins. */
  #closed = false
  /** Explicit cleanup preserves native failure and its original Promise identity. */
  #disposal: Promise<void> | undefined
  /** Symbol cleanup reports once through its independent cached Promise. */
  #symbolic: Promise<void> | undefined
  /** Existing nonfatal diagnostics own symbolic cleanup failures. */
  readonly #report = createStorageOperationReporter()
  /** Retain the original native database without exposing its close authority. */
  constructor(database: INativeDatabase) {
    this.#database = database
  }
  /** Every current or retained statement checks the original connection lifetime. */
  execute<T>(run: () => T): T {
    try {
      if (this.#closed)
        throw sqliteError(SqliteErrorCode.sqliteFailed, new Error(SqliteErrorText.closed))
      return run()
    } catch (error) {
      throw normalizeSqliteFailure(error)
    }
  }
  /** Seal native calls once and preserve explicit native close failure. */
  readonly dispose = (): Promise<void> => {
    if (this.#disposal) return this.#disposal
    this.#closed = true
    return (this.#disposal = Promise.resolve().then(() => {
      try {
        this.#database.close()
      } catch (error) {
        throw normalizeSqliteFailure(error)
      }
    }))
  }
  /** Own connection ports keep detached calls bound to this exact native lifetime. */
  open(): ISqliteConnection {
    return {
      exec: (text) =>
        this.execute(() => {
          this.#database.exec(text)
        }),
      prepare: (text) =>
        this.execute(() => new SqliteStatement(this, this.#database.prepare(text)).open()),
      dispose: this.dispose,
      [asyncDisposeKey]: () =>
        (this.#symbolic ??= this.dispose().catch((error) =>
          reportCleanupError(this.#report, error)
        ))
    }
  }
}
/** One adapted statement borrows its original native statement and connection lifetime. */
class SqliteStatement {
  /** The connection remains the sole native lifetime and error-normalization owner. */
  readonly #connection: SqliteConnection
  /** This adapter adds no second statement cache or native finalizer. */
  readonly #statement: INativeStatement
  /** Bind one actual statement to its original connection. */
  constructor(connection: SqliteConnection, statement: INativeStatement) {
    this.#connection = connection
    this.#statement = statement
  }
  /** Keep exact integer normalization, missing-row semantics and detached output bytes. */
  open(): ISqliteStatement {
    return {
      run: (...values) =>
        this.#connection.execute(() => {
          const result = this.#statement.run(...values)
          return {
            changes: scalar(result.changes) as number | bigint,
            lastInsertRowid: scalar(result.lastInsertRowid) as number | bigint
          } satisfies ISqliteRunResult
        }),
      get: (...values) =>
        this.#connection.execute(() => {
          const result = this.#statement.get(...values)
          return result == null ? undefined : row(result)
        }),
      all: (...values) => this.#connection.execute(() => this.#statement.all(...values).map(row))
    }
  }
}
/** Both cleanup ports retain their original promise identities and share one native close. */
export function connection(database: INativeDatabase): ISqliteConnection {
  return new SqliteConnection(database).open()
}
