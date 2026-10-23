/** Owned durable kinds identify this bridge without teaching logger any storage semantics. */
export const StorageJournalKind = {
  commit: 'storage.commit',
  intent: 'storage.binlog-intent'
} as const
