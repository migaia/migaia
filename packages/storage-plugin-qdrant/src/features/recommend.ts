import { defineFeature, type IStorageFeature } from '@migaia/storage-host'
import type { IOperationContext } from '@migaia/storage-contract'
import { qdrantBackendKind } from '../plugin.ts'
import { readNativeFeaturePort } from '../native-feature.ts'
import { nativeRequest } from '../feature-input.ts'
import type { IQdrantRecommendOutput, IQdrantRecommendRequest } from '../feature-types.ts'
/** Preserve native strategy, lookup and sample semantics instead of replacing the standard chain. */
export function qdrantRecommendFeature(): IStorageFeature<
  typeof qdrantBackendKind,
  IQdrantRecommendOutput
> {
  return defineFeature<typeof qdrantBackendKind, {}, IQdrantRecommendOutput>(
    qdrantBackendKind,
    () => ({
      capabilities: [] as const,
      chain: {},
      api: {
        store: {
          qdrantRecommend: {
            recommend(
              collection: string,
              request: IQdrantRecommendRequest,
              ctx?: IOperationContext
            ) {
              return readNativeFeaturePort(this.store).run(
                'recommend',
                [collection, nativeRequest(request)],
                ctx,
                false
              )
            }
          }
        },
        transaction: {}
      }
    })
  )
}
export type {
  IQdrantRecommendApi,
  IQdrantRecommendRequest,
  IQdrantRecommendResult,
  IQdrantRecommendOutput
} from '../feature-types.ts'
