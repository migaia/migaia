import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import postgres from 'postgres'
import { describe, it, expect, onTestFinished, expectTypeOf } from 'vitest'
import { createStorageHost } from '@migaia/storage-host'
import { vector, ttl, asChangeFeedStore } from '@migaia/storage-contract'
import { lockKey } from '@migaia/storage-host/sdk'
import { postgresBackendPlugin } from '../src/index.js'
import { pgDriver } from '../src/pg.js'
import { postgresJsDriver } from '../src/postgres-js.js'
import { pgvectorFeature } from '../src/features/pgvector.js'
import { pgQuantizedFeature } from '../src/features/quantized.js'
import type { IPgNativeParameter } from '../src/types.js'
import { walkErrorCauses } from '@migaia/utils/error'
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
  it('round-trips long collection names and point IDs without a binary-key budget', async () => {
    const { store } = await installed(adapter)
    const name = 'name\0\ud800'.repeat(1000) + 'z'
    const id = 'point\0\udfff'.repeat(1000) + 'z'
    expect(name.length).toBe(6001)
    expect(id.length).toBe(7001)
    const collection = store.use(vector).collection(name, { dimensions: 2, metric: 'dot' })
    await collection.upsert([{ id, vector: [1, 0], payload: { complete: true } }])
    expect(
      await store.use(vector).collection(name).near([1, 0], { exact: true }).topK(1).all()
    ).toEqual([{ id, score: 1, payload: { complete: true } }])
    expect(await store.use(ttl).expire(lockKey.vector(name, id), 10000)).toBe(true)
    expect(await store.use(ttl).persist(lockKey.vector(name, id))).toBe(true)
    await collection.delete([id])
    expect(await collection.near([1, 0], { exact: true }).topK(1).all()).toEqual([])
  })
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

/** Quantization borrows the same real driver; observations contain original native SQL and bindings. */
async function installedQuantized(
  adapter: 'pg' | 'postgres-js',
  mode: 'halfvec' | 'binary_quantize'
) {
  const pool = new Pool({ connectionString })
  const client = postgres(connectionString!, { max: 8 })
  const native = adapter === 'pg' ? pgDriver(pool) : postgresJsDriver(client)
  const statements: { text: string; values: readonly IPgNativeParameter[] }[] = []
  const driver = {
    ...native,
    connect: async (...args: Parameters<typeof native.connect>) => {
      const connection = await native.connect(...args)
      return {
        ...connection,
        query: (...query: Parameters<typeof connection.query>) => {
          statements.push({ text: query[0], values: query[1] })
          return connection.query(...query)
        }
      }
    }
  }
  const host = await createStorageHost({
    plugins: [
      postgresBackendPlugin(
        { driver, prefix: 'pg_quant_' + randomUUID().slice(0, 8) },
        { vector: pgvectorFeature(), quantized: pgQuantizedFeature({ mode }) }
      )
    ] as const
  })
  onTestFinished(async () => {
    await host.dispose()
    await pool.end()
    await client.end()
  })
  return { host, store: host.backend('postgres'), driver, statements, pool }
}

describe.each(['pg', 'postgres-js'] as const)('%s quantized Feature', (adapter) => {
  for (const mode of ['halfvec', 'binary_quantize'] as const) {
    it(
      mode + ' recalls once with tenant/expiry/payload filters and exactly rescores before rerank',
      async () => {
        const { host, store, driver, statements, pool } = await installedQuantized(adapter, mode)
        expect(
          (await pool.query("SELECT extversion FROM pg_extension WHERE extname='vector'")).rows[0]
            .extversion
        ).toBe('0.8.7')
        const collection = store
          .use(vector)
          .collection<{ kind: string }>('quantized', { dimensions: 2, metric: 'dot' })
        await collection.upsert([
          { id: 'a', vector: [3, 0.1], payload: { kind: 'wanted' } },
          { id: 'b', vector: [2, 0.2], payload: { kind: 'wanted' } },
          { id: 'c', vector: [1, 0.3], payload: { kind: 'wanted' } },
          { id: 'expired', vector: [99, 0.1], payload: { kind: 'wanted' } },
          { id: 'excluded', vector: [100, 0.1], payload: { kind: 'excluded' } }
        ])
        await store.use(ttl).expire(lockKey.vector('quantized', 'expired'), 0)
        await host
          .org(randomUUID())
          .backend('postgres')
          .use(vector)
          .collection('quantized')
          .upsert([{ id: 'foreign', vector: [200, 0.1], payload: { kind: 'wanted' } }])
        statements.length = 0
        const query = collection
          .near([1, 0.1])
          .where({ kind: 'wanted' })
          .topK(3)
          .rescore({ topN: 2 })
          .withVector()
        const hits = await query.all()
        expect(hits.map((hit) => hit.id)).toEqual(['a', 'b'])
        expect(hits[0]!.score).toBeCloseTo(3.01, 5)
        expect(hits[0]!.vector[0]).toBe(3)
        const business = statements.filter((row) =>
          row.text.startsWith('WITH recalled AS MATERIALIZED')
        )
        expect(business).toHaveLength(1)
        const statement = business[0]!
        const recall = statement.text.slice(0, statement.text.indexOf(') SELECT'))
        expect(recall).toContain('org_id=$1')
        expect(recall).toContain('expires_at>clock_timestamp()')
        expect(recall).toContain('projection #>')
        expect(statement.text).toContain(
          mode === 'halfvec' ? '::halfvec(2)' : 'binary_quantize(embedding)::bit(2)'
        )
        expect(statement.values).toContain(3)
        expect(statement.values.at(-1)).toBe(2)
        const connection = await driver.connect()
        try {
          await connection.query('BEGIN', [])
          await connection.query('SET LOCAL enable_seqscan=off', [])
          await connection.query('SET LOCAL enable_bitmapscan=off', [])
          await connection.query('SET LOCAL enable_sort=off', [])
          const plan = JSON.stringify(
            (await connection.query('EXPLAIN (FORMAT JSON) ' + statement.text, statement.values))
              .rows
          )
          expect(plan).toContain('Index Scan')
          expect(plan).toContain('storage_q_')
        } finally {
          await connection.query('ROLLBACK', [])
          await connection.dispose()
        }
        expect(
          (await query.rerank(({ hits }) => hits.map((hit) => -hit.score), { topN: 1 }).all())[0]!
            .id
        ).toBe('b')
        expect(
          await collection.near([1, 0.1]).where({ kind: 'wanted' }).topK(3).rescore().count()
        ).toBe(3)
        let evaluated = 0
        expect(
          await collection
            .near([1, 0.1])
            .where(() => {
              evaluated++
              return false
            })
            .topK(3)
            .rescore({ topN: 1 })
            .all()
        ).toEqual([])
        expect(evaluated).toBe(1)
        expect(
          (
            await collection.near([1, 0.1], { exact: true }).where({ kind: 'wanted' }).topK(3).all()
          ).map((hit) => hit.id)
        ).toEqual(['a', 'b', 'c'])
        const indexes = (
          await pool.query(
            "SELECT indexdef FROM pg_indexes WHERE indexname LIKE 'storage_q_%' AND indexdef LIKE '%" +
              mode.replace('binary_quantize', 'binary_quantize') +
              "%'"
          )
        ).rows
        expect(indexes.length).toBeGreaterThan(0)
        expect(
          indexes.some((row) =>
            row.indexdef.includes(mode === 'halfvec' ? 'halfvec_ip_ops' : 'bit_hamming_ops')
          )
        ).toBe(true)
        if (mode === 'halfvec') {
          for (const [metric, first, opclass] of [
            ['cosine', 'b', 'halfvec_cosine_ops'],
            ['euclid', 'c', 'halfvec_l2_ops']
          ] as const) {
            expect(
              (
                await collection
                  .near([1, 0.1], { metric })
                  .where({ kind: 'wanted' })
                  .topK(3)
                  .rescore({ topN: 1 })
                  .all()
              )[0]!.id
            ).toBe(first)
            expect(
              statements.some(
                (row) => row.text.includes('USING hnsw') && row.text.includes(opclass)
              )
            ).toBe(true)
          }
        }
        expect(
          await collection
            .near([1, 0.1])
            .where({ kind: 'wanted' })
            .minScore(2.5)
            .topK(3)
            .rescore({ topN: 2 })
            .count()
        ).toBe(1)
        expectTypeOf(hits[0]!.payload).toEqualTypeOf<{ kind: string } | undefined>()
        function invalidTypes() {
          // @ts-expect-error Only bounded original queries admit native rescore.
          collection.near([1, 0]).rescore({ topN: 1 })
          // @ts-expect-error A native result cannot append another rescore.
          query.rescore({ topN: 1 })
          // @ts-expect-error Native refined reads never delete selected points.
          query.delete()
          // @ts-expect-error Client reranking cannot append native rescore.
          query.rerank(({ hits }) => hits.map((hit) => hit.score)).rescore({ topN: 1 })
        }
        void invalidTypes
      }
    )
  }
  it('captures options once and rejects invalid bounds without issuing native SQL', async () => {
    const { store, statements } = await installedQuantized(adapter, 'halfvec')
    const collection = store.use(vector).collection('bounds', { dimensions: 2, metric: 'dot' })
    await collection.upsert([{ id: 'a', vector: [1, 0] }])
    statements.length = 0
    const base = collection.near([1, 0]).topK(2)
    for (const topN of [0, -1, 3, 1.5, NaN, Infinity, null as never])
      expect(() => base.rescore({ topN })).toThrowError(
        expect.objectContaining({ code: 'INVALID_ARGUMENT' })
      )
    expect(statements).toHaveLength(0)
    let reads = 0
    const query = base.rescore({
      get topN() {
        reads++
        return 1
      }
    })
    expect(reads).toBe(1)
    expect(await query.count()).toBe(1)
    expect(reads).toBe(1)
  })
})

it('prepares one cold expression index through two hosts on the same native configuration row', async () => {
  const pool = new Pool({ connectionString })
  const driver = pgDriver(pool)
  const prefix = 'pg_quant_cold_' + randomUUID().slice(0, 8)
  const initial = await createStorageHost({
    plugins: [postgresBackendPlugin({ driver, prefix }, { vector: pgvectorFeature() })] as const
  })
  try {
    await initial
      .backend('postgres')
      .use(vector)
      .collection('cold', { dimensions: 2, metric: 'dot' })
      .upsert([{ id: 'a', vector: [1, 0] }])
  } finally {
    await initial.dispose()
  }
  const hosts = await Promise.all(
    [0, 1].map(() =>
      createStorageHost({
        plugins: [
          postgresBackendPlugin(
            { driver, prefix },
            { vector: pgvectorFeature(), quantized: pgQuantizedFeature({ mode: 'halfvec' }) }
          )
        ] as const
      })
    )
  )
  try {
    const hits = await Promise.all(
      hosts.map((host) =>
        host.backend('postgres').use(vector).collection('cold').near([1, 0]).topK(1).rescore().all()
      )
    )
    expect(hits.map((rows) => rows.map((row) => row.id))).toEqual([['a'], ['a']])
    const indexes = await pool.query(
      "SELECT indexdef FROM pg_indexes WHERE tablename LIKE $1 AND indexdef LIKE '%USING hnsw%'",
      [prefix + '_v%']
    )
    expect(indexes.rows).toHaveLength(1)
  } finally {
    await Promise.all(hosts.map((host) => host.dispose()))
    await pool.end()
  }
})

it('keeps native halfvec dimension and value limits without narrowing the original vector domain', async () => {
  const { store } = await installedQuantized('pg', 'halfvec')
  for (const [name, components] of [
    ['dimension', Array.from({ length: 4001 }, () => 1)],
    ['range', [70000]]
  ] as const) {
    const error = await store
      .use(vector)
      .collection(name, { dimensions: components.length, metric: 'dot' })
      .upsert([{ id: 'too-large', vector: components }])
      .then(
        () => undefined,
        (cause: unknown) => cause
      )
    expect(
      walkErrorCauses(error).some(
        (cause) =>
          typeof cause === 'object' &&
          cause !== null &&
          'source' in cause &&
          cause.source === 'storage.backend.postgres' &&
          'code' in cause &&
          cause.code === 'SQL_FAILED'
      )
    ).toBe(true)
    expect(
      walkErrorCauses(error).some(
        (cause) =>
          typeof cause === 'object' &&
          cause !== null &&
          'code' in cause &&
          (cause.code === '54000' || cause.code === '22003')
      )
    ).toBe(true)
  }
})

it('rejects malformed modes before installation and requires the selected original pgvector provider', async () => {
  expect(() => pgQuantizedFeature({ mode: 'other' as never })).toThrowError(
    expect.objectContaining({ code: 'INVALID_ARGUMENT' })
  )
  const pool = new Pool({ connectionString })
  const native = pgDriver(pool)
  let reads = 0
  const driver = {
    ...native,
    query: (...args: Parameters<typeof native.query>) => {
      reads++
      return native.query(...args)
    }
  }
  try {
    const error = await createStorageHost({
      plugins: [
        postgresBackendPlugin({ driver }, { quantized: pgQuantizedFeature({ mode: 'halfvec' }) })
      ] as const
    }).then(
      () => undefined,
      (cause: unknown) => cause
    )
    expect(
      walkErrorCauses(error).some(
        (cause) =>
          typeof cause === 'object' &&
          cause !== null &&
          'code' in cause &&
          cause.code === 'UNSUPPORTED_CAPABILITY'
      )
    ).toBe(true)
    expect(reads).toBe(0)
  } finally {
    await pool.end()
  }
})
