import { defineFeature, type IStorageFeatureOutput } from '@migaia/storage-host'
import {
  implement,
  vector,
  StorageContractError,
  StorageContractErrorCode,
  type ICapabilityImpl,
  type IVectorApi
} from '@migaia/storage-contract'
import { postgresBackendKind } from '../plugin.js'
import type { IPgNativeVectorApi } from '../types.js'
import { searchPgNativeVector } from '../vector-native.js'
import { PgNames } from '../constants.js'
/**
 * Selecting pgvector adds its actual native collection provider and keeps caller-table methods
 * separate.
 */
export function pgvectorFeature() {
  return defineFeature<
    typeof postgresBackendKind,
    {},
    IStorageFeatureOutput<
      readonly [ICapabilityImpl<typeof vector, IVectorApi<true>>],
      {},
      {
        readonly store: { readonly pgvector: IPgNativeVectorApi }
        readonly transaction: { readonly pgvector: IPgNativeVectorApi }
      }
    >
  >(postgresBackendKind, ({ featureExpose: core }) => {
    core.selectVector()
    /** Factory execution precedes native installation; lookup stays lazy until actual API use. */
    const standard: IVectorApi<true> = {
      collection(...args) {
        const api = core.createVectorApi()
        return api.collection(...args)
      }
    }
    core.registerDetect(async (signal) => {
      core.createVectorApi()
      const row = (
        await core
          .getClient()
          .query("SELECT extversion FROM pg_extension WHERE extname='vector'", [], { signal })
      ).rows[0]
      if (typeof row?.extversion !== 'string')
        throw new StorageContractError(StorageContractErrorCode.unsupported, {
          backend: PgNames.backend
        })
    })
    return {
      capabilities: [implement(vector, standard)] as const,
      chain: {},
      api: {
        store: {
          pgvector: {
            search(target, query, options, ctx) {
              core.assertNativeRoot(this.store)
              return searchPgNativeVector(core.runNative, undefined, target, query, options, ctx)
            }
          }
        },
        transaction: {
          pgvector: {
            search(target, query, options, ctx) {
              core.assertNativeRoot(this.store)
              return searchPgNativeVector(core.runNative, this.scope, target, query, options, ctx)
            }
          }
        }
      }
    }
  })
}
