import {
  definePlugin,
  defineStorageBackendKind,
  type IStorageBackendPlugin,
  type IStorageFeatureRecord,
  type IStorageFeatureStoreCompatibility,
  type IStoragePluginCore
} from '@migaia/storage-host'
import type { ICapabilityInstallPort } from '@migaia/storage-contract'
import { createRedisStore, type IRedisConstruction } from './store.js'
import type { IRedisOptions, IRedisStore } from './types.js'
import type { IRedisDriver } from './driver.js'
import { RedisText } from './constants.js'

/** Exact kind identity prevents a Feature from borrowing an unrelated backend's native driver. */
export const redisBackendKind = defineStorageBackendKind<IRedisStore, IRedisDriver>()(
  RedisText.backend
)
/** Capture pure configuration; the original host alone owns detection, installation and cleanup. */
export function redisBackendPlugin<
  const TId extends string = 'redis',
  const F extends IStorageFeatureRecord = {}
>(
  options: IRedisOptions & { readonly id?: TId },
  features?: F & IStorageFeatureStoreCompatibility<typeof redisBackendKind, NoInfer<F>, IRedisStore>
): IStorageBackendPlugin<typeof redisBackendKind, NoInfer<TId>, F, IRedisStore> {
  const owner = options.owner,
    captured: IRedisOptions = {
      driver: options.driver,
      prefix: options.prefix,
      concurrency: options.concurrency,
      owner: owner === undefined ? undefined : { label: owner.label },
      maxLockMs: options.maxLockMs
    },
    id = (options.id ?? RedisText.backend) as TId
  const descriptor = (core: IStoragePluginCore<F>) => {
    let construction: IRedisConstruction
    return {
      kind: redisBackendKind,
      install() {
        construction = createRedisStore(captured, core)
        core.registerStore(construction.store)
        core.registerChangeController(construction.store, construction.controller)
        core.registerOrgBinding(construction.store, construction.orgBinding)
        core.registerDetect(async (signal) => {
          if (!signal.aborted) await construction.detect()
        })
        return {}
      },
      journalBinding: (_store: IRedisStore) => construction.journalBinding,
      capabilityInstaller: (_store: IRedisStore): ICapabilityInstallPort => construction.installer,
      featureExpose: () => ({ getClient: () => captured.driver })
    }
  }
  return definePlugin<TId, typeof descriptor, F>(id, descriptor, features)
}
