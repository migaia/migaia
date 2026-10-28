import { defineFeature, type IStorageFeatureOutput } from '@migaia/storage-host'
import { refineStorageVectorQuery, snapshotStorageVectorCollection } from '@migaia/storage-host/sdk'
import { qdrantBackendKind } from '../plugin.ts'
import { readNativeFeaturePort } from '../native-feature.ts'
import {
  snapshotRescoreOptions,
  snapshotRescorePoints,
  snapshotRescoreVector
} from '../feature-input.ts'
import { invalidArgument } from '../errors.ts'
import { QdrantText } from '../constants.ts'
import type {
  IQdrantRescoreOptions,
  IQdrantRescoreMethods,
  IQdrantRescoreApi
} from '../feature-types.ts'
/** Extra vectors and their native ranking reuse the original installed backend and query nodes. */
export function qdrantRescoreFeature(options: IQdrantRescoreOptions) {
  const configuration = snapshotRescoreOptions(options)
  return defineFeature<
    typeof qdrantBackendKind,
    {},
    IStorageFeatureOutput<
      readonly [],
      { readonly vector: IQdrantRescoreMethods },
      { readonly store: { readonly qdrantRescore: IQdrantRescoreApi }; readonly transaction: {} }
    >
  >(qdrantBackendKind, ({ featureExpose: core }) => {
    core.selectRescore(configuration)
    return {
      capabilities: [] as const,
      chain: {
        vector: {
          rescore(options) {
            const captured = (function readAcceptedInput() {
              const { query, topN } = options
              return { query: snapshotRescoreVector(query), topN }
            })()
            return refineStorageVectorQuery(this, (topK) => {
              const topN = captured.topN === undefined ? topK : captured.topN
              if (!Number.isSafeInteger(topN) || topN < 1 || topN > topK) throw invalidArgument()
              return {
                native: { kind: QdrantText.rescore, query: captured.query, topN },
                topN
              }
            })
          }
        }
      },
      api: {
        store: {
          qdrantRescore: {
            updateVectors(collection, points, ctx) {
              const name = snapshotStorageVectorCollection(
                collection,
                undefined,
                QdrantText.backend
              ).name
              const captured = snapshotRescorePoints(points)
              return readNativeFeaturePort(this.store).updateRescoreVectors(name, captured, ctx)
            }
          }
        },
        transaction: {}
      }
    }
  })
}
export type {
  IQdrantRescoreOptions,
  IQdrantRescoreSlot,
  IQdrantRescoreVector,
  IQdrantRescorePoint,
  IQdrantRescoreQueryOptions,
  IQdrantRescoreMethods,
  IQdrantRescoreApi,
  IQdrantRescoreResult
} from '../feature-types.ts'
