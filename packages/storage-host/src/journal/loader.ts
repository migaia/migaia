/** Load journal engines only for an explicitly selected journal configuration. */
export function loadStorageJournalRuntime() {
  return import('./runtime.js')
}
