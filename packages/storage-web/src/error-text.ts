/** Stable diagnostic text for an IndexedDB sidecar row without an authoritative record. */
export const StorageErrorText = Object.freeze({
  indexOrphan: 'indexed record index contains orphan sidecar row',
  indexQueryInvalidated: 'native record index query invalidated by a concurrent mutation',
  liveQueryDisposed: 'live query is disposed; create a new live query',
  indexBackfillStale: 'indexed record backfill handle is stale; retry the query'
} as const)

/** Build the stable aggregate text used when backfill and failed-readiness persistence both fail. */
export const indexBackfillFailureText = (entityName: string): string =>
  `entity "${entityName}" index backfill and failure persistence both failed`

/** Stable public text for a logical unique-index collision. */
export const indexUniqueConflictText = (indexName: string): string =>
  `indexed record conflicts with unique index "${indexName}"`
