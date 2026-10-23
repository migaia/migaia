import {
  createSqlTag,
  type ICompiledStorageSql,
  type IOperationContext
} from '@migaia/storage-contract'
import { SqliteLimits } from './constants.js'
import { normalizeSqliteFailure } from './errors.js'
import type {
  ISqliteDriver,
  ISqliteStatement,
  ISqliteValue,
  ISqliteRunResult,
  ISqliteExecutor
} from './types.js'
/** This instance owns only bounded native statement references, never shared SQL nodes or scanners. */
export function createSqliteStatements(driver: ISqliteDriver): {
  get(text: string): ISqliteStatement
  clear(): void
} {
  /** Map insertion order provides constant-work LRU movement and eviction. */
  const cache = new Map<string, ISqliteStatement>()
  return {
    get(text) {
      /** A hit moves only this statement to the newest position. */
      let statement = cache.get(text)
      if (statement) {
        cache.delete(text)
        cache.set(text, statement)
        return statement
      }
      try {
        statement = driver.prepare(text)
      } catch (error) {
        throw normalizeSqliteFailure(error)
      }
      if (cache.size === SqliteLimits.cache) cache.delete(cache.keys().next().value!)
      cache.set(text, statement)
      return statement
    },
    clear: () => cache.clear()
  }
}
/** Author callbacks enter original operation ownership before invoking lazy shared compilation. */
export function createSqliteExecutor(
  execute: <R>(
    prepare: () => ICompiledStorageSql,
    ctx: IOperationContext | undefined,
    run: (compiled: ICompiledStorageSql) => R
  ) => Promise<R>,
  statements: ReturnType<typeof createSqliteStatements>
): ISqliteExecutor {
  /** Booleans are portable SQL inputs but SQLite binds their integer representation. */
  const values = (compiled: ICompiledStorageSql): ISqliteValue[] =>
    compiled.values.map((value) => (typeof value === 'boolean' ? Number(value) : value))
  return {
    sql: createSqlTag<ISqliteValue, ISqliteRunResult>({
      dialect: 'sqlite',
      all: (prepare, ctx) =>
        execute(prepare, ctx, (compiled) => statements.get(compiled.text).all(...values(compiled))),
      get: (prepare, ctx) =>
        execute(prepare, ctx, (compiled) => statements.get(compiled.text).get(...values(compiled))),
      run: (prepare, ctx) =>
        execute(prepare, ctx, (compiled) => statements.get(compiled.text).run(...values(compiled)))
    })
  }
}
