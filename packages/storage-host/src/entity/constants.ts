/** Invalid-record handling policies used by repository reads and migrations. */
export const StorageInvalidRecordAction = {
  skip: 'skip',
  throw: 'throw'
} as const

/** Operation labels attached to storage diagnostics and error details. */
export const StorageOperation = {
  entityEnvelope: 'entity.envelope',
  /** Stable callback operation labels distinguish query extension failures. */
  queryWhere: 'query.where',
  querySelect: 'query.select',
  /** Identifies synchronous portable-key selectors before canonical query ordering. */
  querySelector: 'query.orderBy',
  queryComparator: 'query.orderByComparator',
  entityCodecEncode: 'entity.codec.encode',
  entityCodecDecode: 'entity.codec.decode',
  entitySchemaValidate: 'entity.schema.validate',
  entitySchemaNormalize: 'entity.schema.normalize',
  entitySchemaEncode: 'entity.schema.encode',
  entitySchemaDecode: 'entity.schema.decode',
  entityOrderBy: 'entity.orderBy',
  /** Labels an optimistic fallback unique check and its exclusive commit boundary. */
  entityUniqueWrite: 'entity.unique.write',
  /** Identifies a user index selector or projection that failed at the shared extension boundary. */
  entityIndexProjection: 'entity.index.project'
} as const

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

export type IStorageInvalidRecordAction =
  (typeof StorageInvalidRecordAction)[keyof typeof StorageInvalidRecordAction]
export type IStorageOperation = (typeof StorageOperation)[keyof typeof StorageOperation]
export type IStorageRecordStage = (typeof StorageRecordStage)[keyof typeof StorageRecordStage]
export type IStorageMigrationStatus =
  (typeof StorageMigrationStatus)[keyof typeof StorageMigrationStatus]
export type IStorageMigrationPhase =
  (typeof StorageMigrationPhase)[keyof typeof StorageMigrationPhase]

/** Common entity candidate sources report their actual client execution without native pushdown. */
export const EntityState = { querySource: 'entity-records' } as const
