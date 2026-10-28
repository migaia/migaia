import {
  StorageContractError,
  StorageContractErrorCode,
  type IKeyValueStore
} from '@migaia/storage-contract'
import {
  definePlugin,
  type IStorageBackendKind,
  type IStorageBackendPlugin,
  type IStorageFeatureRecord,
  type IStorageFeatureStoreCompatibility,
  type IStoragePluginCore
} from '@migaia/storage-host'
import type { IBackendConstruction } from '../backends/construction.ts'
import { StorageError } from '../types/errors.ts'
import { StorageBrowserErrorCode } from '@migaia/storage-contract/error-code'
import type { IBackendKind } from '@migaia/storage-contract'

/** Read the optional factory id without allowing an options accessor to leave the Web boundary. */
export function readBuiltInPluginId<TId extends string>(
  options: { readonly id?: TId },
  fallback: string,
  backend: IBackendKind
): TId {
  try {
    return (options.id ?? fallback) as TId
  } catch (cause) {
    throw new StorageError(StorageBrowserErrorCode.invalidConfig, { backend, cause })
  }
}

/** Preserve the original create, admission, controller registration and preparation order. */
export function createBuiltInBackendPlugin<
  const TName extends string,
  S extends IKeyValueStore,
  C,
  const TId extends string,
  const F extends IStorageFeatureRecord = {}
>(
  kind: IStorageBackendKind<TName, S, C>,
  id: TId,
  createStore: (core: IStoragePluginCore) => IBackendConstruction<S, C>,
  features?: F & IStorageFeatureStoreCompatibility<IStorageBackendKind<TName, S, C>, NoInfer<F>>,
  journal = false
): IStorageBackendPlugin<IStorageBackendKind<TName, S, C>, TId, F> {
  /** The descriptor borrows this exact construction; only the host owns its lifetime. */
  const descriptor = (core: IStoragePluginCore<F>) => {
    /** Installation initializes the original native client before lazy Feature getters run. */
    let construction: IBackendConstruction<S, C>
    return {
      kind,
      install: () => {
        construction = createStore(core)
        core.registerStore(construction.store)
        core.registerChangeController(construction.store, construction.controller)
        if (construction.orgBinding !== undefined)
          core.registerOrgBinding(construction.store, construction.orgBinding)
        if (construction.commitValueWrite !== undefined)
          core.registerValueCommit(construction.store, construction.commitValueWrite)
        return construction.prepare ? construction.prepare().then(() => ({})) : {}
      },
      featureExpose: () => ({ getClient: () => construction.getClient() }),
      capabilityInstaller: (_store: S) => construction.installer,
      ...(journal
        ? {
            journalBinding: (_store: S) => {
              if (construction.journalBinding === undefined)
                throw new StorageContractError(StorageContractErrorCode.unsupported)
              return construction.journalBinding
            }
          }
        : {})
    }
  }
  return definePlugin<TId, typeof descriptor, F>(id, descriptor, features)
}
