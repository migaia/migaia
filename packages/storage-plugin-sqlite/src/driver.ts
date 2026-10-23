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
/** Both explicit and symbolic cleanup share one native close and retain distinct cached promises. */
export function connection(database: INativeDatabase): ISqliteConnection {
  /** Closing synchronously seals calls before deferred native cleanup starts. */
  let closed = false
  /** Explicit cleanup preserves its original failure. */
  let disposal: Promise<void> | undefined
  /** Symbol cleanup reports rather than rejecting. */
  let symbolic: Promise<void> | undefined
  /** One final reporting boundary covers symbolic connection cleanup. */
  const report = createStorageOperationReporter()
  /** Using a disposed connection never revives captured statements. */
  const assertOpen = (): void => {
    if (closed) throw sqliteError(SqliteErrorCode.sqliteFailed, new Error(SqliteErrorText.closed))
  }
  /** All driver failures keep the native object reachable. */
  const execute = <T>(run: () => T): T => {
    try {
      assertOpen()
      return run()
    } catch (error) {
      throw normalizeSqliteFailure(error)
    }
  }
  /** Native close is the connection owner's sole mutation after logical closure. */
  const dispose = (): Promise<void> => {
    if (disposal) return disposal
    closed = true
    return (disposal = Promise.resolve().then(() => {
      try {
        database.close()
      } catch (error) {
        throw normalizeSqliteFailure(error)
      }
    }))
  }
  return {
    exec: (text) =>
      execute(() => {
        database.exec(text)
      }),
    prepare: (text) =>
      execute(() => {
        /** Actual native statement remains borrowed until the connection closes. */
        const statement = database.prepare(text)
        /** Every entry checks connection lifetime, including old retained statements. */
        const adapted: ISqliteStatement = {
          run: (...values) =>
            execute(() => {
              const result = statement.run(...values)
              return {
                changes: scalar(result.changes) as number | bigint,
                lastInsertRowid: scalar(result.lastInsertRowid) as number | bigint
              } satisfies ISqliteRunResult
            }),
          get: (...values) =>
            execute(() => {
              const result = statement.get(...values)
              return result == null ? undefined : row(result)
            }),
          all: (...values) => execute(() => statement.all(...values).map(row))
        }
        return adapted
      }),
    dispose,
    [asyncDisposeKey]: () =>
      (symbolic ??= dispose().catch((error) => reportCleanupError(report, error)))
  }
}
