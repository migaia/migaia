import type { QdrantClient } from '@qdrant/js-client-rest'
import type { IOperationContext } from '@migaia/storage-contract'
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
