import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import postgres from 'postgres'
import { describe, it, expect, onTestFinished } from 'vitest'
import { createStorageHost } from '@migaia/storage-host'
import { vector, ttl, lockKey, asChangeFeedStore } from '@migaia/storage-contract'
import { postgresBackendPlugin } from '../src/index.js'
import { pgDriver } from '../src/pg.js'
import { postgresJsDriver } from '../src/postgres-js.js'
import { pgvectorFeature } from '../src/features/pgvector.js'
/** Real pgvector extension and managed collection tables are mandatory for these selected cases. */
const connectionString = process.env.MIGAIA_PG_URL
if (!connectionString)
  throw new Error('Run through scripts/storage-services.mts run -- to provide PostgreSQL')
/** Each driver owns its caller client; the host borrows only native reservations and subscriptions. */
async function installed(adapter: 'pg' | 'postgres-js') {
  const pool = new Pool({ connectionString })
  const client = postgres(connectionString!, { max: 8 })
  const native = adapter === 'pg' ? pgDriver(pool) : postgresJsDriver(client)
  const statements: string[] = []
  const driver = {
    ...native,
    query: (...args: Parameters<typeof native.query>) => {
      statements.push(args[0])
      return native.query(...args)
    },
    connect: async (...args: Parameters<typeof native.connect>) => {
      const connection = await native.connect(...args)
      return {
        ...connection,
        query: (...query: Parameters<typeof connection.query>) => {
          statements.push(query[0])
          return connection.query(...query)
        }
      }
    }
  }
  const host = await createStorageHost({
    plugins: [
      postgresBackendPlugin(
        { driver, prefix: 'pg_vector_' + randomUUID().slice(0, 8) },
        { vector: pgvectorFeature() }
      )
    ] as const
  })
  onTestFinished(async () => {
    await host.dispose()
    await pool.end()
    await client.end()
  })
  return { host, store: host.backend('postgres'), statements }
}
describe.each(['pg', 'postgres-js'] as const)('%s real pgvector', (adapter) => {
  it('ranks in the engine after native payload filtering and keeps exact settings local', async () => {
    const { store } = await installed(adapter)
    const collection = store
      .use(vector)
      .collection<{ kind: string; rank: number; note?: string }>('docs', {
        dimensions: 2,
        metric: 'dot'
      })
    await collection.upsert([
      { id: 'skip', vector: [10, 0], payload: { kind: 'skip', rank: 3 } },
      { id: 'wanted', vector: [2, 0], payload: { kind: 'wanted', rank: 2, note: 'nul\0\ud800' } },
      { id: 'last', vector: [1, 0], payload: { kind: 'wanted', rank: 1 } }
    ])
    expect(
      await collection
        .near([1, 0], { exact: true })
        .where({ kind: 'wanted' })
        .topK(1)
        .withVector()
        .all()
    ).toEqual([
      {
        id: 'wanted',
        score: 2,
        payload: { kind: 'wanted', rank: 2, note: 'nul\0\ud800' },
        vector: [2, 0]
      }
    ])
    expect(
      await collection
        .near([1, 0])
        .where((payload) => payload.kind === 'wanted')
        .topK(1)
        .all()
    ).toEqual([])
    expect(
      await collection.near([1, 0]).where('rank', 'gte', 2).topK(3).minScore(2).all()
    ).toHaveLength(2)
    const unsupported = collection.near([1, 0]).where('kind', 'gte', 'wanted').topK(1)
    expect(unsupported.explain().client.some((step) => step.operation === 'where')).toBe(true)
    await expect(unsupported.requirePushdown().all()).rejects.toMatchObject({
      code: 'QUERY_NOT_PUSHABLE'
    })
    expect((await store.sql`SHOW enable_indexscan`.get())?.enable_indexscan).toBe('on')
    expect(
      (
        await store
          .use(vector)
          .collection('docs')
          .search([1, 0], {
            k: 1,
            exact: true,
            filter: { field: 'kind', eq: 'wanted' },
            withPayload: true
          })
      )[0]?.id
    ).toBe('wanted')
  })
  it('uses the shared sample synthesis, physical expiry deletion count and original selected mutation', async () => {
    const { store } = await installed(adapter)
    const collection = store
      .use(vector)
      .collection<{ group: string }>('points', { dimensions: 2, metric: 'cosine' })
    await collection.upsert([
      { id: 'seed', vector: [1, 0], payload: { group: 'one' } },
      { id: 'close', vector: [2, 0], payload: { group: 'one' } },
      { id: 'other', vector: [0, 1], payload: { group: 'two' } }
    ])
    expect((await collection.similarTo('seed').topK(1).all())[0]?.id).toBe('close')
    expect(
      (
        await collection
          .recommend({ positive: ['seed'], negative: ['other'] })
          .topK(1)
          .all()
      )[0]?.id
    ).toBe('close')
    expect(await store.use(ttl).expire(lockKey.vector('points', 'other'), 0)).toBe(true)
    expect(await collection.deleteWhere({ group: 'two' }, { count: 'scroll' })).toBe(1)
    expect(await collection.near([1, 0], { exact: true }).topK(1).delete()).toBe(1)
    expect(await collection.near([1, 0], { exact: true }).topK(3).count()).toBe(1)
    const feed = asChangeFeedStore(store).use(vector).collection('points')
    expect(typeof feed.near([1, 0]).topK(1).watch).toBe('function')
  })
  it('retains caller-table SQL semantics through the same original transaction connection', async () => {
    const { store } = await installed(adapter)
    const table = 'native_vector_' + randomUUID().replaceAll('-', '')
    await store.sql`CREATE TABLE ${store.sql.id(table)} (id bigint PRIMARY KEY, embedding vector(2), payload jsonb)`.run()
    await store.sql`INSERT INTO ${store.sql.id(table)} VALUES(${1n}, ${'[1,0]'}::vector, ${'{"kind":"wanted"}'}::jsonb),(${2n},${'[10,0]'}::vector,${'{"kind":"skip"}'}::jsonb)`.run()
    const target = {
      table: [table],
      idColumn: 'id',
      vectorColumn: 'embedding',
      payloadColumn: 'payload'
    } as const
    const result = await store.transaction((scope) =>
      scope.api.pgvector.search(target, [1, 0], {
        metric: 'dot',
        limit: 1,
        filter: { field: 'kind', eq: 'wanted' }
      })
    )
    expect(result).toEqual([{ id: 1n, score: 1, payload: '{"kind": "wanted"}' }])
  })
  it('maps all three exact native operators and preserves physical deletion counts for every mode', async () => {
    const { host, store, statements } = await installed(adapter)
    for (const metric of ['cosine', 'dot', 'euclid'] as const) {
      const points = store.use(vector).collection('metric-' + metric, { dimensions: 2, metric })
      await points.upsert([
        { id: 'same', vector: [1, 0] },
        { id: 'other', vector: [0, 1] }
      ])
      const hits = await points.near([1, 0], { exact: true }).topK(2).withVector().all()
      expect(hits.map((hit) => hit.id)).toEqual(['same', 'other'])
      expect(hits[0]!.score).toBeCloseTo(metric === 'euclid' ? 0 : 1, 6)
      expect(hits[1]!.score).toBeCloseTo(metric === 'euclid' ? -Math.SQRT2 : 0, 6)
      expect(hits[0]!.vector).toEqual([1, 0])
      expect(
        statements.some((text) =>
          text.includes(metric === 'cosine' ? '<=>' : metric === 'dot' ? '<#>' : '<->')
        )
      ).toBe(true)
    }
    const other = host.org(randomUUID()).backend('postgres')
    for (const [index, count] of ([undefined, 'precount', 'scroll'] as const).entries()) {
      const name = 'count-mode-' + index
      const points = store
        .use(vector)
        .collection<{ match: boolean }>(name, { dimensions: 2, metric: 'dot' })
      await points.upsert([
        { id: 'live', vector: [1, 0], payload: { match: true } },
        { id: 'expired', vector: [1, 0], payload: { match: true } },
        { id: 'permanent', vector: [1, 0], payload: { match: true } }
      ])
      await store.use(ttl).expire(lockKey.vector(name, 'live'), 10000)
      await store.use(ttl).expire(lockKey.vector(name, 'expired'), 0)
      await other
        .use(vector)
        .collection(name)
        .upsert([{ id: 'other-org', vector: [1, 0], payload: { match: true } }])
      expect(await points.near([1, 0], { exact: true }).topK(10).count()).toBe(2)
      statements.length = 0
      expect(await points.deleteWhere({ match: true }, { count })).toBe(3)
      const deletion = statements.filter(
        (text) =>
          text.startsWith('DELETE FROM') &&
          text.includes('RETURNING key') &&
          !text.includes('_commit_markers')
      )
      expect(deletion).toHaveLength(1)
      expect(deletion[0]).toContain('org_id=$1')
      expect(deletion[0]).not.toContain('expires_at')
      expect(statements.some((text) => /SELECT\s+count\s*\(|FETCH/i.test(text))).toBe(false)
      expect(
        await other.use(vector).collection(name).near([1, 0], { exact: true }).topK(10).count()
      ).toBe(1)
    }
  })
})
