/** Optional journal assembly; core host code reaches this module only through the loader. */
export { prepareStorageJournalConfiguration } from './configuration.ts'
export { openStorageLogStore, snapshotStorageLogPrefix } from './log-store.ts'
export { observeStorageTelemetry } from './telemetry.ts'
