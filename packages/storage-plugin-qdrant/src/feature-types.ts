import type { QdrantClient, Schemas } from '@qdrant/js-client-rest'
import type { IOperationContext, IWriteConcurrencyOptions, IWhere } from '@migaia/storage-contract'
import type { IStorageFeatureOutput } from '@migaia/storage-host'
import type { IQdrantHttp, IQdrantUpdateResult } from './types.js'
export type IQdrantHybridBranch = Omit<Schemas['Prefetch'], 'prefetch' | 'query' | 'using'> & {
  query: Schemas['VectorInput']
  using: string
}
export type IQdrantHybridRequest = Omit<
  Parameters<QdrantClient['query']>[1],
  'query' | 'prefetch'
> & { query: Schemas['FusionQuery']; prefetch: [IQdrantHybridBranch, IQdrantHybridBranch] }
export type IQdrantSparseVectorsRequest = Omit<
  Parameters<QdrantClient['updateVectors']>[1],
  'points'
> & {
  points: Array<
    Omit<Schemas['PointVectors'], 'vector'> & {
      vector: { [name: string]: Schemas['SparseVector'] }
    }
  >
}
export type IQdrantHybridResult = Awaited<ReturnType<QdrantClient['query']>>
export type IQdrantSparseVectorsResult = Awaited<ReturnType<QdrantClient['updateVectors']>>
export type IQdrantHybridApi = {
  query(
    collection: string,
    request: IQdrantHybridRequest,
    ctx?: IOperationContext
  ): Promise<IQdrantHybridResult>
  updateSparseVectors(
    collection: string,
    request: IQdrantSparseVectorsRequest,
    ctx?: IOperationContext
  ): Promise<IQdrantSparseVectorsResult>
}
export type IQdrantHybridOutput = IStorageFeatureOutput<
  readonly [],
  {},
  { readonly store: { readonly qdrantHybrid: IQdrantHybridApi }; readonly transaction: {} }
>
export type IQdrantRecommendRequest = Parameters<QdrantClient['recommend']>[1]
export type IQdrantRecommendResult = Awaited<ReturnType<QdrantClient['recommend']>>
export type IQdrantRecommendApi = {
  recommend(
    collection: string,
    request: IQdrantRecommendRequest,
    ctx?: IOperationContext
  ): Promise<IQdrantRecommendResult>
}
export type IQdrantRecommendOutput = IStorageFeatureOutput<
  readonly [],
  {},
  { readonly store: { readonly qdrantRecommend: IQdrantRecommendApi }; readonly transaction: {} }
>
export type IQdrantGroupByRequest = Omit<
  Parameters<QdrantClient['searchPointGroups']>[1],
  'with_lookup'
>
export type IQdrantGroupByResult = Awaited<ReturnType<QdrantClient['searchPointGroups']>>
export type IQdrantGroupByApi = {
  search(
    collection: string,
    request: IQdrantGroupByRequest,
    ctx?: IOperationContext
  ): Promise<IQdrantGroupByResult>
}
export type IQdrantGroupByOutput = IStorageFeatureOutput<
  readonly [],
  {},
  { readonly store: { readonly qdrantGroupBy: IQdrantGroupByApi }; readonly transaction: {} }
>
export type IQdrantManagementApi = Pick<
  IQdrantHttp,
  | 'getCollections'
  | 'createCollection'
  | 'deleteCollection'
  | 'updateCollectionAliases'
  | 'createSnapshot'
> & {
  deleteByFilter<TPayload>(
    collection: string,
    where: IWhere<TPayload>,
    options?: { readonly wait?: boolean; readonly ordering?: 'weak' | 'medium' | 'strong' },
    ctx?: IOperationContext & IWriteConcurrencyOptions
  ): Promise<IQdrantUpdateResult>
  purgeExpired(
    collection: string,
    options?: { readonly wait?: boolean },
    ctx?: IOperationContext & IWriteConcurrencyOptions
  ): Promise<IQdrantUpdateResult>
}
export type IQdrantManagementOutput = IStorageFeatureOutput<
  readonly [],
  {},
  { readonly store: { readonly qdrantManagement: IQdrantManagementApi }; readonly transaction: {} }
>
