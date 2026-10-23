import { describe, it, expect, vi } from 'vitest'
import {
  createStorageHost,
  createOrgId,
  definePlugin,
  STORAGE_HOST_SOURCE,
  StorageError
} from '@migaia/storage-host'
import { vector, ttl, lockKey, DeleteCountMode, ConcurrencyPolicy } from '@migaia/storage-contract'
import { qdrantBackendPlugin } from '../src/index.js'
import { fetchHttp } from '../src/http.js'
import { qdrantManagementFeature } from '../src/features/management.js'
import { qdrantHybridFeature } from '../src/features/hybrid.js'
import { qdrantRecommendFeature } from '../src/features/recommend.js'
import { qdrantGroupByFeature } from '../src/features/group-by.js'
import { nativeHttp } from '../src/native.js'
import { QdrantManagedVectorName } from '../src/constants.js'
import type { IQdrantHttp } from '../src/types.js'
/** Real service addresses come exclusively from the shared fixture launcher. */
const url = process.env.MIGAIA_QDRANT_URL
/** Cleanup is restricted to fresh collection names created by this exact fixture. */
function native() {
  const original = fetchHttp(url!),
    created: string[] = [],
    calls: string[] = [],
    requests: { operation: string; args: readonly unknown[] }[] = []
  const http = nativeHttp(
    async (operation, args, ctx): Promise<Awaited<ReturnType<IQdrantHttp[typeof operation]>>> => {
      calls.push(operation)
      requests.push({ operation, args })
      const result = await Reflect.apply(original[operation], original, [...args, ctx])
      if (operation === 'createCollection') created.push(args[0] as string)
      return result as Awaited<ReturnType<IQdrantHttp[typeof operation]>>
    },
    async (ctx) => {
      calls.push('version')
      return original.getVersion(ctx)
    }
  )
  return {
    http,
    created,
    calls,
    requests,
    close: async () => {
      for (const name of created) await original.deleteCollection(name)
    }
  }
}
describe('real native vector backend', () => {
  it.skipIf(!url)(
    'detects required standard methods and rejects missing optional native methods only on use',
    async () => {
      const fixture = native(),
        http = { ...fixture.http }
      Reflect.deleteProperty(http, 'createSnapshot')
      const host = await createStorageHost({
          plugins: [
            qdrantBackendPlugin(
              { url: url!, collectionPrefix: crypto.randomUUID(), http },
              { management: qdrantManagementFeature() }
            )
          ] as const
        }),
        store = host.backend('qdrant')
      try {
        const collection = store.use(vector).collection('valid', { dimensions: 1, metric: 'dot' })
        await collection.upsert([{ id: 'one', vector: [1] }])
        const before = fixture.calls.length
        await expect(async () =>
          store.api.qdrantManagement!.createSnapshot(fixture.created[0]!, { wait: true })
        ).rejects.toMatchObject({ code: 'UNSUPPORTED_CAPABILITY' })
        expect(fixture.calls).toHaveLength(before)
      } finally {
        await host.dispose()
        await fixture.close()
      }
    },
    30_000
  )
  it.skipIf(!url)(
    'retains native precount divergence and the actual multi-page scroll collection boundary',
    async () => {
      const fixture = native()
      let afterCount: (() => Promise<void>) | undefined,
        afterFirstPage: (() => Promise<void>) | undefined,
        beforeDelete: (() => Promise<void>) | undefined
      const http: IQdrantHttp = {
          ...fixture.http,
          async count(...args) {
            const result = await fixture.http.count(...args),
              work = afterCount
            afterCount = undefined
            await work?.()
            return result
          },
          async scroll(...args) {
            const result = await fixture.http.scroll(...args),
              work = afterFirstPage
            afterFirstPage = undefined
            await work?.()
            return result
          },
          async delete(...args) {
            const work = beforeDelete
            beforeDelete = undefined
            await work?.()
            return fixture.http.delete(...args)
          }
        },
        host = await createStorageHost({
          plugins: [
            qdrantBackendPlugin({ url: url!, collectionPrefix: crypto.randomUUID(), http })
          ] as const
        }),
        store = host.backend('qdrant'),
        collection = store
          .use(vector)
          .collection<{ tag: string }>('boundary', { dimensions: 1, metric: 'dot' })
      try {
        await collection.upsert([{ id: 'pre-1', vector: [1], payload: { tag: 'pre' } }])
        afterCount = () =>
          collection.upsert([{ id: 'pre-2', vector: [1], payload: { tag: 'pre' } }])
        expect(await collection.deleteWhere({ tag: 'pre' })).toBe(1)
        expect(await collection.near([1]).where({ tag: 'pre' }).topK(10).all()).toEqual([])
        const initial = Array.from({ length: 300 }, (_, index) => ({
          id: `page-${index}`,
          vector: [1],
          payload: { tag: 'match' }
        }))
        await collection.upsert(initial)
        const nativeRequest = fixture.requests
            .filter((request) => request.operation === 'upsert')
            .at(-1)!.args[1] as Parameters<IQdrantHttp['upsert']>[1],
          points = 'points' in nativeRequest ? nativeRequest.points : [],
          ordered = points
            .map((point, index) => ({ physical: String(point.id), logical: initial[index]!.id }))
            .sort((a, b) => (a.physical < b.physical ? -1 : 1)),
          low = ordered[0]!.logical,
          high = ordered.at(-1)!.logical,
          changed = ordered[1]!.logical
        await collection.delete([low, high])
        await store.use(ttl).expire(lockKey.vector('boundary', ordered[2]!.logical), 0)
        afterFirstPage = () =>
          collection.upsert([
            { id: low, vector: [1], payload: { tag: 'match' } },
            { id: high, vector: [1], payload: { tag: 'match' } },
            { id: changed, vector: [1], payload: { tag: 'other' } }
          ])
        beforeDelete = () =>
          collection.upsert([{ id: 'after-collection', vector: [1], payload: { tag: 'match' } }])
        const before = fixture.requests.length
        expect(
          await collection.deleteWhere(
            { tag: { startsWith: 'mat' } },
            { count: DeleteCountMode.scroll }
          )
        ).toBe(299)
        const pages = fixture.requests
          .slice(before)
          .filter((request) => request.operation === 'scroll')
        expect(pages).toHaveLength(2)
        expect(JSON.stringify(pages.map((request) => request.args))).not.toContain('$expiresAt')
        expect(
          (await collection.near([1], { exact: true }).topK(10).all()).map((hit) => hit.id).sort()
        ).toEqual([low, 'after-collection'].sort())
        expect(await collection.near([1]).where({ tag: 'other' }).topK(10).all()).toEqual([])
      } finally {
        await host.dispose()
        await fixture.close()
      }
    },
    30_000
  )
  it.skipIf(!url)(
    'uses one client clock for expiry retention and tenant-only native purge records',
    async () => {
      const fixture = native(),
        org = createOrgId(),
        other = createOrgId(),
        host = await createStorageHost({
          org,
          plugins: [
            qdrantBackendPlugin(
              { url: url!, collectionPrefix: crypto.randomUUID(), http: fixture.http },
              { management: qdrantManagementFeature() }
            )
          ] as const
        }),
        store = host.backend('qdrant'),
        collection = store.use(vector).collection('clock', { dimensions: 1, metric: 'dot' }),
        peer = host.org(other).backend('qdrant'),
        otherCollection = peer.use(vector).collection('clock'),
        now = Date.now(),
        clock = vi.spyOn(Date, 'now').mockReturnValue(now)
      try {
        await collection.upsert([{ id: 'future', vector: [1] }], { ttlMs: 3_000 })
        await collection.upsert([{ id: 'past', vector: [2] }], { ttlMs: 0 })
        await otherCollection.upsert([{ id: 'past', vector: [3] }], { ttlMs: 0 })
        clock.mockReturnValue(now + 500)
        await collection.upsert([
          { id: 'future', vector: [4] },
          { id: 'unlimited', vector: [5] }
        ])
        expect(await store.use(ttl).remaining(lockKey.vector('clock', 'future'))).toBe(2_500)
        expect(await store.use(ttl).remaining(lockKey.vector('clock', 'unlimited'))).toBeUndefined()
        const written = fixture.requests.filter((request) => request.operation === 'upsert'),
          request = written[3]!.args[1] as Parameters<IQdrantHttp['upsert']>[1],
          points = 'points' in request ? request.points : []
        expect(points).toHaveLength(2)
        expect(points[0]!.payload?.$expiresAt).toBe(new Date(now + 3_000).toISOString())
        expect(points[1]!.payload).not.toHaveProperty('$expiresAt')
        const before = fixture.requests.length
        expect(await store.api.qdrantManagement!.purgeExpired('clock')).toMatchObject({
          status: 'completed',
          operationId: expect.any(Number)
        })
        expect(fixture.requests.slice(before).map((request) => request.operation)).toEqual([
          'delete'
        ])
        const removal = fixture.requests[before]!.args[1] as Parameters<IQdrantHttp['delete']>[1]
        expect(removal).toEqual({
          filter: {
            must: [
              { key: '"$org"', match: { value: org } },
              {
                must: [{ key: '"$expiresAt"', range: { lt: new Date(now + 500).toISOString() } }]
              }
            ]
          },
          wait: true
        })
        expect(await collection.search([1], { k: 10, exact: true })).toHaveLength(2)
        expect(
          await peer.api.qdrantManagement!.purgeExpired('clock', { wait: false })
        ).toMatchObject({
          status: 'acknowledged'
        })
        expect(await store.api.qdrantManagement!.purgeExpired('clock')).toMatchObject({
          status: 'completed'
        })
        clock.mockReturnValue(now - 1_000)
        expect(await store.use(ttl).remaining(lockKey.vector('clock', 'future'))).toBe(4_000)
        clock.mockReturnValue(now + 4_000)
        expect(await collection.search([1], { k: 10, exact: true })).toMatchObject([
          { id: 'unlimited' }
        ])
        await expect(async () =>
          store.use(ttl).expire({ channel: 'text', key: 'unlimited' }, 0)
        ).rejects.toMatchObject({ code: 'UNSUPPORTED_CAPABILITY' })
        await expect(async () =>
          collection.upsert([{ id: 'invalid', vector: [1], payload: { $expiresAt: 'bad' } }])
        ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
        const saved = store.api.qdrantManagement!.purgeExpired,
          primary = store.dispose(),
          symbolic = store[Symbol.asyncDispose]()
        expect(store.dispose()).toBe(primary)
        expect(store[Symbol.asyncDispose]()).toBe(symbolic)
        expect(symbolic).not.toBe(primary)
        await primary
        await symbolic
        await expect(async () => saved('clock')).rejects.toMatchObject({ code: 'STORE_DISPOSED' })
        await host.dispose()
        const disposedCalls = fixture.calls.length
        await expect(async () => saved('clock')).rejects.toMatchObject({
          source: '@migaia/plugin-host',
          code: 'PLUGIN_NOT_INSTALLED'
        })
        expect(fixture.calls).toHaveLength(disposedCalls)
      } finally {
        clock.mockRestore()
        await host.dispose()
        await fixture.close()
      }
    },
    30_000
  )
  it.skipIf(!url)(
    'keeps native metrics, unnormalized samples, portable payloads, filters and immutable standard chains',
    async () => {
      const fixture = native(),
        host = await createStorageHost({
          plugins: [
            qdrantBackendPlugin({
              url: url!,
              collectionPrefix: crypto.randomUUID(),
              http: fixture.http
            })
          ] as const
        }),
        store = host.backend('qdrant')
      try {
        for (const metric of ['cosine', 'dot', 'euclid'] as const) {
          const collection = store.use(vector).collection<{
              category: string
              price: number
              nested: { 'a.b': string }
              nullable: null
            }>(metric, { dimensions: 2, metric }),
            payload = {
              category: 'a',
              price: 4.25,
              nested: { 'a.b': 'surrogate \ud800' },
              nullable: null
            }
          await collection.upsert([
            { id: 'one\ud800', vector: [100, 0], payload },
            { id: 'two\udc00', vector: [0, 1], payload: { ...payload, category: 'b', price: 8 } },
            { id: 'three', vector: [1, 1], payload: { ...payload, price: 12 } }
          ])
          const query = collection.near([1, 0], { exact: true }),
            filtered = query.where({ price: { gte: 8 } }).topK(1)
          expect(filtered.explain().pushed.some((step) => step.operation === 'where')).toBe(true)
          expect((await filtered.all())[0]!.id).not.toBe('one\ud800')
          const hits = await query.topK(3).withVector().all()
          expect(hits).toHaveLength(3)
          expect(hits.find((hit) => hit.id === 'one\ud800')!.vector).toEqual([100, 0])
          expect(hits.find((hit) => hit.id === 'one\ud800')!.payload).toEqual(payload)
          expect(
            (await collection.similarTo('one\ud800').topK(3).all()).some(
              (hit) => hit.id === 'one\ud800'
            )
          ).toBe(false)
          expect(
            (
              await collection
                .recommend({ positive: ['one\ud800'], negative: ['two\udc00'] })
                .topK(3)
                .all()
            ).map((hit) => hit.id)
          ).toEqual(['three'])
          expect(await query.topK(3).groupBy('category', { perGroup: 1 }).all()).toHaveLength(2)
          const client = query.where({ category: { contains: 'a' } }).topK(3)
          expect(client.explain().client.some((step) => step.operation === 'where')).toBe(true)
          const before = fixture.calls.length
          await expect(client.requirePushdown().all()).rejects.toMatchObject({
            code: 'QUERY_NOT_PUSHABLE'
          })
          expect(fixture.calls).toHaveLength(before)
          const zero = fixture.calls.filter((call) => call === 'query').length
          expect(await collection.search([1, 0], { k: 0 })).toEqual([])
          expect(fixture.calls.filter((call) => call === 'query')).toHaveLength(zero)
          await expect(async () =>
            collection.upsert([{ id: 'bad', vector: [1, Number.NaN], payload }])
          ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
        }
        const recommendation = store
          .use(vector)
          .collection('amplitude', { dimensions: 2, metric: 'cosine' })
        await recommendation.upsert([
          { id: 'p1', vector: [100, 0] },
          { id: 'p2', vector: [0, 1] },
          { id: 'c1', vector: [1, 0] },
          { id: 'c2', vector: [1, 1] }
        ])
        const beforeSamples = fixture.requests.length
        expect(
          (
            await recommendation
              .recommend({ positive: ['p1', 'p2'] })
              .topK(1)
              .withVector()
              .all()
          )[0]!.id
        ).toBe('c1')
        const requests = fixture.requests.slice(beforeSamples)
        for (const request of requests.filter((item) => item.operation === 'retrieve'))
          expect(request.args[1]).toMatchObject({ with_vector: [QdrantManagedVectorName.source] })
        expect(requests.find((request) => request.operation === 'query')!.args[1]).toMatchObject({
          using: QdrantManagedVectorName.search,
          with_vector: [QdrantManagedVectorName.source]
        })
        const saved = store.use(vector).collection('cosine').near([1, 0]).topK(1)
        await host.dispose()
        await expect(saved.all()).rejects.toMatchObject({ code: 'STORE_DISPOSED' })
      } finally {
        await host.dispose()
        await fixture.close()
      }
    },
    30_000
  )
  it.skipIf(!url)(
    'separates organization points and physical expired deletion with both numeric strategies and native records',
    async () => {
      const fixture = native(),
        org = createOrgId(),
        other = createOrgId(),
        host = await createStorageHost({
          org,
          plugins: [
            qdrantBackendPlugin(
              { url: url!, collectionPrefix: crypto.randomUUID(), http: fixture.http },
              { management: qdrantManagementFeature() }
            )
          ] as const
        }),
        store = host.backend('qdrant'),
        collection = store
          .use(vector)
          .collection<{ tag: string }>('ttl', { dimensions: 2, metric: 'dot' })
      try {
        await collection.upsert([
          { id: 'live', vector: [1, 0], payload: { tag: 'match' } },
          { id: 'expired', vector: [1, 0], payload: { tag: 'match' } }
        ])
        expect(await store.use(ttl).expire(lockKey.vector('ttl', 'expired'), 0)).toBe(true)
        expect(await store.use(ttl).remaining(lockKey.vector('ttl', 'expired'))).toBeUndefined()
        expect(await store.use(ttl).persist(lockKey.vector('ttl', 'expired'))).toBe(false)
        expect(await collection.near([1, 0]).topK(10).all()).toHaveLength(1)
        const borrowed = host.org(other).backend('qdrant'),
          otherCollection = borrowed.use(vector).collection<{ tag: string }>('ttl')
        const ddl = fixture.calls.filter(
          (call) => call === 'createCollection' || call === 'createPayloadIndex'
        ).length
        await otherCollection.upsert([{ id: 'live', vector: [0, 1], payload: { tag: 'match' } }])
        expect(
          fixture.calls.filter(
            (call) => call === 'createCollection' || call === 'createPayloadIndex'
          )
        ).toHaveLength(ddl)
        expect(await otherCollection.near([1, 0]).topK(10).all()).toHaveLength(1)
        const before = fixture.calls.length
        expect(await collection.deleteWhere({ tag: 'match' })).toBe(2)
        expect(fixture.calls.slice(before)).toEqual(['count', 'delete'])
        expect(await otherCollection.near([1, 0]).topK(10).all()).toHaveLength(1)
        await collection.upsert([
          { id: 'one', vector: [1, 0], payload: { tag: 'match' } },
          { id: 'two', vector: [1, 0], payload: { tag: 'other' } }
        ])
        expect(
          await collection.deleteWhere(
            { tag: { startsWith: 'mat' } },
            { count: DeleteCountMode.scroll }
          )
        ).toBe(1)
        await expect(async () =>
          collection.deleteWhere({ tag: { startsWith: 'oth' } })
        ).rejects.toMatchObject({
          code: 'UNSUPPORTED_CAPABILITY'
        })
        const record = await store.api.qdrantManagement!.deleteByFilter('ttl', { tag: 'other' })
        expect(record).toMatchObject({ status: 'completed', operationId: expect.any(Number) })
        await collection.upsert([{ id: 'purge', vector: [1, 0], payload: { tag: 'past' } }], {
          ttlMs: 0
        })
        expect(await store.api.qdrantManagement!.purgeExpired('ttl')).toMatchObject({
          status: 'completed'
        })
        await expect(async () =>
          borrowed.api.qdrantManagement!.getCollections()
        ).rejects.toMatchObject({
          code: 'UNSUPPORTED_CAPABILITY'
        })
        await expect(async () =>
          collection.upsert([], { concurrency: ConcurrencyPolicy.optimistic() })
        ).rejects.toMatchObject({ code: 'UNSUPPORTED_CAPABILITY' })
      } finally {
        await host.dispose()
        await fixture.close()
      }
    },
    30_000
  )
  it.skipIf(!url)(
    'executes all four native Feature families without changing managed vector formats',
    async () => {
      const fixture = native(),
        host = await createStorageHost({
          plugins: [
            qdrantBackendPlugin(
              { url: url!, http: fixture.http },
              {
                hybrid: qdrantHybridFeature(),
                recommend: qdrantRecommendFeature(),
                groups: qdrantGroupByFeature(),
                management: qdrantManagementFeature()
              }
            )
          ] as const
        }),
        store = host.backend('qdrant'),
        name = 'features_' + crypto.randomUUID().replaceAll('-', '')
      try {
        expect(
          await store.api.qdrantManagement!.createCollection(name, {
            vectors: { dense: { size: 2, distance: 'Cosine' } },
            sparse_vectors: { sparse: {} },
            quantization_config: { scalar: { type: 'int8', always_ram: true } }
          })
        ).toBe(true)
        expect((await fixture.http.getCollection(name)).config.quantization_config).toMatchObject({
          scalar: { type: 'int8', always_ram: true }
        })
        const alias = name + '_current'
        expect(
          await store.api.qdrantManagement!.updateCollectionAliases({
            actions: [{ create_alias: { collection_name: name, alias_name: alias } }]
          })
        ).toBe(true)
        expect((await fixture.http.getCollection(alias)).config.params.vectors).toMatchObject({
          dense: { size: 2, distance: 'Cosine' }
        })
        await store.api.qdrantManagement!.updateCollectionAliases({
          actions: [{ delete_alias: { alias_name: alias } }]
        })
        expect(await store.api.qdrantManagement!.createSnapshot(name, { wait: false })).toBeNull()
        await fixture.http.upsert(name, {
          points: [
            {
              id: 1,
              vector: { dense: [1, 0], sparse: { indices: [1], values: [1] } },
              payload: { category: ['a', 'b'] }
            },
            {
              id: 2,
              vector: { dense: [0, 1], sparse: { indices: [2], values: [1] } },
              payload: { category: ['b'] }
            }
          ],
          wait: true
        })
        expect(
          (
            await store.api.qdrantHybrid!.query(name, {
              prefetch: [
                { query: [1, 0], using: 'dense', limit: 2 },
                { query: { indices: [1], values: [1] }, using: 'sparse', limit: 2 }
              ],
              query: { fusion: 'rrf' },
              limit: 2
            })
          ).points
        ).toHaveLength(2)
        await store.api.qdrantHybrid!.updateSparseVectors(name, {
          points: [{ id: 1, vector: { sparse: { indices: [1, 3], values: [2, 3] } } }],
          wait: true
        })
        expect(
          (await fixture.http.retrieve(name, { ids: [1], with_vector: true }))[0]!.vector
        ).toMatchObject({ dense: [1, 0], sparse: { indices: [1, 3], values: [2, 3] } })
        expect(
          await store.api.qdrantRecommend!.recommend(name, {
            positive: [1],
            using: 'dense',
            strategy: 'best_score',
            limit: 1
          })
        ).toHaveLength(1)
        expect(
          (
            await store.api.qdrantGroupBy!.search(name, {
              vector: { name: 'dense', vector: [1, 0] },
              group_by: 'category',
              group_size: 2,
              limit: 2
            })
          ).groups
        ).toHaveLength(2)
        const before = fixture.calls.length
        await expect(
          store.api.qdrantHybrid!.updateSparseVectors(name, {
            points: [{ id: 1, vector: { dense: { indices: [1], values: [1] } } }]
          })
        ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
        expect(fixture.calls.slice(before)).toEqual(['getCollection'])
        const hybridBefore = fixture.calls.length
        await expect(
          store.api.qdrantHybrid!.query(name, {
            prefetch: [
              { query: [1, 0], using: 'dense', limit: 2 },
              { query: [0, 1], using: 'dense', limit: 2 }
            ],
            query: { fusion: 'rrf' },
            limit: 1
          })
        ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
        expect(fixture.calls.slice(hybridBefore)).toEqual(['getCollection'])
      } finally {
        await host.dispose()
        await fixture.close()
      }
    },
    30_000
  )
  it.skipIf(!url)(
    'discovers schemas after restart without new-org DDL and drops every owned collection without touching another namespace',
    async () => {
      const fixture = native(),
        prefix = crypto.randomUUID(),
        org = createOrgId(),
        other = createOrgId()
      const first = await createStorageHost({
        org,
        plugins: [
          qdrantBackendPlugin({ url: url!, collectionPrefix: prefix, http: fixture.http })
        ] as const
      })
      const foreign = await createStorageHost({
        org,
        plugins: [
          qdrantBackendPlugin({
            url: url!,
            collectionPrefix: crypto.randomUUID(),
            http: fixture.http
          })
        ] as const
      })
      let restarted: typeof first | undefined
      try {
        for (const name of ['known', 'unseen']) {
          const collection = first
            .backend('qdrant')
            .use(vector)
            .collection<{ tag: string }>(name, { dimensions: 2, metric: 'cosine' })
          await collection.upsert([{ id: 'live', vector: [2, 0], payload: { tag: 'match' } }])
          await collection.upsert([{ id: 'expired', vector: [0, 2], payload: { tag: 'match' } }], {
            ttlMs: 0
          })
          const peer = first
            .org(other)
            .backend('qdrant')
            .use(vector)
            .collection<{ tag: string }>(name)
          await peer.upsert([{ id: 'live', vector: [0, 2], payload: { tag: 'other' } }])
        }
        const foreignCollection = foreign
          .backend('qdrant')
          .use(vector)
          .collection('known', { dimensions: 2, metric: 'dot' })
        await foreignCollection.upsert([{ id: 'live', vector: [9, 0] }])
        await first.dispose()
        restarted = await createStorageHost({
          org,
          plugins: [
            qdrantBackendPlugin({ url: url!, collectionPrefix: prefix, http: fixture.http })
          ] as const
        })
        const ddl = fixture.calls.filter(
          (call) => call === 'createCollection' || call === 'createPayloadIndex'
        ).length
        const peer = restarted
          .org(other)
          .backend('qdrant')
          .use(vector)
          .collection<{ tag: string }>('known')
        await peer.upsert([{ id: 'new', vector: [1, 1], payload: { tag: 'other' } }])
        expect(
          fixture.calls.filter(
            (call) => call === 'createCollection' || call === 'createPayloadIndex'
          )
        ).toHaveLength(ddl)
        expect(await peer.search([1, 0], { k: 1 })).toHaveLength(1)
        await restarted.dropOrg(org)
        for (const name of ['known', 'unseen']) {
          expect(
            await restarted
              .backend('qdrant')
              .use(vector)
              .collection(name)
              .near([1, 0])
              .topK(10)
              .all()
          ).toEqual([])
          expect(
            await restarted
              .org(other)
              .backend('qdrant')
              .use(vector)
              .collection(name)
              .near([1, 0])
              .topK(10)
              .all()
          ).not.toHaveLength(0)
        }
        expect(await foreignCollection.near([1, 0]).topK(1).all()).toHaveLength(1)
      } finally {
        await first.dispose()
        await restarted?.dispose()
        await foreign.dispose()
        await fixture.close()
      }
    },
    30_000
  )
  it.skipIf(!url)(
    'keeps explicit detection, one actual pipeline transform, and original business errors without native traffic',
    async () => {
      const fixture = native(),
        business = new RangeError('pipeline business failed'),
        stack = business.stack,
        counts = new Map<string, number>()
      let fail = true
      const stage = definePlugin('transform', (core) => ({
        install() {
          core.useAsyncPipeline(async (input, next) => {
            counts.set(input.operation, (counts.get(input.operation) ?? 0) + 1)
            if (fail) throw business
            await next(
              input.operation === 'vector.upsert'
                ? {
                    ...input,
                    input: [{ id: 'changed', vector: [0, 1], payload: { category: 'new' } }]
                  }
                : input
            )
          })
          return {}
        }
      }))
      const host = await createStorageHost({
          autoDetect: false,
          plugins: [
            qdrantBackendPlugin({
              url: url!,
              collectionPrefix: crypto.randomUUID(),
              http: fixture.http
            }),
            stage
          ] as const
        }),
        store = host.backend('qdrant'),
        collection = store
          .use(vector)
          .collection<{ category: string }>('pipeline', { dimensions: 2, metric: 'dot' })
      try {
        expect(fixture.calls).toEqual([])
        await expect(async () =>
          collection.upsert([{ id: 'old', vector: [1, 0], payload: { category: 'old' } }])
        ).rejects.toMatchObject({ code: 'UNSUPPORTED_CAPABILITY' })
        expect(fixture.calls).toEqual([])
        await host.detect()
        expect(fixture.calls).toEqual(['version'])
        fixture.calls.length = 0
        let failure: unknown
        try {
          await collection.upsert([{ id: 'old', vector: [1, 0], payload: { category: 'old' } }])
        } catch (error) {
          failure = error
        }
        expect(failure).toBeInstanceOf(StorageError)
        expect((failure as StorageError).code).toBe('EXTENSION_FAILED')
        expect((failure as StorageError).source).toBe(STORAGE_HOST_SOURCE)
        expect((failure as StorageError).cause).toBe(business)
        expect(business).toBeInstanceOf(RangeError)
        expect(business.stack).toBe(stack)
        expect(fixture.calls).toEqual([])
        fail = false
        await collection.upsert([{ id: 'old', vector: [1, 0], payload: { category: 'old' } }])
        expect(await collection.near([0, 1]).topK(1).withVector().all()).toEqual([
          { id: 'changed', score: 1, vector: [0, 1], payload: { category: 'new' } }
        ])
        expect(counts.get('vector.upsert')).toBe(2)
      } finally {
        await host.dispose()
        await fixture.close()
      }
    },
    30_000
  )
})
