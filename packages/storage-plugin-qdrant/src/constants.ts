import type { IQdrantOperationName } from './types.js'
/** Canonical API metadata is shared by native fetch, SDK adaptation and observation. */
export const QdrantRoute: {
  readonly [K in IQdrantOperationName]: {
    readonly name: K
    readonly method: 'GET' | 'POST' | 'PUT' | 'DELETE'
    readonly path: string
    readonly query: readonly string[]
    readonly collection: boolean
    readonly parameters: boolean
  }
} = {
  scroll: {
    name: 'scroll',
    method: 'POST',
    path: 'collections/:collection/points/scroll',
    query: ['consistency', 'timeout'],
    collection: true,
    parameters: true
  },
  upsert: {
    name: 'upsert',
    method: 'PUT',
    path: 'collections/:collection/points',
    query: ['wait', 'ordering'],
    collection: true,
    parameters: true
  },
  delete: {
    name: 'delete',
    method: 'POST',
    path: 'collections/:collection/points/delete',
    query: ['wait', 'ordering'],
    collection: true,
    parameters: true
  },
  retrieve: {
    name: 'retrieve',
    method: 'POST',
    path: 'collections/:collection/points',
    query: ['consistency', 'timeout'],
    collection: true,
    parameters: true
  },
  getCollection: {
    name: 'getCollection',
    method: 'GET',
    path: 'collections/:collection',
    query: [],
    collection: true,
    parameters: false
  },
  createCollection: {
    name: 'createCollection',
    method: 'PUT',
    path: 'collections/:collection',
    query: ['timeout'],
    collection: true,
    parameters: true
  },
  getCollections: {
    name: 'getCollections',
    method: 'GET',
    path: 'collections',
    query: [],
    collection: false,
    parameters: false
  },
  deleteCollection: {
    name: 'deleteCollection',
    method: 'DELETE',
    path: 'collections/:collection',
    query: ['timeout'],
    collection: true,
    parameters: true
  },
  query: {
    name: 'query',
    method: 'POST',
    path: 'collections/:collection/points/query',
    query: ['consistency', 'timeout'],
    collection: true,
    parameters: true
  },
  recommend: {
    name: 'recommend',
    method: 'POST',
    path: 'collections/:collection/points/recommend',
    query: ['consistency', 'timeout'],
    collection: true,
    parameters: true
  },
  searchPointGroups: {
    name: 'searchPointGroups',
    method: 'POST',
    path: 'collections/:collection/points/search/groups',
    query: ['consistency', 'timeout'],
    collection: true,
    parameters: true
  },
  updateVectors: {
    name: 'updateVectors',
    method: 'PUT',
    path: 'collections/:collection/points/vectors',
    query: ['wait', 'ordering'],
    collection: true,
    parameters: true
  },
  updateCollectionAliases: {
    name: 'updateCollectionAliases',
    method: 'POST',
    path: 'collections/aliases',
    query: ['timeout'],
    collection: false,
    parameters: true
  },
  createSnapshot: {
    name: 'createSnapshot',
    method: 'POST',
    path: 'collections/:collection/snapshots',
    query: ['wait'],
    collection: true,
    parameters: true
  },
  createPayloadIndex: {
    name: 'createPayloadIndex',
    method: 'PUT',
    path: 'collections/:collection/index',
    query: ['wait', 'ordering'],
    collection: true,
    parameters: true
  },
  count: {
    name: 'count',
    method: 'POST',
    path: 'collections/:collection/points/count',
    query: ['timeout'],
    collection: true,
    parameters: true
  },
  setPayload: {
    name: 'setPayload',
    method: 'POST',
    path: 'collections/:collection/points/payload',
    query: ['wait', 'ordering'],
    collection: true,
    parameters: true
  },
  deletePayload: {
    name: 'deletePayload',
    method: 'POST',
    path: 'collections/:collection/points/payload/delete',
    query: ['wait', 'ordering'],
    collection: true,
    parameters: true
  }
}
/** Detection requires only standard vector, TTL and organization cleanup protocol methods. */
export const QdrantRequiredOperations = [
  QdrantRoute.getCollections.name,
  QdrantRoute.getCollection.name,
  QdrantRoute.createCollection.name,
  QdrantRoute.createPayloadIndex.name,
  QdrantRoute.upsert.name,
  QdrantRoute.delete.name,
  QdrantRoute.count.name,
  QdrantRoute.scroll.name,
  QdrantRoute.retrieve.name,
  QdrantRoute.query.name,
  QdrantRoute.setPayload.name,
  QdrantRoute.deletePayload.name
] as const
/** Managed slots use native engine storage; the source Dot slot preserves cosine input amplitude. */
export const QdrantManagedVectorName = { search: 'migaia_search', source: 'migaia_source' } as const
/** Reserved fields and stable point/configuration names belong only to this backend. */
export const QdrantText = {
  backend: 'qdrant',
  prefix: 'migaia_',
  org: '$org',
  expiresAt: '$expiresAt',
  envelope: '$migaia',
  fields: 'migaia_fields',
  version: 1,
  onHttpRequest: 'onHttpRequest',
  json: 'application/json',
  apiKey: 'api-key',
  sdkMinimum: '1.11.0',
  search: 'vector.search',
  upsert: 'vector.upsert',
  delete: 'vector.delete',
  deleteWhere: 'vector.deleteWhere',
  ttl: 'ttl.',
  deleteByFilter: 'qdrant.deleteByFilter',
  purgeExpired: 'qdrant.purgeExpired',
  dropOrg: 'org.drop',
  sdkUnexpectedResponse: 'QdrantClientUnexpectedResponseError'
} as const
