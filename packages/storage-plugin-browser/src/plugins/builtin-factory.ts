import {
  StorageContractError,
  StorageContractErrorCode,
  type IKeyValueStore
} from '@migaia/storage-contract'
import {
  type IStorageBackendPlugin,
  type IStorageBackendType,
  type IStorageFeatureRecord,
  type IStorageFeatureStoreCompatibility,
  type IStoragePluginCore,
  type IStorageReactiveProfile,
  type IStorageReactiveProfileExpose,
  type IStorageReactiveVisibility,
  type IStorageBackendPluginDefiner
} from '@migaia/storage-host'
import { defineBackendPlugin } from '@migaia/storage-host/sdk'
import { BROWSER_REACTIVE_POLL_INTERVAL_MS } from '../constants.ts'
import type { IBackendConstruction } from '../backends/construction.ts'
import { StorageError } from '../types/errors.ts'
import { StorageBrowserErrorCode } from '@migaia/storage-contract/error-code'

/** Read the optional plugin name without allowing an options accessor to leave the Web boundary. */
export function readBuiltInPluginId<TId extends string>(
  options: { readonly name?: TId },
  fallback: string,
  backend: string
): TId {
  try {
    return (options.name ?? fallback) as TId
  } catch (cause) {
    throw new StorageError(StorageBrowserErrorCode.invalidConfig, { backend, cause })
  }
}

/** Preserve the original create, admission, controller registration and preparation order. */
export function createBuiltInBackendPlugin<
  S extends IKeyValueStore,
  C,
  const TId extends string,
  const F extends IStorageFeatureRecord = {}
>(
  visibility: IStorageReactiveVisibility,
  id: TId,
  createStore: (core: IStoragePluginCore) => IBackendConstruction<S, C>,
  features?: F &
    IStorageFeatureStoreCompatibility<
      IStorageBackendType<S, C, IStorageReactiveProfileExpose>,
      NoInfer<F>
    >,
  journal = false
): IStorageBackendPlugin<IStorageBackendType<S, C, IStorageReactiveProfileExpose>, TId, F> {
  /** Web storage and cookies notify within one page only, so a live query also reconciles. */
  const profile: IStorageReactiveProfile = {
    mode: 'hybrid',
    visibility,
    pollIntervalMs: BROWSER_REACTIVE_POLL_INTERVAL_MS
  }
  /** The descriptor borrows this exact construction; only the host owns its lifetime. */
  const descriptor = (core: IStoragePluginCore<F>) => {
    /** Installation initializes the original native client before lazy Feature getters run. */
    let construction: IBackendConstruction<S, C>
    return {
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
      featureExpose: () => ({
        getClient: () => construction.getClient(),
        reactiveProfile: () => profile
      }),
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
  return (
    defineBackendPlugin as IStorageBackendPluginDefiner<
      IStorageBackendType<S, C, IStorageReactiveProfileExpose>
    >
  )<TId, typeof descriptor, F>({ name: id, features: features as never, open: descriptor as never })
}
