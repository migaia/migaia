import { QdrantRoute } from '../constants.js'
import { defineFeature, type IStorageFeature } from '@migaia/storage-host'
import type { IOperationContext, IWriteConcurrencyOptions, IWhere } from '@migaia/storage-contract'
import { qdrantBackendKind } from '../plugin.js'
import { readNativeFeaturePort } from '../native-feature.js'
import { nativeRequest } from '../feature-input.js'
import type { IQdrantHttp } from '../types.js'
import type { IQdrantManagementOutput } from '../feature-types.js'
/**
 * Native management returns real SDK results; only org-constrained deletion is available to org
 * views.
 */
export function qdrantManagementFeature(): IStorageFeature<
  typeof qdrantBackendKind,
  IQdrantManagementOutput
> {
  return defineFeature<typeof qdrantBackendKind, {}, IQdrantManagementOutput>(
    qdrantBackendKind,
    () => ({
      capabilities: [] as const,
      chain: {},
      api: {
        store: {
          qdrantManagement: {
            getCollections(ctx?: IOperationContext) {
              return readNativeFeaturePort(this.store).run(
                QdrantRoute.getCollections.name,
                [],
                ctx,
                false
              )
            },
            createCollection(
              collection: string,
              request: Parameters<IQdrantHttp['createCollection']>[1],
              ctx?: IOperationContext
            ) {
              return readNativeFeaturePort(this.store).run(
                'createCollection',
                [collection, nativeRequest(request)],
                ctx,
                true
              )
            },
            deleteCollection(
              collection: string,
              request?: Parameters<IQdrantHttp['deleteCollection']>[1],
              ctx?: IOperationContext
            ) {
              return readNativeFeaturePort(this.store).run(
                'deleteCollection',
                [collection, request === undefined ? undefined : nativeRequest(request)],
                ctx,
                true
              )
            },
            updateCollectionAliases(
              request: Parameters<IQdrantHttp['updateCollectionAliases']>[0],
              ctx?: IOperationContext
            ) {
              return readNativeFeaturePort(this.store).run(
                'updateCollectionAliases',
                [nativeRequest(request)],
                ctx,
                true
              )
            },
            createSnapshot(
              collection: string,
              request?: Parameters<IQdrantHttp['createSnapshot']>[1],
              ctx?: IOperationContext
            ) {
              return readNativeFeaturePort(this.store).run(
                'createSnapshot',
                [collection, request === undefined ? undefined : nativeRequest(request)],
                ctx,
                true
              )
            },
            deleteByFilter<TPayload>(
              collection: string,
              where: IWhere<TPayload>,
              options?: {
                readonly wait?: boolean
                readonly ordering?: 'weak' | 'medium' | 'strong'
              },
              ctx?: IOperationContext & IWriteConcurrencyOptions
            ) {
              return readNativeFeaturePort(this.store).managedDelete(
                collection,
                where,
                options,
                ctx,
                false
              )
            },
            purgeExpired(
              collection: string,
              options?: { readonly wait?: boolean },
              ctx?: IOperationContext & IWriteConcurrencyOptions
            ) {
              return readNativeFeaturePort(this.store).managedDelete(
                collection,
                undefined,
                options,
                ctx,
                true
              )
            }
          }
        },
        transaction: {}
      }
    })
  )
}
export type { IQdrantManagementApi, IQdrantManagementOutput } from '../feature-types.js'
