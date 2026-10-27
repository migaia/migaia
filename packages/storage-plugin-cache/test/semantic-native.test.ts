import { describe, expect, it } from 'vitest'
import { createStorageHost } from '@migaia/storage-host'
import { memoryBackendPlugin } from '@migaia/storage-host/plugins/memory'
import { DeleteCountMode } from '@migaia/storage-contract'
import { qdrantBackendPlugin, type IQdrantHttp } from '@migaia/storage-plugin-qdrant'
import { fetchHttp } from '@migaia/storage-plugin-qdrant/http'
import { cachePlugin } from '@migaia/storage-plugin-cache'
import { semanticCacheFeature } from '@migaia/storage-plugin-cache/features/semantic'

/** Native service configuration comes only from the existing shared storage-services launcher. */
const url = process.env.MIGAIA_QDRANT_URL

/** Keep genuine HTTP operations and interpose only finite observations around actual native results. */
async function fixture() {
  /** This direct public port remains the fixture's cleanup and physical-count authority. */
  const native = fetchHttp(url!)
  /** Every physical collection in this list was created through this fresh fixture's namespace. */
  const created: string[] = []
  /** Wire observations prove which native count/deletion strategy the semantic call actually used. */
  const events: string[] = []
  /** Actual ranking requests prove semantic reads use the selected vector engine. */
  const rankings: Parameters<IQdrantHttp['query']>[] = []
  /** A selected real result can admit one concurrent writer before the backend resumes. */
  let afterCount: (() => Promise<void>) | undefined
  let afterScroll: (() => Promise<void>) | undefined
  /** Every override forwards the exact public native arguments without inventing engine results. */
  const http: IQdrantHttp = {
    ...native,
    async createCollection(...args) {
      const result = await native.createCollection(...args)
      created.push(args[0])
      return result
    },
    async query(...args) {
      rankings.push(args)
      return native.query(...args)
    },
    async upsert(...args) {
      events.push('upsert')
      return native.upsert(...args)
    },
    async count(...args) {
      events.push('count')
      const result = await native.count(...args)
      const selected = afterCount
      afterCount = undefined
      await selected?.()
      return result
    },
    async scroll(...args) {
      events.push('scroll')
      const result = await native.scroll(...args)
      const selected = afterScroll
      afterScroll = undefined
      await selected?.()
      return result
    },
    async delete(...args) {
      events.push('delete')
      return native.delete(...args)
    }
  }
  /** The Memory value tier and Qdrant vector backend are published before the cache batch. */
  const initial = await createStorageHost({
    plugins: [
      memoryBackendPlugin({ id: 'values' }),
      qdrantBackendPlugin({ id: 'vectors', url: url!, http, collectionPrefix: crypto.randomUUID() })
    ] as const
  })
  const host = await initial.use(
    cachePlugin(
      { tiers: [{ backend: 'values' }], propagate: false },
      {
        semantic: semanticCacheFeature({
          backend: 'vectors',
          collection: 'answers',
          dimensions: 2,
          minScore: 0.5,
          ttlMs: 60_000,
          embed: async () => [1, 0]
        })
      }
    )
  )
  await host.detect()
  return {
    host,
    native,
    created,
    events,
    rankings,
    semantic: host.backend('cache').api.semantic,
    foreign: host.org('11111111-1111-4111-8111-111111111111').backend('cache').api.semantic,
    afterCount: (write: () => Promise<void>) => {
      afterCount = write
    },
    afterScroll: (write: () => Promise<void>) => {
      afterScroll = write
    },
    close: async () => {
      await host.dispose()
      for (const name of created) await native.deleteCollection(name)
    }
  }
}

describe('semantic invalidation over real Qdrant', () => {
  it.skipIf(!url)(
    'uses default, precount and scroll native numbers while including expired physical points only in the selected org',
    async () => {
      const current = await fixture()
      try {
        for (const count of [
          undefined,
          DeleteCountMode.precount,
          DeleteCountMode.scroll
        ] as const) {
          await current.semantic.set('live', 'local live', {
            payload: { model: 'm1', kind: 'live' }
          })
          await current.semantic.getOrLoad('expired', async () => 'local expired', {
            payload: { model: 'm1', kind: 'expired' },
            where: { kind: 'missing' },
            ttlMs: 0
          })
          await current.foreign.set('live', 'foreign live', {
            payload: { model: 'm1', kind: 'live' }
          })
          await current.foreign.getOrLoad('expired', async () => 'foreign expired', {
            payload: { model: 'm1', kind: 'expired' },
            where: { kind: 'missing' },
            ttlMs: 0
          })
          current.rankings.length = 0
          expect(await current.semantic.get('live', { where: { kind: 'live' } })).toMatchObject({
            value: 'local live'
          })
          expect(current.rankings).toHaveLength(1)
          expect(current.rankings[0]?.[1]).toMatchObject({
            query: [1, 0],
            using: 'migaia_search',
            limit: 1,
            score_threshold: 0.5,
            filter: { must: expect.any(Array) }
          })
          expect(JSON.stringify(current.rankings[0]?.[1])).toContain('live')
          expect(JSON.stringify(current.rankings[0]?.[1])).toContain('$expiresAt')
          expect(
            await current.semantic.get('expired', { where: { kind: 'expired' } })
          ).toBeUndefined()
          expect((await current.native.count(current.created[0]!, { exact: true })).count).toBe(4)
          current.events.length = 0
          const pending: Promise<number> =
            count === undefined
              ? current.semantic.invalidate({ model: 'm1' })
              : current.semantic.invalidate({ model: 'm1' }, { count })
          expect(await pending).toBe(2)
          expect(current.events).toEqual(
            count === DeleteCountMode.scroll ? ['scroll', 'delete'] : ['count', 'delete']
          )
          expect(await current.semantic.get('live', { where: { model: 'm1' } })).toBeUndefined()
          expect(await current.foreign.get('live', { where: { kind: 'live' } })).toMatchObject({
            value: 'foreign live'
          })
          expect((await current.native.count(current.created[0]!, { exact: true })).count).toBe(2)
        }
      } finally {
        await current.close()
      }
    },
    30_000
  )

  it.skipIf(!url)(
    'preserves the precount and collected-ID concurrency boundaries without recounting or switching modes',
    async () => {
      const current = await fixture()
      try {
        for (const count of [DeleteCountMode.precount, DeleteCountMode.scroll] as const) {
          await current.semantic.set('live', 'original', { payload: { model: 'm1', kind: 'live' } })
          await current.semantic.getOrLoad('expired', async () => 'expired', {
            payload: { model: 'm1', kind: 'expired' },
            where: { kind: 'missing' },
            ttlMs: 0
          })
          const concurrent = () =>
            current.semantic.set('concurrent', 'new', { payload: { model: 'm1', kind: 'new' } })
          if (count === DeleteCountMode.precount) current.afterCount(concurrent)
          else current.afterScroll(concurrent)
          current.events.length = 0
          expect(await current.semantic.invalidate({ model: 'm1' }, { count })).toBe(2)
          expect(current.events).toEqual(
            count === DeleteCountMode.precount
              ? ['count', 'upsert', 'delete']
              : ['scroll', 'upsert', 'delete']
          )
          if (count === DeleteCountMode.precount) {
            expect((await current.native.count(current.created[0]!, { exact: true })).count).toBe(0)
            expect(await current.semantic.get('concurrent')).toBeUndefined()
          } else {
            expect((await current.native.count(current.created[0]!, { exact: true })).count).toBe(1)
            expect(
              await current.semantic.get('concurrent', { where: { kind: 'new' } })
            ).toMatchObject({ value: 'new' })
          }
        }
      } finally {
        await current.close()
      }
    },
    30_000
  )
})
