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
  return Object.freeze({
    scroll: (collection, parameters, ctx) => invoke('scroll', [collection, parameters], ctx),
    upsert: (collection, parameters, ctx) => invoke('upsert', [collection, parameters], ctx),
    delete: (collection, parameters, ctx) => invoke('delete', [collection, parameters], ctx),
    retrieve: (collection, parameters, ctx) => invoke('retrieve', [collection, parameters], ctx),
    getCollection: (collection, ctx) => invoke('getCollection', [collection], ctx),
    createCollection: (collection, parameters, ctx) =>
      invoke('createCollection', [collection, parameters], ctx),
    getCollections: (ctx) => invoke('getCollections', [], ctx),
    deleteCollection: (collection, parameters, ctx) =>
      invoke('deleteCollection', [collection, parameters], ctx),
    query: (collection, parameters, ctx) => invoke('query', [collection, parameters], ctx),
    recommend: (collection, parameters, ctx) => invoke('recommend', [collection, parameters], ctx),
    searchPointGroups: (collection, parameters, ctx) =>
      invoke('searchPointGroups', [collection, parameters], ctx),
    updateVectors: (collection, parameters, ctx) =>
      invoke('updateVectors', [collection, parameters], ctx),
    updateCollectionAliases: (parameters, ctx) =>
      invoke('updateCollectionAliases', [parameters], ctx),
    createSnapshot: (collection, parameters, ctx) =>
      invoke('createSnapshot', [collection, parameters], ctx),
    createPayloadIndex: (collection, parameters, ctx) =>
      invoke('createPayloadIndex', [collection, parameters], ctx),
    count: (collection, parameters, ctx) => invoke('count', [collection, parameters], ctx),
    setPayload: (collection, parameters, ctx) =>
      invoke('setPayload', [collection, parameters], ctx),
    deletePayload: (collection, parameters, ctx) =>
      invoke('deletePayload', [collection, parameters], ctx),
    getVersion
  } satisfies IQdrantHttp)
}
