import type { IStorageChannel } from '../errors.js'

/** Stable memory endpoint names bind real operations to the original host execution list. */
export const MemoryOperation = {
  get: 'get',
  set: 'set',
  remove: 'remove',
  has: 'has',
  keys: 'keys',
  clearValues: 'clearValues',
  getBytes: 'getBytes',
  setBytes: 'setBytes',
  removeBytes: 'removeBytes',
  clearBytes: 'clearBytes',
  getRecord: 'getRecord',
  putRecord: 'putRecord',
  deleteRecord: 'deleteRecord',
  clearRecords: 'clearRecords',
  iterateRecords: 'iterateRecords',
  clearAll: 'clearAll',
  transaction: 'transaction',
  /** Authentic expired views retain the historical scope operation in their cached failure. */
  transactionScope: 'transaction.scope',
  inspectLocks: 'inspectLocks',
  watch: 'watch',
  getMany: 'getMany',
  setMany: 'setMany',
  removeMany: 'removeMany',
  removeByPrefix: 'removeByPrefix',
  recordRemoveByPrefix: 'records.removeByPrefix',
  recordQueryDelete: 'records.query.delete',
  recordQueryUpdate: 'records.query.update',
  ttlExpire: 'ttl.expire',
  ttlRemaining: 'ttl.remaining',
  ttlPersist: 'ttl.persist',
  counterIncrement: 'counter.increment',
  rdfAdd: 'rdf.add',
  rdfDelete: 'rdf.delete',
  rdfMatch: 'rdf.match',
  rdfQueryDelete: 'rdf.query.delete',
  rdfQueryReplace: 'rdf.query.replace',
  blobPut: 'blob.put',
  blobGet: 'blob.get',
  blobHead: 'blob.head',
  blobRemove: 'blob.remove',
  blobList: 'blob.list',
  blobRemoveByPrefix: 'blob.removeByPrefix',
  vectorSearch: 'vector.search',
  vectorUpsert: 'vector.upsert',
  vectorDelete: 'vector.delete',
  vectorDeleteWhere: 'vector.deleteWhere',
  vectorQueryDelete: 'vector.query.delete'
} as const

/** Physical memory identity and diagnostic names remain private to this native backend. */
export const MemoryState = {
  defaultNamespace: 'default',
  querySource: 'memory',
  /** Cursor tag binds native object pages without creating a token registry. */
  blobCursor: 'memory.blob',
  channels: ['value', 'bytes', 'record'] as const,
  identity: (channel: IStorageChannel | 'vector' | 'rdf' | 'blob', encoded: string): string =>
    `${channel}:${encoded}`,
  ownerLabel: (runtime: string | undefined, pid: number | undefined): string =>
    runtime === undefined ? 'browser' : `${runtime}:${pid}`
} as const
