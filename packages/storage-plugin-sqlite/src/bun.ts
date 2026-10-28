import { Database } from 'bun:sqlite'
import { connection } from './driver.ts'
import { normalizeSqliteFailure } from './errors.ts'
import type { ISqliteConnection } from './types.ts'
/** Bun's explicit driver entry enables exact integers before any statement is prepared. */
export function bunSqliteDriver(path: string): ISqliteConnection {
  try {
    /** Close(true) finalizes outstanding native statements on the owning resource boundary. */
    const database = new Database(path, { safeIntegers: true })
    return connection({
      exec: (text) => database.exec(text),
      prepare: (text) => database.prepare(text),
      close: () => database.close(true)
    })
  } catch (error) {
    throw normalizeSqliteFailure(error)
  }
}
