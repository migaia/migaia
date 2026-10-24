import assert from 'node:assert/strict'
import { createStorageHost, createOrgId } from '@migaia/storage-host'
import { vector, ttl, lockKey, DeleteCountMode } from '@migaia/storage-contract'
import { qdrantBackendPlugin, ERROR_SOURCE, type IQdrantHttp } from '@migaia/storage-plugin-qdrant'
import { fetchHttp } from '@migaia/storage-plugin-qdrant/http'
import { qdrantClientHttp } from '@migaia/storage-plugin-qdrant/client'
import { qdrantManagementFeature } from '@migaia/storage-plugin-qdrant/features/management'
import { qdrantHybridFeature } from '@migaia/storage-plugin-qdrant/features/hybrid'
import { qdrantRecommendFeature } from '@migaia/storage-plugin-qdrant/features/recommend'
import { qdrantGroupByFeature } from '@migaia/storage-plugin-qdrant/features/group-by'
import { qdrantRescoreFeature } from '@migaia/storage-plugin-qdrant/features/rescore'
import { QdrantClient } from '@qdrant/js-client-rest'
/** The shared service launcher supplies every runtime's identical native endpoint. */
const url = process.env.MIGAIA_QDRANT_URL
assert.ok(url, 'configured native Qdrant service required')
assert.equal(ERROR_SOURCE, 'storage.backend.qdrant')
/** One function boundary keeps actual public consumer inference independent of the transport loop. */
async function exercise(native: IQdrantHttp, url: string): Promise<void> {
  const created: string[] = [],
    http: IQdrantHttp = {
      ...native,
      createCollection: async (...args: Parameters<typeof native.createCollection>) => {
        const result = await native.createCollection(...args)
        created.push(args[0])
        return result
      }
    },
    org = createOrgId()
  const plugin = qdrantBackendPlugin(
    { url, http, collectionPrefix: crypto.randomUUID() },
    {
      management: qdrantManagementFeature(),
      hybrid: qdrantHybridFeature(),
      recommend: qdrantRecommendFeature(),
      groups: qdrantGroupByFeature(),
      rescore: qdrantRescoreFeature({ collections: { runtime: { dimensions: 2, metric: 'dot' } } })
    }
  )
  const host = await createStorageHost({ org, plugins: [plugin] as const })
  try {
    const store = host.backend('qdrant'),
      collection = store
        .use(vector)
        .collection<{ kind: string }>('runtime', { dimensions: 2, metric: 'cosine' })
    await collection.upsert([
      { id: 'one\ud800', vector: [100, 0], payload: { kind: 'same' } },
      { id: 'two', vector: [0, 1], payload: { kind: 'same' } }
    ])
    const hits = await collection.near([1, 0], { exact: true }).topK(2).withVector().all()
    assert.equal(hits[0]!.id, 'one\ud800')
    assert.deepEqual(hits[0]!.vector, [100, 0])
    await store.api.qdrantRescore.updateVectors('runtime', [
      { id: 'one\ud800', vector: [1, 0] },
      { id: 'two', vector: [4, 0] }
    ])
    const rescored = await collection
      .near([1, 0])
      .topK(2)
      .rescore({ query: [1, 0], topN: 1 })
      .rerank(() => [9])
      .first()
    assert.equal(rescored!.id, 'two')
    assert.equal(rescored!.score, 4)
    assert.equal(rescored!.rerankScore, 9)
    assert.equal(await store.use(ttl).expire(lockKey.vector('runtime', 'two'), 0), true)
    assert.equal((await collection.near([1, 0]).topK(2).all()).length, 1)
    assert.equal(
      await collection.deleteWhere({ kind: 'same' }, { count: DeleteCountMode.scroll }),
      2
    )
    assert.equal(typeof store.api.qdrantManagement!.purgeExpired, 'function')
    assert.equal('transaction' in store, false)
    assert.equal('deleteByFilter' in store, false)
    await host.dropOrg(org)
  } finally {
    await host.dispose()
    for (const name of created) await native.deleteCollection(name)
  }
  assert.match(await native.getVersion(), /^1\./)
}
for (const port of [fetchHttp(url), qdrantClientHttp(new QdrantClient({ url }))])
  await exercise(port, url)
console.log('qdrant native runtime PASS: HTTP + borrowed SDK')
