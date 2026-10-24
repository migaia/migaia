import { definePlugin } from '../contracts.js'
import type { IStoragePluginCore } from '../types.js'
import * as runtime from './runtime.js'

/** The selected native plugin owns journal code admission in the existing host lifecycle. */
class StorageJournalPluginAssembly {
  /** The original native registration supplies the one journal runtime installation port. */
  readonly #core: Pick<IStoragePluginCore, 'registerJournalRuntime'>
  /** Retain this plugin's original registration without creating another resource scope. */
  constructor(core: Pick<IStoragePluginCore, 'registerJournalRuntime'>) {
    this.#core = core
  }
  /** Register the runtime before backend journal bootstrap; no journal configuration is invented. */
  install() {
    this.#core.registerJournalRuntime(runtime)
    return {}
  }
}
/** Explicitly include and install journal runtime and private log stores for this host. */
export function storageJournalPlugin() {
  return definePlugin('storage-journal', (core) => {
    /** The named assembly owns the only runtime installation callback. */
    const assembly = new StorageJournalPluginAssembly(core)
    return { install: () => assembly.install() }
  })
}
