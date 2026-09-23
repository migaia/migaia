import type { IKeyValueStore } from '@migaia/storage-contract'
import type { IFeatureRecord } from '@migaia/plugin-host'
import {
  defineBuiltInPlugin,
  defineBuiltInReactivePlugin,
  type IStoragePluginCore
} from '../host/contracts.js'
import type { IStorageBackendKind, IStorageBackendPlugin } from '../host/types.js'

type IPluginPreparation<TStore extends IKeyValueStore> = (store: TStore) => Promise<void>

/** Defines an ordinary first-party backend without introducing a reactive Feature. */
export function createBuiltInBackendPlugin<
  TStore extends IKeyValueStore,
  TKind extends IStorageBackendKind<string, TStore>,
  const TId extends string
>(
  kind: TKind,
  id: TId,
  createStore: () => TStore,
  options?: { readonly prepare?: IPluginPreparation<TStore> }
): IStorageBackendPlugin<TStore, TKind, TId, false>

/** Defines a reactive first-party backend while preserving its exact Feature metadata. */
export function createBuiltInBackendPlugin<
  TStore extends IKeyValueStore,
  TKind extends IStorageBackendKind<string, TStore>,
  const TId extends string
>(
  kind: TKind,
  id: TId,
  createStore: () => TStore,
  options: {
    readonly reactive: IFeatureRecord[string]
    readonly prepare?: IPluginPreparation<TStore>
  }
): IStorageBackendPlugin<TStore, TKind, TId, true>

/** Registers the Store before optional async preparation so Host owns rollback disposal. */
export function createBuiltInBackendPlugin<
  TStore extends IKeyValueStore,
  TKind extends IStorageBackendKind<string, TStore>,
  const TId extends string
>(
  kind: TKind,
  id: TId,
  createStore: () => TStore,
  options?: {
    readonly reactive?: IFeatureRecord[string]
    readonly prepare?: IPluginPreparation<TStore>
  }
): IStorageBackendPlugin<TStore, TKind, TId, boolean> {
  const descriptor = (core: IStoragePluginCore<TStore>) => ({
    install: () => {
      const store = createStore()
      core.registerStore(store)
      return options?.prepare ? options.prepare(store).then(() => ({})) : {}
    }
  })
  if (options?.reactive)
    return defineBuiltInReactivePlugin(kind, id, descriptor, {
      reactive: options.reactive
    })
  return defineBuiltInPlugin(kind, id, descriptor)
}
