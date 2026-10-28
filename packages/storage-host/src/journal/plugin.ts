import { definePlugin } from '../contracts.ts'
import type { IStoragePluginCore } from '../types.ts'
import * as runtime from './runtime.ts'
import { STORAGE_JOURNAL_PLUGIN_ID } from '../state-constants.ts'
import { attachStorageJournalConfiguration } from './plugin-configuration.ts'
import type {
  IStorageJournalConfiguration,
  IStorageJournalInitializerContext,
  IStorageJournalPluginHandle
} from './types.ts'

/** The selected native plugin owns journal code admission in the existing host lifecycle. */
class StorageJournalPluginAssembly {
  /** The original native registration supplies the one journal runtime installation port. */
  readonly #core: Pick<IStoragePluginCore, 'registerJournalRuntime'>
  /** Retain this plugin's original registration without creating another resource scope. */
  constructor(core: Pick<IStoragePluginCore, 'registerJournalRuntime'>) {
    this.#core = core
  }
  /** Register the runtime before backend journal bootstrap. */
  install() {
    this.#core.registerJournalRuntime(runtime)
    return {}
  }
}
/** Static journal options are kept as their literal type so the host can add `undo`. */
type IStorageJournalStaticOptions = Exclude<IStorageJournalConfiguration, Function>
/**
 * Install journal runtime, private log stores and, when `options` is given, journal recording for
 * every backend installed in the same `createStorageHost` batch. `options` is either the journal
 * options or an initializer called once per organization. Without `options`, only
 * `storageLogStore()` is enabled. A journal plugin with options is accepted only in the host's
 * first install batch, before any backend exists; it must come before the backends it records.
 */
export function storageJournalPlugin(): IStorageJournalPluginHandle<undefined>
export function storageJournalPlugin<const O extends IStorageJournalStaticOptions>(
  options: O
): IStorageJournalPluginHandle<O>
export function storageJournalPlugin<const O extends IStorageJournalStaticOptions>(
  options: (context: IStorageJournalInitializerContext) => O | PromiseLike<O>
): IStorageJournalPluginHandle<(context: IStorageJournalInitializerContext) => O | PromiseLike<O>>
export function storageJournalPlugin(
  options?: IStorageJournalConfiguration
): IStorageJournalPluginHandle<IStorageJournalConfiguration | undefined> {
  const plugin = definePlugin(STORAGE_JOURNAL_PLUGIN_ID, (core) => {
    /** The named assembly owns the only runtime installation callback. */
    const assembly = new StorageJournalPluginAssembly(core)
    return { install: () => assembly.install() }
  })
  attachStorageJournalConfiguration(plugin, options)
  return plugin as unknown as IStorageJournalPluginHandle<IStorageJournalConfiguration | undefined>
}
