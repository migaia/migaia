import { PLUGIN_HOST_SOURCE } from '@migaia/plugin-host'
import { ERROR_SOURCE } from '../src/error-code.js'
import type { Schemas } from '@qdrant/js-client-rest'
import { deferred } from '@migaia/utils/promise'
import { describe, it, expect, vi, onTestFinished } from 'vitest'
import { runConformance } from '@migaia/storage-contract/conformance'
import {
  createStorageHost,
  memoryBackendPlugin,
  createOrgId,
  definePlugin,
  STORAGE_HOST_SOURCE,
  StorageError
} from '@migaia/storage-host'
import { vector, ttl, DeleteCountMode } from '@migaia/storage-contract'
import { lockKey, ConcurrencyPolicy } from '@migaia/storage-host/authoring/concurrency'
import { qdrantBackendPlugin } from '../src/index.js'
import { fetchHttp } from '../src/http.js'
import { qdrantManagementFeature } from '../src/features/management.js'
import { qdrantHybridFeature } from '../src/features/hybrid.js'
import { qdrantRecommendFeature } from '../src/features/recommend.js'
import { qdrantGroupByFeature } from '../src/features/group-by.js'
import { qdrantRescoreFeature } from '../src/features/rescore.js'
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
/** The portable stage runs against this backend's real declared vector and TTL capabilities. */
describe.skipIf(!url)('Qdrant canonical vector subject', () => {
  runConformance(
    { describe, it, expect },
    {
      name: 'real Qdrant vector and TTL',
      capabilities: [vector, ttl],
      features: {
        syncRead: false,
        binary: false,
        records: false,
        transactions: false,
        iteration: false,
        secondaryIndexes: false,
        changeFeed: false,
        maxValueBytes: undefined,
        opaqueEntries: false
      },
      create: async () => {
        const fixture = native()
        const host = await createStorageHost({
          plugins: [
            qdrantBackendPlugin({
              url: url!,
              collectionPrefix: crypto.randomUUID(),
              http: fixture.http
            })
          ] as const
        })
        onTestFinished(async () => {
          try {
            await host.dispose()
          } finally {
            await fixture.close()
          }
        })
        return host.backend('qdrant')
      }
    }
  )
})
describe('real native vector backend', () => {
  it.skipIf(!url)(
    'rescores dense and multivector slots with one filtered native query',
    async () => {
      for (const multivector of [undefined, 'max_sim'] as const) {
        const fixture = native()
        const other = createOrgId()
        const host = await createStorageHost({
          plugins: [
            qdrantBackendPlugin(
              { url: url!, collectionPrefix: crypto.randomUUID(), http: fixture.http },
              {
                rescore: qdrantRescoreFeature({
                  collections: { points: { dimensions: 2, metric: 'dot', multivector } }
                })
              }
            )
          ] as const
        })
        const store = host.backend('qdrant')
        const collection = store
          .use(vector)
          .collection<{ active: boolean; pick?: boolean }>('points', {
            dimensions: 2,
            metric: 'dot'
          })
        const extra = (x: number) =>
          multivector
            ? [
                [x, 0],
                [0, 1]
              ]
            : [x, 0]
        try {
          await collection.upsert([
            { id: 'a', vector: [5, 0], payload: { active: true } },
            { id: 'b', vector: [4, 0], payload: { active: true, pick: false } },
            { id: 'c', vector: [3, 0], payload: { active: true } },
            { id: 'inactive', vector: [100, 0], payload: { active: false } }
          ])
          await collection.upsert([{ id: 'expired', vector: [90, 0], payload: { active: true } }], {
            ttlMs: 0
          })
          if (multivector) {
            const before = fixture.calls.length
            expect(
              await store.api.qdrantRescore.updateVectors('points', [
                {
                  id: 'a',
                  vector: [
                    [0, 0],
                    [0, 1]
                  ]
                }
              ])
            ).toMatchObject({ status: 'completed' })
            expect(fixture.calls.slice(before)).toEqual(['updateVectors'])
          }
          const operation = await store.api.qdrantRescore.updateVectors('points', [
            { id: 'a', vector: extra(0) },
            { id: 'b', vector: extra(3) },
            { id: 'c', vector: extra(2) },
            { id: 'inactive', vector: extra(100) },
            { id: 'expired', vector: extra(90) }
          ])
          expect(operation.status).toBe('completed')
          const foreign = host.org(other).backend('qdrant')
          await foreign
            .use(vector)
            .collection('points')
            .upsert([{ id: 'foreign', vector: [1000, 0], payload: { active: true } }])
          await foreign.api.qdrantRescore.updateVectors('points', [
            { id: 'foreign', vector: extra(1000) }
          ])
          const queryVector = multivector
            ? [
                [1, 0],
                [0, 1]
              ]
            : [1, 0]
          const query = collection
            .near([1, 0])
            .minScore(2.5)
            .where({ active: true })
            .withVector()
            .topK(3)
            .rescore({ query: queryVector, topN: 2 })
          const before = fixture.requests.length
          const hits = await query.all()
          expect(hits.map((hit) => hit.id)).toEqual(['b', 'c'])
          expect(hits.map((hit) => hit.score)).toEqual(multivector ? [4, 3] : [3, 2])
          expect(hits.map((hit) => hit.vector)).toEqual([
            [4, 0],
            [3, 0]
          ])
          const calls = fixture.requests
            .slice(before)
            .filter((request) => request.operation === 'query')
          expect(calls).toHaveLength(1)
          expect(calls[0]!.args[1]).toMatchObject({
            using: QdrantManagedVectorName.rescore,
            limit: 2,
            prefetch: {
              using: QdrantManagedVectorName.search,
              limit: 3,
              score_threshold: 2.5,
              filter: { must: expect.any(Array) }
            }
          })
          expect(JSON.stringify(calls[0]!.args[1])).not.toContain(other)
          expect(JSON.stringify(calls[0]!.args[1])).toContain('$expiresAt')
          expect(await query.rerank(() => [1, 2], { topN: 1 }).all()).toMatchObject([
            { id: 'c', score: multivector ? 3 : 2, rerankScore: 2 }
          ])
          const postFilter = await collection
            .near([1, 0])
            .where({ active: true })
            .where((payload) => payload.pick !== false)
            .topK(3)
            .rescore({
              query: multivector
                ? [
                    [1, 0],
                    [0, 1]
                  ]
                : [1, 0],
              topN: 1
            })
            .all()
          expect(postFilter).toEqual([])
          expect(
            (await collection.near([1, 0]).where({ active: true }).topK(3).all()).map(
              (hit) => hit.id
            )
          ).toEqual(['a', 'b', 'c'])
          const invalidBefore = fixture.requests.length
          await expect(
            store.api.qdrantRescore.updateVectors('points', [
              { id: 'a', vector: multivector ? [1, 0] : [[1, 0]] }
            ])
          ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
          expect(() =>
            collection
              .near([1, 0])
              .topK(3)
              .rescore({ query: [1, 0], topN: 4 })
          ).toThrowError(expect.objectContaining({ code: 'INVALID_ARGUMENT' }))
          expect(fixture.requests).toHaveLength(invalidBefore)
          await collection.upsert([{ id: 'b', vector: [4, 0], payload: { active: true } }])
          expect((await query.all()).some((hit) => hit.id === 'b')).toBe(false)
        } finally {
          await host.dispose()
          await fixture.close()
        }
      }
    }
  )
  it.skipIf(!url)(
    'keeps an existing collection without an extra slot usable and refuses only rescoring',
    async () => {
      const fixture = native()
      const prefix = crypto.randomUUID()
      const first = await createStorageHost({
        plugins: [
          qdrantBackendPlugin({ url: url!, collectionPrefix: prefix, http: fixture.http })
        ] as const
      })
      await first
        .backend('qdrant')
        .use(vector)
        .collection('old', { dimensions: 2, metric: 'dot' })
        .upsert([{ id: 'kept', vector: [1, 0] }])
      await first.dispose()
      const host = await createStorageHost({
        plugins: [
          qdrantBackendPlugin(
            { url: url!, collectionPrefix: prefix, http: fixture.http },
            {
              rescore: qdrantRescoreFeature({
                collections: { old: { dimensions: 2, metric: 'dot' } }
              })
            }
          )
        ] as const
      })
      try {
        const store = host.backend('qdrant')
        const collection = store.use(vector).collection('old')
        expect((await collection.near([1, 0]).topK(1).all())[0]?.id).toBe('kept')
        await expect(
          collection
            .near([1, 0])
            .topK(1)
            .rescore({ query: [1, 0] })
            .all()
        ).rejects.toMatchObject({ code: 'UNSUPPORTED_CAPABILITY' })
        await expect(
          store.api.qdrantRescore.updateVectors('old', [{ id: 'kept', vector: [2, 0] }])
        ).rejects.toMatchObject({ code: 'UNSUPPORTED_CAPABILITY' })
        expect((await collection.near([1, 0]).topK(1).all())[0]?.id).toBe('kept')
      } finally {
        await host.dispose()
        await fixture.close()
      }
    }
  )
  it.skipIf(!url)(
    'retains dense IDs, count validation and native first-occurrence deletion',
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
        collection = host.backend('qdrant').use(vector).collection('capture', {
          dimensions: 1,
          metric: 'dot'
        })
      try {
        await collection.upsert([
          { id: 'source', vector: [1] },
          { id: 'candidate', vector: [2] }
        ])

        expect(
          (
            await collection
              .recommend({ positive: ['source', 'source'] })
              .topK(10)
              .all()
          ).map((hit) => hit.id)
        ).toEqual(['candidate'])
        await collection.delete(['candidate', 'candidate'])
        expect(
          fixture.requests.filter((request) => request.operation === 'delete').at(-1)?.args[1]
        ).toMatchObject({
          filter: { must: expect.arrayContaining([{ must: [{ has_id: [expect.any(String)] }] }]) },
          wait: true
        })
        expect(
          await collection.deleteWhere(
            {},
            {
              count: DeleteCountMode.scroll
            }
          )
        ).toBe(1)
        const before = fixture.calls.length
        const sparse: string[] = []
        sparse.length = 1
        await expect(async () => collection.delete(sparse)).rejects.toMatchObject({
          code: 'INVALID_ARGUMENT'
        })
        await expect(async () =>
          collection.deleteWhere(
            {},
            {
              // The runtime boundary must reject values outside the public enum before native work.
              // @ts-expect-error Deliberate invalid caller input.
              count: 'unknown'
            }
          )
        ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
        expect(fixture.calls).toHaveLength(before)
      } finally {
        await host.dispose()
        await fixture.close()
      }
    },
    30_000
  )
  it.skipIf(!url)(
    'detects required standard methods and rejects missing optional native methods only on use',
    async () => {
      const fixture = native(),
        http = { ...fixture.http }
      Reflect.deleteProperty(http, 'createSnapshot')
      Reflect.deleteProperty(http, 'updateVectors')
      const host = await createStorageHost({
          plugins: [
            qdrantBackendPlugin(
              { url: url!, collectionPrefix: crypto.randomUUID(), http },
              {
                management: qdrantManagementFeature(),
                rescore: qdrantRescoreFeature({
                  collections: { valid: { dimensions: 1, metric: 'dot' } }
                })
              }
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
        await expect(async () =>
          store.api.qdrantRescore.updateVectors('valid', [{ id: 'one', vector: [2] }])
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
          source: PLUGIN_HOST_SOURCE,
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
        /** Observe the actual point TTL read/write requests, not only filtered business hits. */
        const ttlBefore = fixture.requests.length
        expect(await store.use(ttl).expire(lockKey.vector('ttl', 'expired'), 0)).toBe(true)
        expect(fixture.requests.slice(ttlBefore).map((request) => request.operation)).toEqual([
          'retrieve',
          'setPayload'
        ])
        expect(fixture.requests.at(-1)?.args[1]).toMatchObject({
          points: [expect.any(String)],
          payload: { $expiresAt: expect.any(String) },
          wait: true
        })
        expect(await store.use(ttl).remaining(lockKey.vector('ttl', 'expired'))).toBeUndefined()
        expect(await store.use(ttl).persist(lockKey.vector('ttl', 'expired'))).toBe(false)
        expect(fixture.requests.at(-1)?.operation).toBe('retrieve')
        expect(await store.use(ttl).persist(lockKey.vector('ttl', 'live'))).toBe(true)
        expect(fixture.requests.at(-1)?.operation).toBe('deletePayload')
        expect(fixture.requests.at(-1)?.args[1]).toMatchObject({
          points: [expect.any(String)],
          keys: ['"$expiresAt"'],
          wait: true
        })
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
        expect(fixture.requests.at(-1)).toMatchObject({
          operation: 'createCollection',
          args: [name, { vectors: { dense: { size: 2, distance: 'Cosine' } } }]
        })
        expect((await fixture.http.getCollection(name)).config.quantization_config).toMatchObject({
          scalar: { type: 'int8', always_ram: true }
        })
        const alias = name + '_current'
        expect(
          await store.api.qdrantManagement!.updateCollectionAliases({
            actions: [{ create_alias: { collection_name: name, alias_name: alias } }]
          })
        ).toBe(true)
        expect(fixture.requests.at(-1)).toMatchObject({
          operation: 'updateCollectionAliases',
          args: [{ actions: [{ create_alias: { collection_name: name, alias_name: alias } }] }]
        })
        expect((await fixture.http.getCollection(alias)).config.params.vectors).toMatchObject({
          dense: { size: 2, distance: 'Cosine' }
        })
        await store.api.qdrantManagement!.updateCollectionAliases({
          actions: [{ delete_alias: { alias_name: alias } }]
        })
        expect(await store.api.qdrantManagement!.createSnapshot(name, { wait: false })).toBeNull()
        expect(fixture.requests.at(-1)).toMatchObject({
          operation: 'createSnapshot',
          args: [name, { wait: false }]
        })
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
        expect(fixture.requests.at(-1)).toMatchObject({
          operation: 'query',
          args: [
            name,
            {
              query: { fusion: 'rrf' },
              limit: 2,
              prefetch: [
                { query: [1, 0], using: 'dense', limit: 2 },
                { query: { indices: [1], values: [1] }, using: 'sparse', limit: 2 }
              ]
            }
          ]
        })
        await store.api.qdrantHybrid!.updateSparseVectors(name, {
          points: [{ id: 1, vector: { sparse: { indices: [1, 3], values: [2, 3] } } }],
          wait: true
        })
        expect(fixture.requests.at(-1)).toMatchObject({
          operation: 'updateVectors',
          args: [
            name,
            {
              points: [{ id: 1, vector: { sparse: { indices: [1, 3], values: [2, 3] } } }],
              wait: true
            }
          ]
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
        expect(fixture.requests.at(-1)).toMatchObject({
          operation: 'recommend',
          args: [name, { positive: [1], using: 'dense', strategy: 'best_score', limit: 1 }]
        })
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
        expect(fixture.requests.at(-1)).toMatchObject({
          operation: 'searchPointGroups',
          args: [
            name,
            {
              vector: { name: 'dense', vector: [1, 0] },
              group_by: 'category',
              group_size: 2,
              limit: 2
            }
          ]
        })
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

it.skipIf(!url)(
  'resolves competing native collection creation to one actual matching schema',
  async () => {
    const fixture = native()
    const gate = deferred<void>()
    let creates = 0
    const http: IQdrantHttp = {
      ...fixture.http,
      async createCollection(...args) {
        creates += 1
        if (creates === 2) gate.resolve()
        await gate.promise
        return fixture.http.createCollection(...args)
      }
    }
    const prefix = crypto.randomUUID()
    const first = await createStorageHost({
      plugins: [qdrantBackendPlugin({ url: url!, http, collectionPrefix: prefix })] as const
    })
    const second = await createStorageHost({
      plugins: [qdrantBackendPlugin({ url: url!, http, collectionPrefix: prefix })] as const
    })
    try {
      const a = first
        .backend('qdrant')
        .use(vector)
        .collection('race', { dimensions: 2, metric: 'cosine' })
      const b = second
        .backend('qdrant')
        .use(vector)
        .collection('race', { dimensions: 3, metric: 'cosine' })
      const results = await Promise.allSettled([
        a.upsert([{ id: 'two', vector: [1, 0] }]),
        b.upsert([{ id: 'three', vector: [1, 0, 0] }])
      ])
      expect(creates).toBe(2)
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
      const failure = results.find(
        (result) => result.status === 'rejected'
      ) as PromiseRejectedResult
      if (failure.reason.code !== 'INVALID_ARGUMENT') {
        /** This engine reports an initializing collection as native 500, never a confirmed mismatch. */
        expect(failure.reason).toMatchObject({
          source: ERROR_SOURCE,
          code: 'QDRANT_UNAVAILABLE',
          name: 'Error',
          cause: { status: 500, response: expect.any(String) }
        })
      }
      /** An explicit later call reads the actual winner; an unknown modification is never replayed. */
      await expect(
        results[0]!.status === 'rejected'
          ? a.upsert([{ id: 'two', vector: [1, 0] }])
          : b.upsert([{ id: 'three', vector: [1, 0, 0] }])
      ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
      expect(creates).toBe(2)
      expect(fixture.created).toHaveLength(1)
      expect((await fixture.http.count(fixture.created[0]!, { exact: true })).count).toBe(1)
      const stored = (await fixture.http.getCollection(fixture.created[0]!)).config.params
        .vectors as Record<string, Schemas['VectorParams']>
      expect(stored[QdrantManagedVectorName.source]).toMatchObject({
        size: stored[QdrantManagedVectorName.search]!.size,
        distance: 'Dot',
        hnsw_config: { m: 0, payload_m: 0 }
      })
    } finally {
      await first.dispose()
      await second.dispose()
      await fixture.close()
    }
  },
  30_000
)

for (const malformed of ['missing', 'dimension', 'cosine', 'hnsw', 'quantized', 'extra'] as const)
  it.skipIf(!url)(
    'rejects the actual managed native ' + malformed + ' source schema before point writes',
    async () => {
      const fixture = native()
      const http: IQdrantHttp = {
        ...fixture.http,
        createCollection(name, options, ctx) {
          const vectors = structuredClone(options.vectors) as Record<
            string,
            Schemas['VectorParams']
          >
          const source = vectors[QdrantManagedVectorName.source]!
          if (malformed === 'missing') delete vectors[QdrantManagedVectorName.source]
          else if (malformed === 'dimension') source.size = 3
          else if (malformed === 'cosine') source.distance = 'Cosine'
          else if (malformed === 'hnsw') source.hnsw_config = { m: 16, payload_m: 0 }
          else if (malformed === 'quantized')
            source.quantization_config = { scalar: { type: 'int8', always_ram: true } }
          else vectors.extra = { size: 2, distance: 'Dot' }
          return fixture.http.createCollection(name, { ...options, vectors }, ctx)
        }
      }
      const host = await createStorageHost({
        plugins: [
          qdrantBackendPlugin({ url: url!, http, collectionPrefix: crypto.randomUUID() })
        ] as const
      })
      try {
        const collection = host
          .backend('qdrant')
          .use(vector)
          .collection('invalid', { dimensions: 2, metric: 'cosine' })
        await expect(
          collection.upsert([{ id: 'never-written', vector: [1, 0] }])
        ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
        expect(fixture.calls.filter((operation) => operation === 'upsert')).toEqual([])
        expect((await fixture.http.count(fixture.created[0]!, { exact: true })).count).toBe(0)
      } finally {
        await host.dispose()
        await fixture.close()
      }
    },
    30_000
  )

for (const metric of ['cosine', 'dot', 'euclid'] as const)
  it.skipIf(!url)(
    'matches the same public Memory exact query for ' + metric,
    async () => {
      const fixture = native()
      const host = await createStorageHost({
        plugins: [
          memoryBackendPlugin(),
          qdrantBackendPlugin({
            url: url!,
            http: fixture.http,
            collectionPrefix: crypto.randomUUID()
          })
        ] as const
      })
      try {
        const memory = host
          .backend('memory')
          .use(vector)
          .collection<{ group: string }>('same', { dimensions: 2, metric })
        const engine = host
          .backend('qdrant')
          .use(vector)
          .collection<{ group: string }>('same', { dimensions: 2, metric })
        const points = [
          { id: 'a', vector: [3, 1], payload: { group: 'kept' } },
          { id: 'b', vector: [1, 2], payload: { group: 'kept' } },
          { id: 'c', vector: [-2, -1], payload: { group: 'kept' } },
          { id: 'd', vector: [0, -2], payload: { group: 'other' } }
        ]
        await memory.upsert(points)
        await engine.upsert(points)
        for (const collection of [memory, engine]) {
          const hits = await collection.near([2, 1], { exact: true }).topK(4).all()
          const expected = await memory.near([2, 1], { exact: true }).topK(4).all()
          expect(hits.map((hit) => hit.id)).toEqual(expected.map((hit) => hit.id))
          for (const [index, hit] of hits.entries())
            expect(hit.score).toBeCloseTo(expected[index]!.score, 5)
        }
        const execute = async (collection: typeof memory) => {
          const seen: string[] = []
          const hits = await collection
            .near([2, 1], { exact: true })
            .where({ group: 'kept' })
            .where((payload) => {
              seen.push(payload.group)
              return true
            })
            .topK(2)
            .all()
          return { ids: hits.map((hit) => hit.id), seen }
        }
        expect(await execute(engine)).toEqual(await execute(memory))
      } finally {
        await host.dispose()
        await fixture.close()
      }
    },
    30_000
  )
