import {
  definePlugin,
  type IStorageBackendPlugin,
  type IStorageFeatureRecord,
  type IStorageFeatureStoreCompatibility,
  type IStoragePluginCore
} from '@migaia/storage-host'
import { cacheBackendKind } from './kind.ts'
import { snapshotCacheOptions } from './policy.ts'
import { createCacheStore } from './store.ts'
import type { ICacheOptions, ICacheStore } from './types.ts'

/** Install only after borrowed tiers have been published by an earlier host batch. */
export function cachePlugin<
  const TId extends string = 'cache',
  const F extends IStorageFeatureRecord = {}
>(
  options: ICacheOptions & { readonly id?: TId },
  features?: F & IStorageFeatureStoreCompatibility<typeof cacheBackendKind, NoInfer<F>>
): IStorageBackendPlugin<typeof cacheBackendKind, NoInfer<TId>, F> {
  const captured = snapshotCacheOptions(options),
    id = captured.id as TId
  const descriptor = (core: IStoragePluginCore<F>) => {
    let construction: ReturnType<typeof createCacheStore>
    return {
      kind: cacheBackendKind,
      install() {
        construction = createCacheStore(captured, core)
        core.registerStore(construction.store)
        core.registerChangeController(construction.store, construction.controller)
        core.registerOrgBinding(construction.store, construction.orgBinding)
        return {}
      },
      capabilityInstaller: (_store: ICacheStore) => construction.installer,
      featureExpose: () => ({ getClient: () => undefined })
    }
  }
  return definePlugin<TId, typeof descriptor, F>(id, descriptor, features)
}
