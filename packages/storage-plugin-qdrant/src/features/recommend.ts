import { type IStorageFeature } from '@migaia/storage-host'
import type { IOperationContext } from '@migaia/storage-contract'
import { defineQdrantFeature, type IQdrantBackend } from '../plugin.ts'
import { readNativeFeaturePort } from '../native-feature.ts'
import { nativeRequest } from '../feature-input.ts'
import type { IQdrantRecommendOutput, IQdrantRecommendRequest } from '../feature-types.ts'
/** Preserve native strategy, lookup and sample semantics instead of replacing the standard chain. */
export function qdrantRecommendFeature(): IStorageFeature<IQdrantBackend, IQdrantRecommendOutput> {
  return defineQdrantFeature<{}, IQdrantRecommendOutput>(() => ({
    capabilities: [] as const,
    chain: {},
    api: {
      store: {
        qdrantRecommend: {
          recommend(collection: string, request: IQdrantRecommendRequest, ctx?: IOperationContext) {
            return readNativeFeaturePort(this.store).run(
              'query',
              [collection, nativeRequest(request)],
              ctx,
              false
            )
          }
        }
      },
      transaction: {}
    }
  }))
}
export type {
  IQdrantRecommendApi,
  IQdrantRecommendRequest,
  IQdrantRecommendResult,
  IQdrantRecommendOutput
} from '../feature-types.ts'
