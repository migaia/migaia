import { DatabaseSync } from 'node:sqlite'
import { connection } from './driver.js'
import { normalizeSqliteFailure } from './errors.js'
import type { ISqliteConnection, ISqliteValue } from './types.js'
/** Node and Deno use their built-in driver; only the returned resource owns native close. */
export function nodeSqliteDriver(path: string): ISqliteConnection {
  try {
    /** The builtin connection remains private and uses exact integer reads on every statement. */
    const database = new DatabaseSync(path)
    return connection({
      exec: (text) => database.exec(text),
      prepare: (text) => {
        /** No native cache is added underneath the store's bounded LRU. */
        const statement = database.prepare(text)
        statement.setReadBigInts(true)
        return {
          run: (...values: readonly ISqliteValue[]) => statement.run(...values),
          get: (...values: readonly ISqliteValue[]) => statement.get(...values),
          all: (...values: readonly ISqliteValue[]) => statement.all(...values)
        }
      },
      close: () => database.close()
    })
  } catch (error) {
    throw normalizeSqliteFailure(error)
  }
}
