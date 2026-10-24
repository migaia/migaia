/** Optional journal assembly; core host code reaches this module only through the loader. */
export { prepareStorageJournalConfiguration } from './configuration.js'
export { openStorageLogStore, snapshotStorageLogPrefix } from './log-store.js'
export { observeStorageTelemetry } from './telemetry.js'
