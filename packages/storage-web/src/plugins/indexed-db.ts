import { readBuiltInPluginId } from './builtin-factory.js'
import { indexedDbHost, type IIndexedDbOptions } from '../backends/indexed-db.js'
import { indexedDbBackendKind, type IBuiltInPluginId } from '../host/builtin-kinds.js'
import {
  definePlugin,
  type IStorageBackendPlugin,
  type IStorageFeatureRecord,
  type IStorageFeatureStoreCompatibility,
  type IStoragePluginCore
} from '@migaia/storage-host'
import { StorageError, StorageErrorCode } from '../types/errors.js'
import { StorageErrorText } from '../error-text.js'
import { StorageBackend } from '../constants.js'

/**
 * Define a IndexedDB backend plugin with default id indexed-db. Store acquisition waits for Host
 * install, which owns rollback and final disposal; this ordinary plugin adds no reactive adapter.
 * Backend options retain their factory defaults.
 */
export const indexedDbBackendPlugin = <
  const TId extends string = 'indexed-db',
  const F extends IStorageFeatureRecord = {}
>(
  options: IIndexedDbOptions & IBuiltInPluginId<TId> = {},
  features?: F & IStorageFeatureStoreCompatibility<typeof indexedDbBackendKind, NoInfer<F>>
): IStorageBackendPlugin<typeof indexedDbBackendKind, NoInfer<TId>, F> => {
  /** Each installation owns its declarations; reusable plugin definitions retain no native handle. */
  const descriptor = (core: IStoragePluginCore<F>) => {
    /** Selected Features contribute names before this original opener begins preparing. */
    const objectStores = new Set<string>()
    /** Opening freezes schema requirements for this installation. */
    let schemaSealed = false
    /** The original construction remains private and is read only after installation. */
    let construction: ReturnType<typeof indexedDbHost>
    return {
      kind: indexedDbBackendKind,
      install: () => {
        schemaSealed = true
        construction = indexedDbHost(options, core, [...objectStores])
        core.registerStore(construction.store)
        core.registerChangeController(construction.store, construction.controller)
        if (construction.orgBinding !== undefined)
          core.registerOrgBinding(construction.store, construction.orgBinding)
        return construction.prepare!().then(() => ({}))
      },
      featureExpose: () => ({
        getClient: () => construction.getClient(),
        getTransactionClient: (scope: Parameters<typeof construction.getTransactionClient>[0]) =>
          construction.getTransactionClient(scope),
        requireObjectStore: (name: string): void => {
          if (schemaSealed || typeof name !== 'string' || name.length === 0)
            throw new StorageError(
              StorageErrorCode.invalidConfig,
              { backend: StorageBackend.indexedDb },
              StorageErrorText.indexedDbSchemaDeclarationInvalid
            )
          objectStores.add(name)
        }
      }),
      capabilityInstaller: (_store: ReturnType<typeof indexedDbHost>['store']) =>
        construction.installer
    }
  }
  return definePlugin<TId, typeof descriptor, F>(
    readBuiltInPluginId(options, 'indexed-db', StorageBackend.indexedDb),
    descriptor,
    features
  )
}
