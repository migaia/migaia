import { indexedDbKeysetFeature } from '../../src/features/indexed-db-keyset.js'
import { indexedDbIndexesFeature } from '../../src/features/indexed-db-indexes.js'
import { indexedDbTtlFeature } from '../../src/features/indexed-db-ttl.js'
import { indexedDbBatchFeature } from '../../src/features/indexed-db-batch.js'
import { indexedDbJournalFeature } from '../../src/features/indexed-db-journal.js'
import { indexedDbNotificationsFeature } from '../../src/features/indexed-db-notifications.js'
import { indexedDbChangeFeedFeature } from '../../src/features/indexed-db-change-feed.js'

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
