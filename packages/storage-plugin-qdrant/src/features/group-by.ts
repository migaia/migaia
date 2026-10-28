import { defineFeature, type IStorageFeature } from '@migaia/storage-host'
import type { IOperationContext } from '@migaia/storage-contract'
import { qdrantBackendKind } from '../plugin.ts'
import { readNativeFeaturePort } from '../native-feature.ts'
import { nativeRequest } from '../feature-input.ts'
import { invalidArgument } from '../errors.ts'
import type { IQdrantGroupByOutput, IQdrantGroupByRequest } from '../feature-types.ts'
/** Native multivalue groups retain Qdrant's result shape; the SDK's dropped lookup option is absent. */
export function qdrantGroupByFeature(): IStorageFeature<
  typeof qdrantBackendKind,
  IQdrantGroupByOutput
> {
  return defineFeature<typeof qdrantBackendKind, {}, IQdrantGroupByOutput>(
    qdrantBackendKind,
    () => ({
      capabilities: [] as const,
      chain: {},
      api: {
        store: {
          qdrantGroupBy: {
            search(collection: string, request: IQdrantGroupByRequest, ctx?: IOperationContext) {
              const captured = nativeRequest(request)
              if (Object.hasOwn(captured, 'with_lookup')) throw invalidArgument()
              return readNativeFeaturePort(this.store).run(
                'searchPointGroups',
                [collection, captured],
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
  IQdrantGroupByApi,
  IQdrantGroupByRequest,
  IQdrantGroupByResult,
  IQdrantGroupByOutput
} from '../feature-types.ts'
