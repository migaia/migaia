import type { IQdrantOperationName } from './types.js'
/** Canonical API metadata is shared by native fetch, SDK adaptation and observation. */
export const QdrantRoute: Record<
  IQdrantOperationName,
  {
    readonly method: 'GET' | 'POST' | 'PUT' | 'DELETE'
    readonly path: string
    readonly query: readonly string[]
    readonly collection: boolean
    readonly parameters: boolean
  }
> = {
  scroll: {
    method: 'POST',
    path: 'collections/:collection/points/scroll',
    query: ['consistency', 'timeout'],
    collection: true,
    parameters: true
  },
  upsert: {
    method: 'PUT',
    path: 'collections/:collection/points',
    query: ['wait', 'ordering'],
    collection: true,
    parameters: true
  },
  delete: {
    method: 'POST',
    path: 'collections/:collection/points/delete',
    query: ['wait', 'ordering'],
    collection: true,
    parameters: true
  },
  retrieve: {
    method: 'POST',
    path: 'collections/:collection/points',
    query: ['consistency', 'timeout'],
    collection: true,
    parameters: true
  },
  getCollection: {
    method: 'GET',
    path: 'collections/:collection',
    query: [],
    collection: true,
    parameters: false
  },
  createCollection: {
    method: 'PUT',
    path: 'collections/:collection',
    query: ['timeout'],
    collection: true,
    parameters: true
  },
  getCollections: {
    method: 'GET',
    path: 'collections',
    query: [],
    collection: false,
    parameters: false
  },
  deleteCollection: {
    method: 'DELETE',
    path: 'collections/:collection',
    query: ['timeout'],
    collection: true,
    parameters: true
  },
  query: {
    method: 'POST',
    path: 'collections/:collection/points/query',
    query: ['consistency', 'timeout'],
    collection: true,
    parameters: true
  },
  recommend: {
    method: 'POST',
    path: 'collections/:collection/points/recommend',
    query: ['consistency', 'timeout'],
    collection: true,
    parameters: true
  },
  searchPointGroups: {
    method: 'POST',
    path: 'collections/:collection/points/search/groups',
    query: ['consistency', 'timeout'],
    collection: true,
    parameters: true
  },
  updateVectors: {
    method: 'PUT',
    path: 'collections/:collection/points/vectors',
    query: ['wait', 'ordering'],
    collection: true,
    parameters: true
  },
  updateCollectionAliases: {
    method: 'POST',
    path: 'collections/aliases',
    query: ['timeout'],
    collection: false,
    parameters: true
  },
  createSnapshot: {
    method: 'POST',
    path: 'collections/:collection/snapshots',
    query: ['wait'],
    collection: true,
    parameters: true
  },
  createPayloadIndex: {
    method: 'PUT',
    path: 'collections/:collection/index',
    query: ['wait', 'ordering'],
    collection: true,
    parameters: true
  },
  count: {
    method: 'POST',
    path: 'collections/:collection/points/count',
    query: ['timeout'],
    collection: true,
    parameters: true
  },
  setPayload: {
    method: 'POST',
    path: 'collections/:collection/points/payload',
    query: ['wait', 'ordering'],
    collection: true,
    parameters: true
  },
  deletePayload: {
    method: 'POST',
    path: 'collections/:collection/points/payload/delete',
    query: ['wait', 'ordering'],
    collection: true,
    parameters: true
  }
}
/** Managed slots use native engine storage; the source Dot slot preserves cosine input amplitude. */
export const QdrantManagedVectorName = { search: 'migaia_search', source: 'migaia_source' } as const
/** Reserved fields and stable point/configuration names belong only to this backend. */
export const QdrantText = {
  backend: 'qdrant',
  prefix: 'migaia_',
  org: '$org',
  expiresAt: '$expiresAt',
  envelope: '$migaia',
  version: 1,
  onHttpRequest: 'onHttpRequest',
  json: 'application/json',
  apiKey: 'api-key',
  sdkMinimum: '1.11.0',
  sdkUnexpectedResponse: 'QdrantClientUnexpectedResponseError'
} as const
