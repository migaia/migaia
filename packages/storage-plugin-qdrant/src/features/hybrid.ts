import { defineFeature, type IStorageFeature } from '@migaia/storage-host'
import type { IOperationContext } from '@migaia/storage-contract'
import { qdrantBackendKind } from '../plugin.js'
import { readNativeFeaturePort } from '../native-feature.js'
import { nativeRequest, validateBranch, validateSparse } from '../feature-input.js'
import { invalidArgument } from '../errors.js'
import type {
  IQdrantHybridOutput,
  IQdrantHybridRequest,
  IQdrantSparseVectorsRequest
} from '../feature-types.js'
/** Native fusion is distinct from the standard centroid recommendation and top-k grouping chain. */
export function qdrantHybridFeature(): IStorageFeature<
  typeof qdrantBackendKind,
  IQdrantHybridOutput
> {
  return defineFeature<typeof qdrantBackendKind, {}, IQdrantHybridOutput>(
    qdrantBackendKind,
    () => ({
      capabilities: [] as const,
      chain: {},
      api: {
        store: {
          qdrantHybrid: {
            query(collection: string, request: IQdrantHybridRequest, ctx?: IOperationContext) {
              const captured = nativeRequest(request)
              if (
                !Array.isArray(captured.prefetch) ||
                captured.prefetch.length !== 2 ||
                captured.query?.fusion !== 'rrf' ||
                captured.prefetch.some(
                  (branch) => typeof branch.using !== 'string' || Object.hasOwn(branch, 'prefetch')
                )
              )
                throw invalidArgument()
              return readNativeFeaturePort(this.store).run(
                'query',
                [collection, captured],
                ctx,
                false,
                (info) => {
                  const [firstSparse, secondSparse] = captured.prefetch.map((branch) =>
                    validateBranch(branch.using, branch.query, info)
                  )
                  if (firstSparse === secondSparse) throw invalidArgument()
                }
              )
            },
            updateSparseVectors(
              collection: string,
              request: IQdrantSparseVectorsRequest,
              ctx?: IOperationContext
            ) {
              const captured = nativeRequest(request)
              if (!Array.isArray(captured.points)) throw invalidArgument()
              for (const point of captured.points) {
                if (
                  !point.vector ||
                  typeof point.vector !== 'object' ||
                  Array.isArray(point.vector) ||
                  !Object.keys(point.vector).length
                )
                  throw invalidArgument()
                for (const vector of Object.values(point.vector)) validateSparse(vector)
              }
              return readNativeFeaturePort(this.store).run(
                'updateVectors',
                [collection, captured],
                ctx,
                true,
                (info) => {
                  const sparse = info.config.params.sparse_vectors
                  for (const point of captured.points)
                    for (const name of Object.keys(point.vector))
                      if (!sparse || !Object.hasOwn(sparse, name)) throw invalidArgument()
                }
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
  IQdrantHybridBranch,
  IQdrantHybridRequest,
  IQdrantSparseVectorsRequest,
  IQdrantHybridResult,
  IQdrantSparseVectorsResult,
  IQdrantHybridApi,
  IQdrantHybridOutput
} from '../feature-types.js'
