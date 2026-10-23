import type { QdrantClient } from '@qdrant/js-client-rest'
import {
  vector,
  ttl,
  type IOperationContext,
  type IStorageBase,
  type ICapabilityStore,
  type ICapabilityImpl,
  type IVectorApi,
  type ITtlApi
} from '@migaia/storage-contract'
/** The finite native protocol appends the original context to actual SDK operation signatures. */
export type IQdrantOperation<M extends (...args: never[]) => Promise<unknown>> = (
  ...args: [...Parameters<M>, ctx?: IOperationContext]
) => ReturnType<M>
/** Only these genuine native methods belong to the backend and its closed Features. */
export type IQdrantOperationName =
  | 'scroll'
  | 'upsert'
  | 'delete'
  | 'retrieve'
  | 'getCollection'
  | 'createCollection'
  | 'getCollections'
  | 'deleteCollection'
  | 'query'
  | 'recommend'
  | 'searchPointGroups'
  | 'updateVectors'
  | 'updateCollectionAliases'
  | 'createSnapshot'
  | 'createPayloadIndex'
  | 'count'
  | 'setPayload'
  | 'deletePayload'
export type IQdrantHttp = {
  readonly [K in IQdrantOperationName]: IQdrantOperation<QdrantClient[K]>
} & { getVersion(ctx?: IOperationContext): Promise<string> }
/** Native operation IDs are never interpreted as deleted-point counts. */
export type IQdrantUpdateResult = {
  readonly operationId: number
  readonly status: 'acknowledged' | 'completed'
}

/** Public configuration owns only immutable connection data and a borrowed finite native port. */
export type IQdrantOptions = {
  readonly url: string
  readonly apiKey?: string
  readonly collectionPrefix?: string
  readonly http?: IQdrantHttp
}
/** Native vector/TTL storage publishes no KV, transactions, secondary indexes or change feed. */
export type IQdrantBase = IStorageBase & {
  readonly backend: 'qdrant'
  readonly capabilities: {
    readonly syncRead: false
    readonly binary: false
    readonly records: false
    readonly transactions: false
    readonly iteration: false
    readonly secondaryIndexes: false
    readonly changeFeed: false
    readonly maxValueBytes: undefined
    readonly opaqueEntries: false
  }
}
export type IQdrantStore = ICapabilityStore<
  IQdrantBase,
  typeof vector | typeof ttl,
  readonly [ICapabilityImpl<typeof vector, IVectorApi<true>>, ICapabilityImpl<typeof ttl, ITtlApi>]
>
