import {
  definePlugin,
  defineStorageBackendKind,
  type IStorageBackendPlugin,
  type IStorageFeatureRecord,
  type IStorageFeatureStoreCompatibility,
  type IStoragePluginCore
} from '@migaia/storage-host'
import type { ICapabilityInstallPort } from '@migaia/storage-contract'
import { createSqliteStore, type ISqliteConstruction } from './store.js'
import { SqliteNames } from './constants.js'
import type {
  ISqliteStore,
  ISqliteDriver,
  ISqliteTransactionScope,
  ISqliteOptions
} from './types.js'
/** Exact kind identity gates Features before native client access or construction. */
export const sqliteBackendKind = defineStorageBackendKind<
  ISqliteStore,
  ISqliteDriver,
  { getTransactionClient(scope: ISqliteTransactionScope): ISqliteDriver }
>()(SqliteNames.backend)
/** Define an install-time SQLite backend; the injected connection remains caller-owned. */
export function sqliteBackendPlugin<
  TValue = unknown,
  const TId extends string = 'sqlite',
  const F extends IStorageFeatureRecord = {}
>(
  options: ISqliteOptions & { readonly id?: TId },
  features?: F &
    IStorageFeatureStoreCompatibility<typeof sqliteBackendKind, NoInfer<F>, ISqliteStore<TValue>>
): IStorageBackendPlugin<typeof sqliteBackendKind, NoInfer<TId>, F, ISqliteStore<TValue>> {
  /** Public option getters are captured once while the plugin definition remains pure. */
  const captured = {
    driver: options.driver,
    table: options.table,
    concurrency: options.concurrency,
    owner: options.owner,
    maxLockMs: options.maxLockMs,
    wal: options.wal
  }
  /** Literal default ids survive host-context inference. */
  const id = (options.id ?? SqliteNames.backend) as TId
  const descriptorFactory = (core: IStoragePluginCore<F>) => {
    /** Each actual host installation gets its own store/owner, never a module singleton. */
    let construction: ISqliteConstruction<TValue>
    return {
      kind: sqliteBackendKind,
      install() {
        construction = createSqliteStore<TValue>(captured, { core, orgId: core.defaultOrgId })
        core.registerStore(construction.store)
        core.registerChangeController(construction.store, construction.controller)
        core.registerDetect(async (signal) => {
          if (signal.aborted) return
          captured.driver.prepare('SELECT 1').get()
        })
        return {}
      },
      capabilityInstaller: (_store: ISqliteStore<TValue>): ICapabilityInstallPort =>
        construction.installer,
      featureExpose: () => ({
        getClient: () => captured.driver,
        getTransactionClient: (scope: ISqliteTransactionScope) =>
          construction.getTransactionClient(scope)
      })
    }
  }
  return definePlugin<TId, typeof descriptorFactory, F>(id, descriptorFactory, features)
}
