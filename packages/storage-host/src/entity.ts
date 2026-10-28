export { passthrough } from './schema/passthrough.ts'
export { fromStandardSchema, type IStandardSchemaV1 } from './schema/standard-schema.ts'
export type { ISchemaAdapter } from './schema/types.ts'
export { jsonCodec, structuredCodec, binaryCodec, selectCodec } from './serialize/index.ts'
export type { ICodec, ICodecOutput, ISelectedCodec } from './serialize/index.ts'
export { REPOSITORY_KEY_PREFIX, repositoryMigrationKey } from './core/record-layout.ts'

export {
  RecordIndexBackfillPhase,
  registerRecordIndexBackfillStore,
  markRecordIndexBackfillContentionFailure
} from './entity/backfill.ts'
export type {
  IRecordIndexBackfillPhase,
  IRecordIndexBackfillCandidate,
  IRecordIndexBackfillPreparation,
  IRecordIndexBackfillReadOptions,
  IRecordIndexBackfillProjection,
  IRecordIndexBackfillBatch,
  IRecordIndexBackfillRetryReceipt,
  IRecordIndexBackfillSession,
  IRecordIndexBackfillStore
} from './entity/backfill.ts'

export { defineEntity } from './entity/define.ts'
export type {
  IEntityDefinition,
  IEntityQuery,
  IEntityQueryNarrowed,
  IEntityQueryNarrowedCore,
  IEntityQueryOrdered,
  IEntityQueryOrderedCore,
  IEntityQueryCompared,
  IEntityQueryComparedCore,
  IEntityQueryNeedsLimit,
  IEntityQueryFinal,
  IEntityQueryAccess,
  IEntityConnectOptions,
  IEntityConnectStore,
  IEntityStoreQueryMethods,
  IEntityIndex,
  IEntityIndexMap,
  IEntityOptions,
  IEntityTransactionScope,
  IEntityListOrder,
  IEntityIndexOptions,
  IIndexedListOptions,
  IListOptions,
  IMigrateOptions,
  IMigrateResult,
  IInvalidRecordAction,
  IInvalidRecordIssue,
  IInvalidRecordHandler,
  IRecordComparator,
  IRepository
} from './entity/types.ts'

export type { IEntityFeature } from './entity/assembly.ts'
