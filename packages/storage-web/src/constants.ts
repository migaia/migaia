/** Storage backend identifiers carried in diagnostics and capability descriptors. */
export const StorageBackend = {
  cookie: 'cookie',
  indexedDb: 'indexeddb',
  local: 'local',
  session: 'session',
  memory: 'memory'
} as const

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
  indexedDbOpen: 'indexeddb.open',
  indexedDbTransaction: 'indexeddb.transaction',
  indexedDbRead: 'indexeddb.read',
  indexedDbClose: 'indexeddb.close',
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

/** Codec output labels selected by storage backend capabilities. */
export const StorageCodecOutput = {
  text: 'text',
  structured: 'structured',
  binary: 'binary'
} as const

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
export type IStorageCodecOutput = (typeof StorageCodecOutput)[keyof typeof StorageCodecOutput]
