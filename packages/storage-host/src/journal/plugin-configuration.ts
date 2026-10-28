import type { IStorageJournalConfiguration } from './types.ts'

/**
 * Journal configuration carried by each `storageJournalPlugin()` handle. The host reads it before
 * the install batch runs, because journal bootstrap is planned before any plugin installs. This
 * module stays free of journal runtime imports so the base host entry can read it.
 */
const journalPluginConfiguration = new WeakMap<
  object,
  { readonly configuration: IStorageJournalConfiguration | undefined }
>()

/** Attaches the configuration given to `storageJournalPlugin(options)` to its plugin handle. */
export function attachStorageJournalConfiguration(
  plugin: object,
  configuration: IStorageJournalConfiguration | undefined
): void {
  journalPluginConfiguration.set(plugin, { configuration })
}

/**
 * Returns the journal configuration slot of a `storageJournalPlugin()` handle, or `undefined` when
 * the plugin is not a journal plugin. A journal plugin created without options yields a slot whose
 * `configuration` is `undefined`; it only enables log stores.
 */
export function readStorageJournalConfiguration(
  plugin: object
): { readonly configuration: IStorageJournalConfiguration | undefined } | undefined {
  return journalPluginConfiguration.get(plugin)
}
