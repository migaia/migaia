import { createStorageHost } from '@migaia/storage-host'
import { vector, ttl, type IVectorApi } from '@migaia/storage-contract'
import { qdrantBackendPlugin, type IQdrantStore } from '../../src/index.ts'
import { qdrantManagementFeature } from '../../src/features/management.ts'
import { qdrantHybridFeature } from '../../src/features/hybrid.ts'
import { qdrantRescoreFeature } from '../../src/features/rescore.ts'
/** Compile the actual native store with a nonempty Feature projection. No runtime work occurs. */
export async function nativeTypes() {
  const host = await createStorageHost({
      plugins: [
        qdrantBackendPlugin(
          { url: 'http://127.0.0.1:6333' },
          { management: qdrantManagementFeature(), hybrid: qdrantHybridFeature() }
        )
      ] as const
    }),
    store = host.backend('qdrant')
  const base: IQdrantStore = store,
    api: IVectorApi<true> = store.use(vector)
  void base
  void api
  void store.use(ttl)
  const count: Promise<number> = api
    .collection('points', { dimensions: 2, metric: 'dot' })
    .deleteWhere({})
  const record = store.api.qdrantManagement!.deleteByFilter('points', {})
  void count
  void record
  // @ts-expect-error Native vector storage exposes no transaction method.
  store.transaction(() => undefined)
  // @ts-expect-error Filter operation records exist only on the selected management Feature.
  store.deleteByFilter('points', {})
  // @ts-expect-error Hybrid has exactly two branches, preserving the native tuple constraint.
  store.api.qdrantHybrid!.query('native', { prefetch: [], query: { fusion: 'rrf' } })
}

/** Preserve the selected chain instead of erasing it through an unaugmented vector API annotation. */
export async function nativeRescoreTypes() {
  const host = await createStorageHost({
    plugins: [
      qdrantBackendPlugin(
        { url: 'http://127.0.0.1:6333' },
        {
          rescore: qdrantRescoreFeature({
            collections: { points: { dimensions: 2, metric: 'dot' } }
          })
        }
      )
    ] as const
  })
  const store = host.backend('qdrant')
  const builder = store.use(vector).collection<{ active: boolean }>('points').near([1, 0])
  const rescored = builder
    .withVector()
    .topK(3)
    .rescore({ query: [1, 0], topN: 2 })
  const chained = rescored.rerank(({ hits }) => hits.map((hit) => hit.vector[0]!))
  const values: Promise<
    readonly {
      readonly id: string
      readonly score: number
      readonly rerankScore: number
      readonly vector: readonly number[]
      readonly payload?: { active: boolean }
    }[]
  > = chained.all()
  void values
  void store.api.qdrantRescore.updateVectors('points', [{ id: 'one', vector: [1, 0] }])
  // @ts-expect-error A native Feature still requires an existing topK bound.
  builder.rescore({ query: [1, 0] })
  // @ts-expect-error Native rescoring is a read-only stage.
  rescored.delete()
  // @ts-expect-error A read-only native stage cannot add another native rescore.
  rescored.rescore({ query: [1, 0] })
  // @ts-expect-error Generic reranking cannot regain native rescoring.
  chained.rescore({ query: [1, 0] })
}
