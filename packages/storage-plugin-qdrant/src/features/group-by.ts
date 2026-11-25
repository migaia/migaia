import { type IStorageFeature } from '@migaia/storage-host'
import type { IOperationContext } from '@migaia/storage-contract'
import { defineQdrantFeature, type IQdrantBackend } from '../plugin.ts'
import { readNativeFeaturePort } from '../native-feature.ts'
import { nativeRequest } from '../feature-input.ts'
import { invalidArgument } from '../errors.ts'
import type { IQdrantGroupByOutput, IQdrantGroupByRequest } from '../feature-types.ts'
/** Native multivalue groups retain Qdrant's result shape; cross-collection lookup is disallowed. */
export function qdrantGroupByFeature(): IStorageFeature<IQdrantBackend, IQdrantGroupByOutput> {
  return defineQdrantFeature<{}, IQdrantGroupByOutput>(() => ({
    capabilities: [] as const,
    chain: {},
    api: {
      store: {
        qdrantGroupBy: {
          /**
           * Runs a native Qdrant group-by query, rejecting non-object requests and disallowed
           * cross-collection lookup.
           */
          search(collection: string, request: IQdrantGroupByRequest, ctx?: IOperationContext) {
            if (request === null || typeof request !== 'object' || Array.isArray(request))
              throw invalidArgument()
            /** Captured portable group-by request validated before dispatch. */
            const captured = nativeRequest(request)
            if (captured === null || typeof captured !== 'object' || Array.isArray(captured))
              throw invalidArgument()
            if (Object.hasOwn(captured, 'with_lookup')) throw invalidArgument()
            return readNativeFeaturePort(this.store).run(
              'queryGroups',
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
  IQdrantGroupByApi,
  IQdrantGroupByRequest,
  IQdrantGroupByResult,
  IQdrantGroupByOutput
} from '../feature-types.ts'
