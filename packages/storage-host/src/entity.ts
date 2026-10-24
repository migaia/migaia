export { passthrough } from './schema/passthrough.js'
export { fromStandardSchema, type IStandardSchemaV1 } from './schema/standard-schema.js'
export type { ISchemaAdapter } from './schema/types.js'
export { jsonCodec, structuredCodec, binaryCodec, selectCodec } from './serialize/index.js'
export type { ICodec, ICodecOutput, ISelectedCodec } from './serialize/index.js'
export { REPOSITORY_KEY_PREFIX, repositoryMigrationKey } from './core/record-layout.js'

export {
  RecordIndexBackfillPhase,
  registerRecordIndexBackfillStore,
  markRecordIndexBackfillContentionFailure
} from './entity/backfill.js'
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
} from './entity/backfill.js'

export { defineEntity } from './entity/define.js'
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
} from './entity/types.js'
