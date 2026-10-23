import assert from 'node:assert/strict'
import { createStorageHost } from '@migaia/storage-host'
import { sqliteBackendPlugin } from '@migaia/storage-plugin-sqlite'
import { createStore } from '@migaia/store-light'
import { persist } from '@migaia/store-persist/light'
import { lockKey } from '@migaia/storage-contract'

/** Each invocation performs exactly one real process phase against its runtime-owned test file. */
const [mode, path] = process.argv.slice(2)
/** Only the selected explicit driver entry loads a native builtin. */
const driver = process.versions.bun
  ? await import('@migaia/storage-plugin-sqlite/bun')
  : await import('@migaia/storage-plugin-sqlite/node')
/** The caller owns this connection and releases the host before its native file handle. */
const connection =
  'bunSqliteDriver' in driver ? driver.bunSqliteDriver(path) : driver.nodeSqliteDriver(path)
/** The actual public plugin installs its own native store. */
const host = await createStorageHost({
  plugins: [
    sqliteBackendPlugin({ driver: connection, maxLockMs: mode === 'hold' ? 1000 : undefined })
  ]
})
/** The default literal id remains exact through the installed public host. */
const storage = host.backend('sqlite')
if (mode === 'hold') {
  await storage
    .tx()
    .lock(lockKey.text('crash'))
    .run(async (tx) => {
      await tx.set('crash', 'uncommitted')
      process.send?.({ ready: true })
      await new Promise(() => {})
    })
}
/** Persist writes and hydration use the real light-store facade. */
const state = createStore({ count: mode === 'write' ? 1 : 0 })
/** One handle owns only persistence work, never the borrowed backend or connection. */
const handle = persist(state, { key: 'runtime-counter', storage, version: 1 })
try {
  await handle.ready
  if (mode === 'write') {
    await handle.flush()
    const envelope = JSON.parse(await storage.get('runtime-counter'))
    assert.equal(envelope.version, 1)
    assert.deepEqual(envelope.state, { count: 1 })
    await storage.sql`CREATE TABLE exact_integer(id INTEGER PRIMARY KEY,value INTEGER)`.run()
    await storage.sql`INSERT INTO exact_integer VALUES(${1},${9007199254740993n})`.run()
    await storage.sql`CREATE VIRTUAL TABLE search USING fts5(body)`.run()
    await storage.sql`INSERT INTO search(body) VALUES(${'quoted search phrase'})`.run()
    assert.equal(
      (
        await storage.sql`SELECT count(*) AS count FROM search WHERE search MATCH ${'"search phrase"'}`.get()
      ).count,
      1
    )
    assert.equal(
      (
        await storage.sql`SELECT json_extract(${'{"nested":{"title":"ok"}}'}, '$.nested.title') AS title`.get()
      ).title,
      'ok'
    )
    const primary = new Error('native runtime rollback')
    await assert.rejects(
      storage.transaction(async (tx) => {
        await tx.sql`INSERT INTO exact_integer VALUES(${2},${2})`.run()
        await tx.set('rolled-back', 'yes')
        throw primary
      }),
      (error) => error.code === 'TRANSACTION_FAILED' && error.cause === primary
    )
    assert.equal(await storage.get('rolled-back'), null)
  } else {
    assert.equal(mode, 'read')
    assert.equal(state.count, 1)
    assert.equal(
      (await storage.sql`SELECT value FROM exact_integer WHERE id=${1}`.get()).value,
      9007199254740993n
    )
    assert.equal((await storage.sql`SELECT count(*) AS count FROM exact_integer`.get()).count, 1)
  }
  console.log(
    JSON.stringify({
      runtime: process.versions.bun ? 'Bun' : globalThis.Deno ? 'Deno' : 'Node',
      phase: mode,
      count: state.count,
      exactInteger: '9007199254740993',
      result: 'passed'
    })
  )
} finally {
  await handle.disposeAsync()
  await state.$dispose()
  await host.dispose()
  assert.equal(connection.prepare('SELECT 1 AS n').get().n, 1)
  await connection.dispose()
}
