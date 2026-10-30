import assert from 'node:assert/strict'
import { createStorageHost } from '@migaia/storage-host'
import { storageProbe } from '@migaia/storage-host/plugins/probe'
import { asyncDisposeKey } from '@migaia/plugin-host'
import { defineEntityPlugin } from '@migaia/storage-host/entity'
import { entityQueryFeature } from '@migaia/storage-host/entity/features/query'
import { entityMigrationFeature } from '@migaia/storage-host/entity/features/migration'
import { sqliteBackendPlugin } from '@migaia/storage-plugin-sqlite'
import { createStore } from '@migaia/store-light'
import { persist } from '@migaia/store-persist/light'
import { kv, records, sql, ttl, counter } from '@migaia/storage-contract'
import { lockKey } from '@migaia/storage-host/sdk'

/** Each invocation performs exactly one real process phase against its runtime-owned test file. */
const [mode, path] = process.argv.slice(2)
/** Only the selected explicit driver entry loads a native builtin. */
const driver = process.versions.bun
  ? await import('@migaia/storage-plugin-sqlite/bun')
  : await import('@migaia/storage-plugin-sqlite/node')
/** The caller owns this connection and releases the host before its native file handle. */
const connection =
  'bunSqliteDriver' in driver ? driver.bunSqliteDriver(path) : driver.nodeSqliteDriver(path)
/** The original public observation counts real native resource cleanup, including early return. */
let iterationCloses = 0
/** The actual public plugin installs its own native store. */
const host = await createStorageHost({
  plugins: [
    storageProbe({ onStorageIterationClose: () => iterationCloses++ }),
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
/** The same public entity definition drives root and native transaction views in every runtime. */
const runtimeEntityPlugin = defineEntityPlugin('runtime-entities', {
  name: 'runtime-entities',
  features: { query: entityQueryFeature(), migration: entityMigrationFeature() },
  key: 'id',
  version: 2,
  migrations: { 2: (value) => ({ ...value, score: 2 }) }
})
/** Install once on the real fixture host and retain exact extension inference. */
const entityHost = await host.use(runtimeEntityPlugin)
/** Borrow the supplied backend through the installed repository capability factories. */
const entities = entityHost.extensions[runtimeEntityPlugin.id](storage)
/** A real legacy archive must remain unchanged when its migrated state is read. */
const legacy = { version: 1, state: { id: 'legacy', active: true, score: 1 } }
/** Canonical record order makes ordinary and transaction projections directly comparable. */
const projected = [{ id: 'committed' }, { id: 'legacy' }, { id: 'root' }]
/**
 * Checks the same public resource paths on actual root and transaction queries.
 *
 * @param {import('@migaia/storage-contract').IStorageIterator<string>} stream Original query
 *   resource.
 * @returns {Promise<void>} Settles after its one native cleanup completes.
 */
async function assertQueryResource(stream) {
  /** Only this opened resource contributes to the next native close observation. */
  const before = iterationCloses
  assert.equal(typeof stream[asyncDisposeKey], 'function')
  assert.deepEqual(await stream.next(), { done: false, value: 'committed' })
  /** Explicit and language-level cleanup each retain their original cached Promise. */
  const main = stream.dispose()
  const symbolic = stream[asyncDisposeKey]()
  assert.equal(stream.dispose(), main)
  assert.equal(stream[asyncDisposeKey](), symbolic)
  assert.notEqual(main, symbolic)
  await Promise.all([main, symbolic])
  assert.equal((await stream.next()).done, true)
  assert.equal(iterationCloses, before + 1)
}
try {
  await handle.ready
  /** Explicit organizations reopen the same physical tables through the runtime's original driver. */
  const organization = host.org('00000000-0000-0000-0000-000000000001').backend('sqlite')
  if (mode === 'write') {
    await organization.transaction(async (tx) => {
      await tx.set('runtime-org', 'isolated')
      await tx.putRecord({ count: 1 }, 'runtime-org-record')
    })
  } else {
    assert.equal(await organization.get('runtime-org'), 'isolated')
    assert.deepEqual(await organization.getRecord('runtime-org-record'), { count: 1 })
  }
  assert.equal(await storage.get('runtime-org'), null)
  if (mode === 'write') {
    /** Native deadlines and canonical counter text survive each builtin driver's real reopen. */
    await storage.set('runtime-ttl', 'retained')
    assert.equal(await storage.use(ttl).expire(lockKey.text('runtime-ttl'), 60_000), true)
    assert.equal(await storage.use(counter).increment('runtime-increment'), 1)
    await storage.transaction(async (tx) => {
      assert.equal(await tx.use(counter).increment('runtime-increment', 4), 5)
      assert.equal(await tx.use(ttl).expire(lockKey.text('runtime-increment'), 60_000), true)
    })
    /** Actual builtin drivers execute the same root batch and canonical duplicate reads. */
    await storage.use(kv).setMany([
      { key: ['runtime-batch', 1], value: 'persisted' },
      { key: ['runtime-batch', 2], value: 'remove-in-scope' }
    ])
    assert.deepEqual(
      await storage.use(kv).getMany([['runtime-batch', 1], ['runtime-batch', 1], 'absent-batch']),
      ['persisted', 'persisted', undefined]
    )
    await storage.transaction(async (tx) => {
      assert.equal(
        await tx.use(kv).removeMany([
          ['runtime-batch', 2],
          ['runtime-batch', 2]
        ]),
        1
      )
      await tx.use(kv).setMany([{ key: ['runtime-batch', 3], value: 'native-scope' }])
      assert.deepEqual(await tx.use(kv).getMany([['runtime-batch', 3]]), ['native-scope'])
    })
    await handle.flush()
    const envelope = JSON.parse(await storage.get('runtime-counter'))
    assert.equal(envelope.version, 1)
    assert.deepEqual(envelope.state, { count: 1 })
    await storage.putRecord(legacy, entities.lockKey('legacy').key)
    await entities.put({ id: 'root', active: true, score: 3 })
    assert.deepEqual(await storage.getRecord(entities.lockKey('root').key), {
      version: 2,
      state: { id: 'root', active: true, score: 3 }
    })
    /** A saved repository view expires with its actual native callback, without owning the store. */
    let expired
    await storage.transaction(async (tx) => {
      expired = entities.in(tx)
      await expired.put({ id: 'committed', active: true, score: 4 })
      await expired.put({ id: 'hidden', active: false, score: 0 })
      assert.deepEqual(await expired.get('committed'), {
        id: 'committed',
        active: true,
        score: 4
      })
      assert.deepEqual(await expired.query().where({ active: true }).select('id').all(), projected)
    })
    await assert.rejects(expired.get('committed'), (error) => error.code === 'TRANSACTION_FAILED')
    await storage.sql`CREATE TABLE exact_integer(id INTEGER PRIMARY KEY,value INTEGER)`.run()
    assert.equal(storage.use(sql).sql, storage.sql)
    await storage.transaction((tx) =>
      tx.use(sql).sql`INSERT INTO exact_integer VALUES(${1},${9007199254740993n})`.run()
    )
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
        await entities.in(tx).put({ id: 'rolled-back', active: true, score: 5 })
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
    assert.equal(await storage.get('runtime-ttl'), 'retained')
    assert.ok((await storage.use(ttl).remaining(lockKey.text('runtime-ttl'))) > 0)
    assert.equal(await storage.get('runtime-increment'), '5')
    assert.ok((await storage.use(ttl).remaining(lockKey.text('runtime-increment'))) > 0)
    assert.equal(
      (await storage.sql`SELECT value FROM exact_integer WHERE id=${1}`.get()).value,
      9007199254740993n
    )
    assert.equal((await storage.sql`SELECT count(*) AS count FROM exact_integer`.get()).count, 1)
    /** Reopening proves that batch rows were committed through the real native transaction. */
    assert.deepEqual(
      await storage.use(kv).getMany([
        ['runtime-batch', 1],
        ['runtime-batch', 2],
        ['runtime-batch', 3]
      ]),
      ['persisted', undefined, 'native-scope']
    )
  }
  assert.deepEqual(await entities.get('legacy'), { id: 'legacy', active: true, score: 2 })
  assert.deepEqual(await storage.getRecord(entities.lockKey('legacy').key), legacy)
  await assertQueryResource(
    storage
      .use(records)
      .query()
      .select((value) => value.state.id)
      .stream()
  )
  await storage.transaction((tx) =>
    assertQueryResource(
      tx
        .use(records)
        .query()
        .select((value) => value.state.id)
        .stream()
    )
  )
  assert.deepEqual(await entities.query().where({ active: true }).select('id').all(), projected)
  assert.deepEqual(
    await storage.transaction((tx) =>
      entities.in(tx).query().where({ active: true }).select('id').all()
    ),
    projected
  )
  assert.equal(await entities.get('rolled-back'), undefined)
  assert.deepEqual(await entities.get('committed'), { id: 'committed', active: true, score: 4 })
  assert.deepEqual(await storage.getRecord(entities.lockKey('legacy').key), legacy)
  console.log(
    JSON.stringify({
      runtime: process.versions.bun ? 'Bun' : globalThis.Deno ? 'Deno' : 'Node',
      phase: mode,
      count: state.count,
      exactInteger: '9007199254740993',
      entity: 'versioned-query',
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
