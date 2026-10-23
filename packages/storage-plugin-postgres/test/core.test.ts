import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import postgres from 'postgres'
import { describe, it, expect, onTestFinished } from 'vitest'
import { createStorageHost } from '@migaia/storage-host'
import {
  kv,
  records,
  ttl,
  counter,
  sql,
  lockKey,
  ConcurrencyPolicy
} from '@migaia/storage-contract'
import { postgresBackendPlugin } from '../src/index.js'
import { pgDriver } from '../src/pg.js'
import { postgresJsDriver } from '../src/postgres-js.js'
/** The original service wrapper supplies the real owned PostgreSQL fixture address. */
const connectionString = process.env.MIGAIA_PG_URL
/** Missing service setup is an explicit failure rather than an unverified passing skip. */
if (!connectionString)
  throw new Error('Run through scripts/storage-services.mts run -- to provide PostgreSQL')
/** Each case owns a fresh physical prefix and closes host before its caller-owned native client. */
async function installed(adapter: 'pg' | 'postgres-js') {
  const pool = new Pool({ connectionString })
  const client = postgres(connectionString!, { max: 8 })
  const driver = adapter === 'pg' ? pgDriver(pool) : postgresJsDriver(client)
  const host = await createStorageHost({
    plugins: [
      postgresBackendPlugin({ driver, prefix: 'pg_core_' + randomUUID().slice(0, 8) })
    ] as const
  })
  onTestFinished(async () => {
    await host.dispose()
    await pool.end()
    await client.end()
  })
  return { host, store: host.backend('postgres'), driver }
}
describe.each(['pg', 'postgres-js'] as const)('%s real native core', (adapter) => {
  it('preserves canonical values, native batches, channel conflicts and bytea order', async () => {
    const { store } = await installed(adapter)
    await store.set('nul\0\ud800', 'value\0\ud800')
    expect(await store.get('nul\0\ud800')).toBe('value\0\ud800')
    await store.use(kv).setMany([
      { key: ['batch', 1], value: 'one' },
      { key: ['batch', 2], value: 'two' },
      { key: 'batch-native', value: 'three' }
    ])
    expect(
      await store.use(kv).getMany([['batch', 2], ['batch', 1], ['batch', 2], 'missing'])
    ).toEqual(['two', 'one', 'two', undefined])
    expect(await store.use(kv).removeByPrefix(['batch'])).toBe(2)
    expect(await store.use(kv).removeMany(['batch-native', 'batch-native', 'missing'])).toBe(1)
    await store.setBytes('binary', new Uint8Array([0, 255]))
    expect(await store.getBytes('binary')).toEqual(new Uint8Array([0, 255]))
    await expect(store.putRecord({ x: 1 }, 'binary')).rejects.toMatchObject({
      code: 'DUPLICATE_KEY'
    })
    await store.putRecord(new Map([['portable', new Set([1, 2])]]), 'binary', {
      conflictPolicy: 'replace'
    })
    expect(await store.getBytes('binary')).toBeNull()
    expect(await store.getRecord('binary')).toEqual(new Map([['portable', new Set([1, 2])]]))
    await store.putRecord({ n: 2 }, ['record', 2])
    await store.putRecord({ n: 1 }, ['record', 1])
    expect(
      await store
        .use(records)
        .query<{ n: number }>()
        .where('n', 'gte', 1)
        .orderBy((value) => value.n)
        .all()
    ).toEqual([{ n: 1 }, { n: 2 }])
  })
  it('owns READ COMMITTED, rollback and first failure through the original transaction views', async () => {
    const { store } = await installed(adapter)
    const marker = new Error('rollback-original')
    await expect(
      store.transaction(async (scope) => {
        await scope.set('rollback', 'draft')
        await scope.sql`SELECT 1`.all()
        throw marker
      })
    ).rejects.toMatchObject({ code: 'TRANSACTION_FAILED', cause: marker })
    expect(await store.get('rollback')).toBeNull()
    await expect(
      store.transaction(async (scope) => {
        await scope.set('first', 'draft')
        try {
          await scope.sql`SELECT * FROM missing_native_table`.all()
        } catch {}
        await scope.set('late', 'forbidden')
      })
    ).rejects.toMatchObject({ code: 'TRANSACTION_FAILED' })
    expect(await store.get('first')).toBeNull()
    let old: Parameters<Parameters<typeof store.transaction>[0]>[0] | undefined
    await store.transaction(async (scope) => {
      old = scope
      expect((await scope.sql`SHOW transaction_isolation`.get())?.transaction_isolation).toBe(
        'read committed'
      )
      void scope.set('unawaited', 'accepted')
    })
    expect(await store.get('unawaited')).toBe('accepted')
    await expect(old!.get('unawaited')).rejects.toMatchObject({ code: 'TRANSACTION_FAILED' })
  })
  it('uses database-clock TTL and atomic safe decimal counters', async () => {
    const { store } = await installed(adapter)
    await store.set('expiry', 'live')
    expect(await store.use(ttl).expire(lockKey.text('expiry'), 10000)).toBe(true)
    await store.set('expiry', 'updated')
    expect(await store.use(ttl).remaining(lockKey.text('expiry'))).toBeGreaterThan(0)
    expect(await store.use(ttl).persist(lockKey.text('expiry'))).toBe(true)
    expect(await store.use(ttl).remaining(lockKey.text('expiry'))).toBeUndefined()
    await store.use(ttl).expire(lockKey.text('expiry'), 0)
    expect(await store.get('expiry')).toBeNull()
    expect(await store.use(counter).increment('counter', 3)).toBe(3)
    expect(await store.use(counter).increment('counter', -1)).toBe(2)
    await store.set('malformed', '01')
    await expect(store.use(counter).increment('malformed')).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT'
    })
    expect(await store.get('malformed')).toBe('01')
  })
  it('keeps actual OID scalar results and binds finite native arrays once', async () => {
    const { store, driver } = await installed(adapter)
    const row = await store.use(sql)
      .sql`SELECT 9223372036854775807::int8 AS big, 1.25::numeric AS exact, decode('00ff','hex') AS bytes, date '2026-01-02' AS date, '{"x":1}'::jsonb AS json, ARRAY[1,2] AS array`.get()
    expect(row).toEqual({
      big: 9223372036854775807n,
      exact: '1.25',
      bytes: new Uint8Array([0, 255]),
      date: '2026-01-02',
      json: '{"x": 1}',
      array: '{1,2}'
    })
    const array = (
      await driver.query('SELECT $1::text[]::text AS array', [
        { arrayType: 'text', values: [null, 'NULL', 'a,b', 'quote"', 'slash\\'] }
      ])
    ).rows[0]?.array
    expect(array).toBe('{NULL,"NULL","a,b","quote\\\"","slash\\\\"}')
    expect(
      await store
        .tx()
        .lock(lockKey.text('none'))
        .concurrency(ConcurrencyPolicy.fail())
        .run((scope) => scope.get('none'))
    ).toBeNull()
  })
})
