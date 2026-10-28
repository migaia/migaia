/** Explicit plugin runtime contract; the base host has no executable journal import. */
export type IStorageJournalRuntime = typeof import('./runtime.ts')
