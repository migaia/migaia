import { createStorageHost } from '@migaia/storage-host'
import { qdrantBackendPlugin } from '@migaia/storage-plugin-qdrant'
import { qdrantManagementFeature } from '@migaia/storage-plugin-qdrant/features/management'
import { qdrantHybridFeature } from '@migaia/storage-plugin-qdrant/features/hybrid'
import { qdrantRecommendFeature } from '@migaia/storage-plugin-qdrant/features/recommend'
import { qdrantGroupByFeature } from '@migaia/storage-plugin-qdrant/features/group-by'
/** Check emitted declarations in a real consumer rather than widening its host or Feature types. */
export async function publicTypes() {
  const plugin = qdrantBackendPlugin(
    { url: 'http://127.0.0.1:6333' },
    {
      management: qdrantManagementFeature(),
      hybrid: qdrantHybridFeature(),
      recommend: qdrantRecommendFeature(),
      groups: qdrantGroupByFeature()
    }
  )
  const host = await createStorageHost({ plugins: [plugin] as const })
  void host.backend('qdrant').api.qdrantManagement
}
