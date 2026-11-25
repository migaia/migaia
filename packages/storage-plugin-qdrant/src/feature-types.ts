import type { QdrantClient, Schemas } from '@qdrant/js-client-rest'
import type {
  IOperationContext,
  IWriteConcurrencyOptions,
  IWhere,
  IVectorQuery,
  IVectorNativeQuery
} from '@migaia/storage-contract'
import type { IStorageFeatureOutput } from '@migaia/storage-host'
import type { IQdrantHttp, IQdrantUpdateResult } from './types.ts'
/** Single dense or sparse prefetch branch inside a native two-branch hybrid fusion request. */
export type IQdrantHybridBranch = Omit<Schemas['Prefetch'], 'prefetch' | 'query' | 'using'> & {
  query: Schemas['VectorInput']
  using: string
}
/** Native two-branch RRF hybrid query request forwarded to Qdrant's `points/query` endpoint. */
export type IQdrantHybridRequest = Omit<
  Parameters<QdrantClient['query']>[1],
  'query' | 'prefetch'
> & { query: Schemas['FusionQuery']; prefetch: [IQdrantHybridBranch, IQdrantHybridBranch] }
/** Native sparse-vector batch update request targeting named sparse slots on a collection. */
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
/** Native Qdrant query response returned by `qdrantHybrid.query`. */
export type IQdrantHybridResult = Awaited<ReturnType<QdrantClient['query']>>
/** Native Qdrant vector update response returned by `qdrantHybrid.updateSparseVectors`. */
export type IQdrantSparseVectorsResult = Awaited<ReturnType<QdrantClient['updateVectors']>>
/** Store API contributed by the Qdrant hybrid fusion feature. */
export type IQdrantHybridApi = {
  /** Runs a two-branch RRF hybrid query against `collection`. */
  query(
    collection: string,
    request: IQdrantHybridRequest,
    ctx?: IOperationContext
  ): Promise<IQdrantHybridResult>
  /** Updates named sparse vectors on existing points in `collection`. */
  updateSparseVectors(
    collection: string,
    request: IQdrantSparseVectorsRequest,
    ctx?: IOperationContext
  ): Promise<IQdrantSparseVectorsResult>
}
/** Feature output descriptor for the Qdrant hybrid fusion feature. */
export type IQdrantHybridOutput = IStorageFeatureOutput<
  readonly [],
  {},
  { readonly store: { readonly qdrantHybrid: IQdrantHybridApi }; readonly transaction: {} }
>
/** Native Qdrant recommend query request carrying a `query.recommend` payload. */
export type IQdrantRecommendRequest = Omit<Parameters<QdrantClient['query']>[1], 'query'> & {
  query: Schemas['RecommendQuery']
}
/** Native Qdrant query response returned by `qdrantRecommend.recommend`. */
export type IQdrantRecommendResult = Awaited<ReturnType<QdrantClient['query']>>
/** Store API contributed by the Qdrant recommend feature. */
export type IQdrantRecommendApi = {
  /** Executes a native recommend query against `collection`. */
  recommend(
    collection: string,
    request: IQdrantRecommendRequest,
    ctx?: IOperationContext
  ): Promise<IQdrantRecommendResult>
}
/** Feature output descriptor for the Qdrant recommend feature. */
export type IQdrantRecommendOutput = IStorageFeatureOutput<
  readonly [],
  {},
  { readonly store: { readonly qdrantRecommend: IQdrantRecommendApi }; readonly transaction: {} }
>
/** Native Qdrant group-by query request with cross-collection `with_lookup` omitted. */
export type IQdrantGroupByRequest = Omit<Parameters<QdrantClient['queryGroups']>[1], 'with_lookup'>
/** Native Qdrant grouped query response returned by `qdrantGroupBy.search`. */
export type IQdrantGroupByResult = Awaited<ReturnType<QdrantClient['queryGroups']>>
/** Store API contributed by the Qdrant group-by feature. */
export type IQdrantGroupByApi = {
  /** Runs a native group-by query against `collection`. */
  search(
    collection: string,
    request: IQdrantGroupByRequest,
    ctx?: IOperationContext
  ): Promise<IQdrantGroupByResult>
}
/** Feature output descriptor for the Qdrant group-by feature. */
export type IQdrantGroupByOutput = IStorageFeatureOutput<
  readonly [],
  {},
  { readonly store: { readonly qdrantGroupBy: IQdrantGroupByApi }; readonly transaction: {} }
>
/** Store API contributed by the Qdrant native management and maintenance feature. */
export type IQdrantManagementApi = Pick<
  IQdrantHttp,
  | 'getCollections'
  | 'createCollection'
  | 'deleteCollection'
  | 'updateCollectionAliases'
  | 'createSnapshot'
> & {
  /** Deletes points matching `where` in `collection` within the current organization scope. */
  deleteByFilter<TPayload>(
    collection: string,
    where: IWhere<TPayload>,
    options?: { readonly wait?: boolean; readonly ordering?: 'weak' | 'medium' | 'strong' },
    ctx?: IOperationContext & IWriteConcurrencyOptions
  ): Promise<IQdrantUpdateResult>
  /** Purges TTL-expired points from `collection` within the current organization scope. */
  purgeExpired(
    collection: string,
    options?: { readonly wait?: boolean },
    ctx?: IOperationContext & IWriteConcurrencyOptions
  ): Promise<IQdrantUpdateResult>
}
/** Feature output descriptor for the Qdrant management feature. */
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
  /** Updates rescore slot vectors for the addressed points in `collection`. */
  updateVectors(
    collection: string,
    points: readonly IQdrantRescorePoint[],
    ctx?: IOperationContext
  ): Promise<IQdrantRescoreResult>
}
/** The explicit receiver prevents pre-topK and post-readonly stages from regaining native writes. */
export type IQdrantRescoreMethods = {
  /** Appends a native Qdrant extra-slot rescore stage after `topK`. */
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
