import { QdrantRoute } from './constants.js'
import type { IOperationContext } from '@migaia/storage-contract'
import type { IQdrantHttp, IQdrantOperationName } from './types.js'
/** A finite adapter delegates only actual SDK-shaped methods, without a generic public request API. */
export function nativeHttp(
  invoke: <K extends IQdrantOperationName>(
    operation: K,
    args: readonly unknown[],
    ctx: IOperationContext | undefined
  ) => Promise<Awaited<ReturnType<IQdrantHttp[K]>>>,
  getVersion: IQdrantHttp['getVersion']
): IQdrantHttp {
  return {
    scroll: (collection, parameters, ctx) =>
      invoke(QdrantRoute.scroll.name, [collection, parameters], ctx),
    upsert: (collection, parameters, ctx) =>
      invoke(QdrantRoute.upsert.name, [collection, parameters], ctx),
    delete: (collection, parameters, ctx) =>
      invoke(QdrantRoute.delete.name, [collection, parameters], ctx),
    retrieve: (collection, parameters, ctx) =>
      invoke(QdrantRoute.retrieve.name, [collection, parameters], ctx),
    getCollection: (collection, ctx) => invoke(QdrantRoute.getCollection.name, [collection], ctx),
    createCollection: (collection, parameters, ctx) =>
      invoke(QdrantRoute.createCollection.name, [collection, parameters], ctx),
    getCollections: (ctx) => invoke(QdrantRoute.getCollections.name, [], ctx),
    deleteCollection: (collection, parameters, ctx) =>
      invoke(QdrantRoute.deleteCollection.name, [collection, parameters], ctx),
    query: (collection, parameters, ctx) =>
      invoke(QdrantRoute.query.name, [collection, parameters], ctx),
    recommend: (collection, parameters, ctx) =>
      invoke(QdrantRoute.recommend.name, [collection, parameters], ctx),
    searchPointGroups: (collection, parameters, ctx) =>
      invoke(QdrantRoute.searchPointGroups.name, [collection, parameters], ctx),
    updateVectors: (collection, parameters, ctx) =>
      invoke(QdrantRoute.updateVectors.name, [collection, parameters], ctx),
    updateCollectionAliases: (parameters, ctx) =>
      invoke(QdrantRoute.updateCollectionAliases.name, [parameters], ctx),
    createSnapshot: (collection, parameters, ctx) =>
      invoke(QdrantRoute.createSnapshot.name, [collection, parameters], ctx),
    createPayloadIndex: (collection, parameters, ctx) =>
      invoke(QdrantRoute.createPayloadIndex.name, [collection, parameters], ctx),
    count: (collection, parameters, ctx) =>
      invoke(QdrantRoute.count.name, [collection, parameters], ctx),
    setPayload: (collection, parameters, ctx) =>
      invoke(QdrantRoute.setPayload.name, [collection, parameters], ctx),
    deletePayload: (collection, parameters, ctx) =>
      invoke(QdrantRoute.deletePayload.name, [collection, parameters], ctx),
    getVersion
  } satisfies IQdrantHttp
}
