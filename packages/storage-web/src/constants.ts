/** Storage backend identifiers carried in diagnostics and capability descriptors. */
export const StorageBackend = {
  cookie: 'cookies',
  indexedDb: 'indexed-db',
  local: 'local-storage',
  session: 'session-storage'
} as const

/** Browser lock diagnostics use the platform label when the caller supplies no owner label. */
export const StorageBrowserOwnerLabel = 'browser'

/** Conflict handling policies accepted by storage operations. */
export const StorageConflictPolicy = {
  conflict: 'conflict',
  replace: 'replace'
} as const

/** Invalid-record handling policies used by repository reads and migrations. */
export const StorageInvalidRecordAction = {
  skip: 'skip',
  throw: 'throw'
} as const

/** Operation labels attached to storage diagnostics and error details. */
export const StorageOperation = {
  cookieSet: 'cookie.set',
  cookieRemove: 'cookie.remove',
  /** Preserve the pre-cutover native Web Storage cleanup diagnostics. */
  localClearValues: 'local.clearValues',
  localClearAll: 'local.clearAll',
  sessionClearValues: 'session.clearValues',
  sessionClearAll: 'session.clearAll',
  indexedDbOpen: 'indexeddb.open',
  indexedDbTransaction: 'indexeddb.transaction',
  indexedDbRead: 'indexeddb.read',
  indexedDbClose: 'indexeddb.close',
  /** Physical organization deletion belongs to the same native database opener. */
  indexedDbDelete: 'indexeddb.delete',
  indexedDbLegacyMigration: 'indexeddb.legacy.migration',
  indexedDbSchema: 'indexeddb.schema',
  indexedDbCursor: 'indexeddb.cursor',
  transactionCommit: 'transaction.commit',
  transactionScope: 'transaction.scope',
  entityOrderBy: 'entity.orderBy',
  /** Labels an optimistic fallback unique check and its exclusive commit boundary. */
  entityUniqueWrite: 'entity.unique.write',
  /** Identifies a user index selector or projection that failed at the shared extension boundary. */
  entityIndexProjection: 'entity.index.project'
} as const

/** Standard TTL endpoint labels are shared by native root pipelines and diagnostics. */
export const BrowserTtlMethod = {
  expire: 'ttl.expire',
  remaining: 'ttl.remaining',
  persist: 'ttl.persist'
} as const

/** Transaction method labels are observed at the original short-lived operation view. */
export const StorageTransactionOperation = {
  /** TTL operations borrow the same admitted native transaction and its operation observer. */
  ttlExpire: 'transaction.ttl.expire',
  ttlRemaining: 'transaction.ttl.remaining',
  ttlPersist: 'transaction.ttl.persist',
  getMany: 'transaction.getMany',
  setMany: 'transaction.setMany',
  removeMany: 'transaction.removeMany',
  removeByPrefix: 'transaction.removeByPrefix',
  removeRecordsByPrefix: 'transaction.records.removeByPrefix',
  get: 'transaction.get',
  set: 'transaction.set',
  remove: 'transaction.remove',
  has: 'transaction.has',
  getBytes: 'transaction.getBytes',
  setBytes: 'transaction.setBytes',
  removeBytes: 'transaction.removeBytes',
  getRecord: 'transaction.getRecord',
  putRecord: 'transaction.putRecord',
  deleteRecord: 'transaction.deleteRecord',
  iterateRecords: 'transaction.iterateRecords',
  putIndexedRecord: 'transaction.putIndexedRecord',
  /** Reads readiness from the same native transaction before an entity uses a cached handle. */
  isRecordIndexReady: 'transaction.isRecordIndexReady',
  iterateRecordIndex: 'transaction.iterateRecordIndex'
} as const

/** Concrete native endpoint labels identify the installed backend without adding another runner. */
export const storageBackendOperation = (backend: string, method: string, group?: string): string =>
  group === undefined ? `${backend}.${method}` : `${backend}.${group}.${method}`

/** One origin-wide Web Lock prevents separate KV-backed repositories from racing their commits. */
export const ENTITY_UNIQUE_WRITE_LOCK = 'migaia:storage-web:entity-unique-write'

/** Record channels used by value and binary storage implementations. */
export const StorageChannel = { value: 'value', bytes: 'bytes' } as const

/** Invalid-record processing stages reported by repository migrations. */
export const StorageRecordStage = {
  decode: 'decode',
  migrate: 'migrate',
  validate: 'validate'
} as const

/** Checkpoint states persisted while repository migration is resumable. */
export const StorageMigrationStatus = { running: 'running', complete: 'complete' } as const

/** Physical-key migration phases, ordered from current layout to legacy layout. */
export const StorageMigrationPhase = { v2: 'v2', legacy: 'legacy' } as const

export type IStorageBackend = (typeof StorageBackend)[keyof typeof StorageBackend]
export type IStorageConflictPolicy =
  (typeof StorageConflictPolicy)[keyof typeof StorageConflictPolicy]
export type IStorageInvalidRecordAction =
  (typeof StorageInvalidRecordAction)[keyof typeof StorageInvalidRecordAction]
export type IStorageOperation = (typeof StorageOperation)[keyof typeof StorageOperation]
export type IStorageChannel = (typeof StorageChannel)[keyof typeof StorageChannel]
export type IStorageRecordStage = (typeof StorageRecordStage)[keyof typeof StorageRecordStage]
export type IStorageMigrationStatus =
  (typeof StorageMigrationStatus)[keyof typeof StorageMigrationStatus]
export type IStorageMigrationPhase =
  (typeof StorageMigrationPhase)[keyof typeof StorageMigrationPhase]
