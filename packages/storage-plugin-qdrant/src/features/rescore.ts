import { defineFeature, type IStorageFeatureOutput } from '@migaia/storage-host'
import { refineStorageVectorQuery, snapshotStorageVectorCollection } from '@migaia/storage-contract'
import { qdrantBackendKind } from '../plugin.js'
import { readNativeFeaturePort } from '../native-feature.js'
import {
  snapshotRescoreOptions,
  snapshotRescorePoints,
  snapshotRescoreVector
} from '../feature-input.js'
import { capture, invalidArgument } from '../errors.js'
import { QdrantText } from '../constants.js'
import type {
  IQdrantRescoreOptions,
  IQdrantRescoreMethods,
  IQdrantRescoreApi
} from '../feature-types.js'
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
            const captured = capture(() => {
              const { query, topN } = options
              return { query: snapshotRescoreVector(query), topN }
            })
            return refineStorageVectorQuery(this, (topK) => {
              const topN = captured.topN === undefined ? topK : captured.topN
              if (!Number.isSafeInteger(topN) || topN < 1 || topN > topK) throw invalidArgument()
              return {
                native: Object.freeze({ kind: QdrantText.rescore, query: captured.query, topN }),
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
} from '../feature-types.js'
