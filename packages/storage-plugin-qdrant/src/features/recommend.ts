import { type IStorageFeature } from '@migaia/storage-host'
import type { IOperationContext } from '@migaia/storage-contract'
import { defineQdrantFeature, type IQdrantBackend } from '../plugin.ts'
import { readNativeFeaturePort } from '../native-feature.ts'
import { nativeRequest } from '../feature-input.ts'
import { invalidArgument } from '../errors.ts'
import type { IQdrantRecommendOutput, IQdrantRecommendRequest } from '../feature-types.ts'

/** Validates that a captured request is a plain object carrying a non-null `query.recommend` object. */
function isRecommendRequest(value: unknown): value is IQdrantRecommendRequest {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  if (!Object.hasOwn(value, 'query')) return false
  /** Query object inside the recommend request. */
  const query = (value as Record<string, unknown>).query
  if (query === null || typeof query !== 'object' || Array.isArray(query)) return false
  if (!Object.hasOwn(query, 'recommend')) return false
  /** Recommend payload inside `query`. */
  const recommend = (query as Record<string, unknown>).recommend
  return recommend !== null && typeof recommend === 'object' && !Array.isArray(recommend)
}

/** Preserve native strategy, lookup and sample semantics instead of replacing the standard chain. */
export function qdrantRecommendFeature(): IStorageFeature<IQdrantBackend, IQdrantRecommendOutput> {
  return defineQdrantFeature<{}, IQdrantRecommendOutput>(() => ({
    capabilities: [] as const,
    chain: {},
    api: {
      store: {
        qdrantRecommend: {
          /** Runs a native Qdrant recommend query after validating the `query.recommend` envelope. */
          recommend(collection: string, request: IQdrantRecommendRequest, ctx?: IOperationContext) {
            if (request === null || typeof request !== 'object' || Array.isArray(request))
              throw invalidArgument()
            /** Captured portable recommend request validated before dispatch. */
            const captured = nativeRequest(request)
            if (!isRecommendRequest(captured)) throw invalidArgument()
            return readNativeFeaturePort(this.store).run(
              'query',
              [collection, captured],
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
