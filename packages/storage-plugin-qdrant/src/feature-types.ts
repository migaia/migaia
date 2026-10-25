import type { QdrantClient, Schemas } from '@qdrant/js-client-rest'
import type {
  IOperationContext,
  IWriteConcurrencyOptions,
  IWhere,
  IVectorQuery,
  IVectorNativeQuery
} from '@migaia/storage-contract'
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
/** Each selected logical collection has one extra native slot, independent of its search metric. */
export type IQdrantRescoreSlot = {
  readonly dimensions: number
  readonly metric?: 'cosine' | 'dot' | 'euclid'
  readonly multivector?: 'max_sim'
}
/** Configuration is captured before native collection creation; existing data is never migrated. */
export type IQdrantRescoreOptions = {
  readonly collections: Readonly<Record<string, IQdrantRescoreSlot>>
}
/** The selected slot decides whether one vector or a nonempty matrix is accepted. */
export type IQdrantRescoreVector = readonly number[] | readonly (readonly number[])[]
/** Native vector updates address original logical identities within the exact organization. */
export type IQdrantRescorePoint = { readonly id: string; readonly vector: IQdrantRescoreVector }
/** The original query owns the recall bound; this stage only chooses its final prefix. */
export type IQdrantRescoreQueryOptions = {
  readonly query: IQdrantRescoreVector
  readonly topN?: number
}
/** The actual native operation record is never interpreted as a point count. */
export type IQdrantRescoreResult = Awaited<ReturnType<IQdrantHttp['updateVectors']>>
/** Extra-slot writes reuse the installed backend's original operation and resource owner. */
export type IQdrantRescoreApi = {
  updateVectors(
    collection: string,
    points: readonly IQdrantRescorePoint[],
    ctx?: IOperationContext
  ): Promise<IQdrantRescoreResult>
}
/** The explicit receiver prevents pre-topK and post-readonly stages from regaining native writes. */
export type IQdrantRescoreMethods = {
  rescore<P, G extends boolean, V extends boolean, M extends object>(
    this: IVectorQuery<P, G, V, M>,
    options: IQdrantRescoreQueryOptions
  ): IVectorNativeQuery<P, G, V, M>
}
/** Private captured options have no setters, backend handles or registration authority. */
export type IQdrantRescoreConfiguration = Readonly<
  Record<
    string,
    Readonly<{
      dimensions: number
      metric: 'cosine' | 'dot' | 'euclid'
      multivector?: 'max_sim'
    }>
  >
>
