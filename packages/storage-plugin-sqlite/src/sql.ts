import { createSqlTag } from '@migaia/storage-host/sdk'
import { type ICompiledStorageSql, type IOperationContext } from '@migaia/storage-contract'
import { SqliteLimits } from './constants.ts'
import { normalizeSqliteFailure } from './errors.ts'
import type {
  ISqliteDriver,
  ISqliteStatement,
  ISqliteValue,
  ISqliteRunResult,
  ISqliteExecutor
} from './types.ts'
/** One bounded LRU owns native statement references for an installed store. */
class SqliteStatements {
  /** The caller keeps native connection ownership; this cache only prepares and borrows statements. */
  readonly #driver: ISqliteDriver
  /** Map insertion order supplies constant-work LRU movement and eviction. */
  readonly #cache = new Map<string, ISqliteStatement>()
  /** Bind one existing native driver without creating a second cache or connection. */
  constructor(driver: ISqliteDriver) {
    this.#driver = driver
  }
  /**
   * Return the newest statement or prepare once, evicting the oldest reference at the existing
   * bound.
   */
  get(text: string): ISqliteStatement {
    let statement = this.#cache.get(text)
    if (statement) {
      this.#cache.delete(text)
      this.#cache.set(text, statement)
      return statement
    }
    try {
      statement = this.#driver.prepare(text)
    } catch (error) {
      throw normalizeSqliteFailure(error)
    }
    if (this.#cache.size === SqliteLimits.cache)
      this.#cache.delete(this.#cache.keys().next().value!)
    this.#cache.set(text, statement)
    return statement
  }
  /** Release cache references; native finalization remains with the connection owner. */
  clear(): void {
    this.#cache.clear()
  }
}
/** Native statement references remain bounded by the original store-owned LRU. */
export function createSqliteStatements(driver: ISqliteDriver) {
  return new SqliteStatements(driver)
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
