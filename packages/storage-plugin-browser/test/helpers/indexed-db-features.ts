import { indexedDbKeysetFeature } from '../../src/features/indexed-db-keyset.ts'
import { indexedDbIndexesFeature } from '../../src/features/indexed-db-indexes.ts'
import { indexedDbTtlFeature } from '../../src/features/indexed-db-ttl.ts'
import { indexedDbBatchFeature } from '../../src/features/indexed-db-batch.ts'
import { indexedDbJournalFeature } from '../../src/features/indexed-db-journal.ts'
import { indexedDbNotificationsFeature } from '../../src/features/indexed-db-notifications.ts'
import { indexedDbChangeFeedFeature } from '../../src/features/indexed-db-change-feed.ts'

/**
 * Existing native behavior fixtures explicitly retain the optional capabilities they previously
 * inherited.
 */
export const indexedDbTestFeatures = {
  indexedDbIndexes: indexedDbIndexesFeature(),
  indexedDbKeyset: indexedDbKeysetFeature(),
  indexedDbTtl: indexedDbTtlFeature(),
  indexedDbBatch: indexedDbBatchFeature(),
  indexedDbJournal: indexedDbJournalFeature(),
  indexedDbNotifications: indexedDbNotificationsFeature(),
  indexedDbChangeFeed: indexedDbChangeFeedFeature()
} as const
