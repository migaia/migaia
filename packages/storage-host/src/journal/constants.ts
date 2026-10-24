/** Owned durable kinds identify this bridge without teaching logger any storage semantics. */
export const StorageJournalKind = {
  commit: 'storage.commit',
  intent: 'storage.binlog-intent',
  redo: 'storage.redo'
} as const

/** Ordinary operation telemetry is categorized separately from the original logger level. */
export const STORAGE_TELEMETRY_TAG = 'storage'
