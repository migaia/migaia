import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import postgres from 'postgres'
import { describe, it, expect, onTestFinished } from 'vitest'
import { createStorageHost, definePlugin } from '@migaia/storage-host'
import { kv, records, ttl, counter, sql } from '@migaia/storage-contract'
import { lockKey, ConcurrencyPolicy } from '@migaia/storage-host/authoring/concurrency'
import { postgresBackendPlugin } from '../src/index.js'
import { pgDriver } from '../src/pg.js'
import { postgresJsDriver } from '../src/postgres-js.js'
import { PgNotificationChannel } from '../src/constants.js'
import type { IPgDriver } from '../src/types.js'
/** The original service wrapper supplies the real owned PostgreSQL fixture address. */
const connectionString = process.env.MIGAIA_PG_URL
/** Missing service setup is an explicit failure rather than an unverified passing skip. */
if (!connectionString)
  throw new Error('Run through scripts/storage-services.mts run -- to provide PostgreSQL')
/** Each case owns a fresh physical prefix and closes host before its caller-owned native client. */
async function installed(adapter: 'pg' | 'postgres-js') {
  const pool = new Pool({ connectionString })
  const client = postgres(connectionString!, { max: 8 })
  /** Observe executed SQL on both pool queries and the original transaction connections. */
  const nativeQueries: string[] = []
  /** Native subscription admission is separate from host-local commit listeners. */
  const subscriptions: string[] = []
  const native = adapter === 'pg' ? pgDriver(pool) : postgresJsDriver(client)
  const driver: IPgDriver = {
    ...native,
    query: (...args) => {
      nativeQueries.push(args[0])
      return native.query(...args)
    },
    connect: async (...args) => {
      /** Each borrowed connection keeps its original release and native SQL methods. */
      const connection = await native.connect(...args)
      return {
        ...connection,
        query: (...queryArgs) => {
          nativeQueries.push(queryArgs[0])
          return connection.query(...queryArgs)
        }
      }
    },
    listen: (...args) => {
      subscriptions.push(args[0])
      return native.listen!(...args)
    }
  }
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
  nativeQueries.length = 0
  return { host, store: host.backend('postgres'), driver, nativeQueries, subscriptions }
}
describe.each(['pg', 'postgres-js'] as const)('%s real native core', (adapter) => {
  it('preserves canonical values, native batches, channel conflicts and bytea order', async () => {
    const { store, nativeQueries, subscriptions } = await installed(adapter)
    await store.set('nul\0\ud800', 'value\0\ud800')
    expect(nativeQueries).toContainEqual(expect.stringMatching(/^INSERT INTO .*_kv"/))
    nativeQueries.length = 0
    expect(await store.get('nul\0\ud800')).toBe('value\0\ud800')
    expect(nativeQueries).toContainEqual(expect.stringMatching(/^SELECT value.*_kv"/))
    nativeQueries.length = 0
    await store.use(kv).setMany([
      { key: ['batch', 1], value: 'one' },
      { key: ['batch', 2], value: 'two' },
      { key: 'batch-native', value: 'three' }
    ])
    expect(nativeQueries).toContainEqual(expect.stringMatching(/^INSERT INTO .*_kv"/))
    nativeQueries.length = 0
    expect(await store.has('batch-native')).toBe(true)
    expect(nativeQueries).toContainEqual(expect.stringMatching(/^SELECT value.*_kv"/))
    nativeQueries.length = 0
    expect(await store.keys()).toContain('batch-native')
    expect(nativeQueries).toContainEqual(expect.stringMatching(/^SELECT key FROM .*_kv"/))
    expect(
      await store.use(kv).getMany([['batch', 2], ['batch', 1], ['batch', 2], 'missing'])
    ).toEqual(['two', 'one', 'two', undefined])
    expect(await store.use(kv).removeByPrefix(['batch'])).toBe(2)
    nativeQueries.length = 0
    expect(await store.use(kv).removeMany(['batch-native', 'batch-native', 'missing'])).toBe(1)
    expect(nativeQueries).toContainEqual(expect.stringMatching(/^DELETE FROM .*_kv"/))
    await store.set('remove-native', 'remove')
    nativeQueries.length = 0
    await store.remove('remove-native')
    expect(nativeQueries).toContainEqual(expect.stringMatching(/^DELETE FROM .*_kv"/))
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
    expect(nativeQueries).toContainEqual(expect.stringMatching(/^INSERT INTO .*_bytes"/))
    expect(nativeQueries).toContainEqual(expect.stringMatching(/^INSERT INTO .*_records"/))
    expect(nativeQueries).toContainEqual(expect.stringMatching(/^DELETE FROM .*_kv"/))
    expect(nativeQueries).toContainEqual(expect.stringContaining('unnest('))
    expect(nativeQueries).toContain('SELECT pg_notify($1,$2)')
    expect(subscriptions).toContain(PgNotificationChannel)
    nativeQueries.length = 0
    /** Public iteration must reopen the actual record table rather than reuse query results. */
    const iterated: unknown[] = []
    for await (const entry of store.iterateRecords()) iterated.push(entry)
    expect(iterated).toHaveLength(3)
    expect(nativeQueries).toContainEqual(expect.stringMatching(/^SELECT key,value,.*_records"/))
    nativeQueries.length = 0
    await store.clearValues()
    expect(nativeQueries).toContainEqual(expect.stringMatching(/^DELETE FROM .*_kv"/))
    expect(await store.get('nul\0\ud800')).toBeNull()
    nativeQueries.length = 0
    await store.clearAll()
    for (const channel of ['kv', 'bytes', 'records'])
      expect(nativeQueries).toContainEqual(
        expect.stringMatching(new RegExp('^DELETE FROM .*_' + channel + '"'))
      )
    expect(await store.getRecord(['record', 1])).toBeUndefined()
  })
  it('owns READ COMMITTED, rollback and first failure through the original transaction views', async () => {
    const { store, nativeQueries } = await installed(adapter)
    const marker = new Error('rollback-original')
    await expect(
      store.transaction(async (scope) => {
        await scope.set('rollback', 'draft')
        await scope.sql`SELECT 1`.all()
        throw marker
      })
    ).rejects.toMatchObject({ code: 'TRANSACTION_FAILED', cause: marker })
    expect(nativeQueries).toContain('SELECT 1')
    expect(nativeQueries).toContain('ROLLBACK')
    nativeQueries.length = 0
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
    expect(nativeQueries).toContain('SHOW transaction_isolation')
    expect(nativeQueries).toContain('COMMIT')
    await expect(old!.get('unawaited')).rejects.toMatchObject({ code: 'TRANSACTION_FAILED' })
  })
  it('uses database-clock TTL and atomic safe decimal counters', async () => {
    const { store, nativeQueries } = await installed(adapter)
    await store.set('expiry', 'live')
    expect(await store.use(ttl).expire(lockKey.text('expiry'), 10000)).toBe(true)
    expect(nativeQueries).toContainEqual(expect.stringMatching(/^UPDATE .*_kv" SET expires_at=/))
    expect(nativeQueries).toContainEqual(expect.stringContaining('clock_timestamp()'))
    await store.set('expiry', 'updated')
    expect(await store.use(ttl).remaining(lockKey.text('expiry'))).toBeGreaterThan(0)
    expect(await store.use(ttl).persist(lockKey.text('expiry'))).toBe(true)
    expect(await store.use(ttl).remaining(lockKey.text('expiry'))).toBeUndefined()
    await store.use(ttl).expire(lockKey.text('expiry'), 0)
    expect(await store.get('expiry')).toBeNull()
    nativeQueries.length = 0
    expect(await store.use(counter).increment('counter', 3)).toBe(3)
    expect(nativeQueries).toContainEqual(expect.stringMatching(/^INSERT INTO .*_kv"/))
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

/** The actual stage-transformed key must reach the original scoped read, just as root reads do. */
it('uses pipeline input for the original scoped text get', async () => {
  const pool = new Pool({ connectionString })
  const transform = definePlugin('pg-input-transform', (core) => ({
    install() {
      core.useAsyncPipeline((request, next) =>
        next(
          request.operation === 'get' && request.scope !== undefined
            ? { ...request, input: 'transformed' }
            : request
        )
      )
      return {}
    }
  }))
  const host = await createStorageHost({
    plugins: [
      postgresBackendPlugin({
        driver: pgDriver(pool),
        prefix: 'pg_input_' + randomUUID().slice(0, 8)
      }),
      transform
    ] as const
  })
  onTestFinished(async () => {
    await host.dispose()
    await pool.end()
  })
  const store = host.backend('postgres')
  await store.set('original', 'old')
  await store.set('transformed', 'new')
  expect(await store.get('original')).toBe('old')
  expect(await store.transaction((scope) => scope.get('original'))).toBe('new')
})

/** Native statement boundaries prove expiry both before result selection and before commit. */
for (const mode of ['between-statements', 'before-commit'] as const) {
  it('respects record query expiry ' + mode, async () => {
    const pool = new Pool({ connectionString })
    const native = pgDriver(pool)
    const prefix = 'pg_record_expiry_' + randomUUID().slice(0, 8),
      org = randomUUID()
    let armed = false
    const driver = {
      ...native,
      connect: async (...args: Parameters<typeof native.connect>) => {
        const client = await native.connect(...args)
        return {
          ...client,
          query: async (...query: Parameters<typeof client.query>) => {
            const boundary =
              armed &&
              query[0].startsWith('DELETE FROM') &&
              query[0].includes('_records') &&
              query[0].includes('expires_at')
            if (boundary) {
              armed = false
              await client.query(
                'UPDATE ' +
                  prefix +
                  "_records SET expires_at=clock_timestamp()+interval '50 millisecond' WHERE org_id=$1",
                [org]
              )
            }
            const result = await client.query(...query)
            if (boundary && mode === 'between-statements')
              await client.query('SELECT pg_sleep(0.075)', [])
            return result
          }
        }
      }
    }
    const host = await createStorageHost({
      org,
      plugins: [postgresBackendPlugin({ driver, prefix })] as const
    })
    onTestFinished(async () => {
      await host.dispose()
      await pool.end()
    })
    const store = host.backend('postgres')
    await store.putRecord({ live: true }, 'point')
    armed = true
    if (mode === 'between-statements') expect(await store.use(records).query().all()).toEqual([])
    else
      await expect(
        store.transaction(
          async (scope) => {
            expect(await scope.use(records).query().all()).toEqual([{ live: true }])
            await scope.sql`SELECT pg_sleep(0.075)`.get()
          },
          { concurrency: ConcurrencyPolicy.optimistic({ retries: 0 }) }
        )
      ).rejects.toMatchObject({ code: 'WRITE_CONFLICT' })
  })
}

/** A scoped point read uses the same native clock when expiry crosses its prune/select boundary. */
for (const channel of ['text', 'bytes', 'record', 'batch'] as const) {
  it('treats an expired point as missing at the actual SELECT for ' + channel, async () => {
    const pool = new Pool({ connectionString })
    const native = pgDriver(pool)
    const prefix = 'pg_point_expiry_' + randomUUID().slice(0, 8),
      org = randomUUID()
    const suffix =
      channel === 'text' || channel === 'batch'
        ? '_kv'
        : channel === 'bytes'
          ? '_bytes'
          : '_records'
    let armed = false
    const driver = {
      ...native,
      connect: async (...args: Parameters<typeof native.connect>) => {
        const client = await native.connect(...args)
        return {
          ...client,
          query: async (...args: Parameters<typeof client.query>) => {
            const boundary =
              armed &&
              args[0].startsWith('SELECT key FROM ') &&
              args[0].includes(suffix) &&
              args[0].includes('expires_at<=')
            if (boundary) {
              armed = false
              await client.query(
                'UPDATE ' +
                  prefix +
                  suffix +
                  " SET expires_at=clock_timestamp()+interval '50 millisecond' WHERE org_id=$1",
                [org]
              )
            }
            const result = await client.query(...args)
            if (boundary) await client.query('SELECT pg_sleep(0.075)', [])
            return result
          }
        }
      }
    }
    const host = await createStorageHost({
      org,
      plugins: [postgresBackendPlugin({ driver, prefix })] as const
    })
    onTestFinished(async () => {
      await host.dispose()
      await pool.end()
    })
    const store = host.backend('postgres')
    if (channel === 'text' || channel === 'batch') await store.set('point', 'value')
    else if (channel === 'bytes') await store.setBytes('point', new Uint8Array([1]))
    else await store.putRecord({ live: true }, 'point')
    armed = true
    await store.transaction(
      async (scope) => {
        const value =
          channel === 'batch'
            ? await scope.use(kv).getMany(['point'])
            : channel === 'text'
              ? await scope.get('point')
              : channel === 'bytes'
                ? await scope.getBytes('point')
                : await scope.getRecord('point')
        expect(value).toEqual(
          channel === 'batch' ? [undefined] : channel === 'record' ? undefined : null
        )
      },
      { concurrency: ConcurrencyPolicy.optimistic({ retries: 0 }) }
    )
  })
}
