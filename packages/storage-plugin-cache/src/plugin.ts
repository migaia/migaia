import {
  type IStorageBackendPlugin,
  type IStorageBackendType,
  type IStorageFeatureDefiner,
  type IStorageFeatureRecord,
  type IStorageFeatureStoreCompatibility,
  type IStoragePluginCore,
  type IStorageBackendPluginDefiner
} from '@migaia/storage-host'
import { defineBackendPlugin, defineStorageFeature } from '@migaia/storage-host/sdk'
import { snapshotCacheOptions } from './policy.ts'
import { createCacheStore } from './store.ts'
import type { ICacheOptions, ICacheStore } from './types.ts'

/** The cache engine as a type; no tier is exposed to Features as a native client. */
export type ICacheBackend = IStorageBackendType<ICacheStore, undefined>
/** Defines this package's Features; the annotation carries the cache backend type. */
export const defineCacheFeature: IStorageFeatureDefiner<ICacheBackend> = defineStorageFeature

/** Install only after borrowed tiers have been published by an earlier host batch. */
export function cachePlugin<
  const TId extends string = 'cache',
  const F extends IStorageFeatureRecord = {}
>(
  options: ICacheOptions & {
    /** Plugin name and backend lookup key; `'cache'` when omitted. */
    readonly name?: TId
    /** Features installed on this backend. */
    readonly features?: F & IStorageFeatureStoreCompatibility<ICacheBackend, NoInfer<F>>
  }
): IStorageBackendPlugin<ICacheBackend, NoInfer<TId>, F> {
  const captured = snapshotCacheOptions(options),
    id = captured.id as TId
  const descriptor = (core: IStoragePluginCore<F>) => {
    let construction: ReturnType<typeof createCacheStore>
    return {
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
  return (defineBackendPlugin as IStorageBackendPluginDefiner<ICacheBackend>)<
    TId,
    typeof descriptor,
    F
  >({
    name: id,
    features: options.features as never,
    open: descriptor as never
  })
}
