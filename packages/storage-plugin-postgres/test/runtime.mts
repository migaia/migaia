import assert from 'node:assert/strict'
import { Pool } from 'pg'
import postgres from 'postgres'
import { createStorageHost } from '@migaia/storage-host'
import { kv, records, vector } from '@migaia/storage-contract'
import { postgresBackendPlugin, type IPgDriver } from '../dist/index.js'
import { pgDriver } from '../dist/pg.js'
import { postgresJsDriver } from '../dist/postgres-js.js'
import { bunSqlDriver } from '../dist/bun.js'
import { pgvectorFeature } from '../dist/features/pgvector.js'
import { pgCopyFeature } from '../dist/features/copy.js'
/** Each runtime reads the same service address and consumes emitted public package entries. */
const connectionString = process.env.MIGAIA_PG_URL
if (!connectionString)
  throw new Error('Run through scripts/storage-services.mts run -- to provide PostgreSQL')
/** Adapter choice is explicit; unsupported Bun does not become a passing backend matrix row. */
const adapter = process.argv[2]
/** The same public business calls run in each real runtime and supported adapter. */
async function exercise(driver: IPgDriver): Promise<void> {
  const host = await createStorageHost({
    plugins: [
      postgresBackendPlugin(
        { driver, prefix: 'pg_runtime_' + crypto.randomUUID().slice(0, 8) },
        { vector: pgvectorFeature(), copy: pgCopyFeature() }
      )
    ] as const
  })
  try {
    const store = host.backend('postgres')
    await store.use(kv).setMany([
      { key: ['runtime', 1], value: 'one' },
      { key: ['runtime', 2], value: 'two' }
    ])
    assert.deepEqual(await store.use(kv).getMany([['runtime', 2], ['runtime', 1], 'missing']), [
      'two',
      'one',
      undefined
    ])
    await store.transaction(async (scope) => {
      await scope.set('inside', 'committed')
      await scope.putRecord({ n: 1 }, 'record')
      await scope.sql`SELECT 1`.all()
    })
    assert.equal(await store.get('inside'), 'committed')
    assert.deepEqual(await store.use(records).query().all(), [{ n: 1 }])
    const row =
      await store.sql`SELECT 9223372036854775807::int8 AS integer, 1.25::numeric AS exact, decode('00ff','hex') AS bytes`.get()
    assert.equal(Object.getPrototypeOf(row), null)
    assert.deepEqual(
      { ...row },
      { integer: 9223372036854775807n, exact: '1.25', bytes: new Uint8Array([0, 255]) }
    )
    const collection = store.use(vector).collection('runtime', { dimensions: 1, metric: 'dot' })
    await collection.upsert([{ id: 'one', vector: [2] }])
    assert.equal((await collection.near([1], { exact: true }).topK(1).all())[0]?.score, 2)
    const table = 'pg_copy_' + crypto.randomUUID().replaceAll('-', '')
    await store.sql`CREATE TABLE ${store.sql.id(table)} (id integer)`.run()
    await store.transaction(async (scope) => {
      await scope.api.copy.from({ table: [table], columns: ['id'] }, async function* () {
        yield new TextEncoder().encode('1\n2\n')
      })
      await scope.set('copied', 'yes')
    })
    assert.equal(
      (await store.sql`SELECT count(*)::int4 AS count FROM ${store.sql.id(table)}`.get())?.count,
      2
    )
    console.log(
      JSON.stringify({
        adapter,
        status: 'PASS',
        groups: ['kv', 'records', 'transaction', 'sql', 'vector', 'copy']
      })
    )
  } finally {
    await host.dispose()
  }
}
if (adapter === 'bun') {
  const { SQL } = await import('bun')
  const client = new SQL(connectionString, { prepare: false })
  try {
    if (Bun.version === '1.4.3') {
      assert.throws(() => bunSqlDriver(client), { code: 'UNSUPPORTED_CAPABILITY' })
      console.log(
        JSON.stringify({
          adapter,
          status: 'UNVERIFIED',
          reason: 'Bun >=1.4.4 required; installed 1.4.3 rejects before I/O'
        })
      )
    } else await exercise(bunSqlDriver(client))
  } finally {
    await client.close()
  }
} else {
  assert(adapter === 'pg' || adapter === 'postgres-js')
  const pool = new Pool({ connectionString })
  const client = postgres(connectionString, { max: 8 })
  try {
    await exercise(adapter === 'pg' ? pgDriver(pool) : postgresJsDriver(client))
    assert.deepEqual((await pool.query('SELECT 1::int4 AS alive')).rows[0], { alive: 1 })
  } finally {
    await pool.end()
    await client.end()
  }
}
