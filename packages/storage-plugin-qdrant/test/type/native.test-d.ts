import { createStorageHost } from '@migaia/storage-host'
import { vector, ttl, type IVectorApi } from '@migaia/storage-contract'
import { qdrantBackendPlugin, type IQdrantStore } from '../../src/index.js'
import { qdrantManagementFeature } from '../../src/features/management.js'
import { qdrantHybridFeature } from '../../src/features/hybrid.js'
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
