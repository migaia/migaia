import { type ITransactionScope, type records } from '@migaia/storage-contract'
import { StorageError } from '../errors.ts'
import { StorageHostErrorCode } from '@migaia/storage-contract/error-code'
import { StorageErrorText } from '../error-text.ts'
import { isStorageErrorFamily } from '../core/error-family.ts'
import { StorageReactiveVisibility } from '../state-constants.ts'
import { defineBackendPlugin, defineStorageFeature } from '../contracts.ts'
import type {
  IStorageBackendPluginDefiner,
  IStoragePluginCore,
  IStorageFeatureRecord,
  IStorageBackendPlugin,
  IStorageBackendType,
  IStorageFeatureDefiner,
  IStorageReactiveProfile,
  IStorageReactiveProfileExpose,
  IStorageFeatureStoreCompatibility
} from '../types.ts'
import { createMemoryBackend, type IMemoryBackendStore, type IMemoryOptions } from './memory.ts'
import { readMemoryAssembly } from './memory-assembly.ts'
import { snapshotMemoryCapacity } from './memory-capacity.ts'

/** The memory engine as a type: native data and the transaction owner stay in the neutral host. */
export type IMemoryBackend = IStorageBackendType<
  IMemoryBackendStore,
  undefined,
  {
    getTransactionClient(scope: ITransactionScope<unknown, typeof records>): undefined
  } & IStorageReactiveProfileExpose
>

/** Memory changes reach a live query only through its change controller, within this instance. */
function memoryReactiveProfile(hasController: boolean): IStorageReactiveProfile {
  if (!hasController)
    throw new StorageError(
      StorageHostErrorCode.changeControllerNotAssembled,
      {},
      StorageErrorText.changeControllerNotAssembled
    )
  return { mode: 'push', visibility: StorageReactiveVisibility.instance }
}

/** Defines the memory backend's own Features; the annotation carries the backend type. */
export const defineMemoryFeature: IStorageFeatureDefiner<IMemoryBackend> = defineStorageFeature
/** Backend-plugin definer typed for the memory backend. */
const defineMemoryBackend: IStorageBackendPluginDefiner<IMemoryBackend> = defineBackendPlugin

/** Native options plus the plugin name and the Feature record. */
type IMemoryPluginOptions<N extends string, F extends IStorageFeatureRecord> = IMemoryOptions & {
  /** Plugin name and backend lookup key; `'memory'` when omitted. */
  readonly name?: N
  /** Features installed on this backend. */
  readonly features?: F &
    IStorageFeatureStoreCompatibility<IMemoryBackend, NoInfer<F>, IMemoryBackendStore>
}
/** Define an isolated native memory backend; acquisition waits for its original install window. */
export function memoryBackendPlugin<
  const N extends string = 'memory',
  const F extends IStorageFeatureRecord = {}
>(
  options: IMemoryPluginOptions<N, F> = {}
): IStorageBackendPlugin<IMemoryBackend, NoInfer<N>, F, IMemoryBackendStore> {
  /** The plugin identity is captured before registering the original static Feature graph. */
  const captured = (() => {
    try {
      if (typeof options !== 'object' || options === null)
        throw new TypeError(StorageErrorText.memoryOptions)
      /** Own getters are consumed once before native acquisition and the Feature graph is captured. */
      const name = (options.name ?? 'memory') as N
      const features = options.features as F | undefined
      const namespace = options.namespace
      const concurrency = options.concurrency
      const owner = options.owner
      /** Capacity getters detach in the original option capture before any native allocation. */
      const capacity = snapshotMemoryCapacity(options)
      if (owner !== undefined && (typeof owner !== 'object' || owner === null))
        throw new TypeError(StorageErrorText.memoryOwner)
      const label = owner?.label
      if (label !== undefined && typeof label !== 'string')
        throw new TypeError(StorageErrorText.memoryOwner)
      return {
        name,
        features,
        capacity,
        assembly: readMemoryAssembly(features),
        options: { namespace, concurrency, owner: label === undefined ? undefined : { label } }
      }
    } catch (cause) {
      if (isStorageErrorFamily(cause)) throw cause
      throw new StorageError(StorageHostErrorCode.invalidConfig, { backend: 'memory', cause })
    }
  })()
  /** The descriptor captures only its own constructed store, controller and provider installer. */
  const factory = (core: IStoragePluginCore<F>) => {
    /** Native acquisition occurs once in install, before any resource is transferred to the host. */
    let constructed: ReturnType<typeof createMemoryBackend> | undefined
    return {
      featureExpose: () => ({
        getClient: () => undefined,
        reactiveProfile: memoryReactiveProfile,
        getTransactionClient: (scope: ITransactionScope<unknown, typeof records>) => {
          constructed!.assertScope(scope)
          return undefined
        }
      }),
      capabilityInstaller: (_store: IMemoryBackendStore) => constructed!.installer,
      journalBinding: (_store: IMemoryBackendStore) => constructed!.journalBinding,
      install: () => {
        constructed = createMemoryBackend(
          core,
          captured.options,
          captured.capacity,
          captured.assembly
        )
        core.registerStore(constructed.store)
        if (captured.assembly.controller !== undefined)
          core.registerChangeController(constructed.store, constructed.controller)
        core.registerOrgBinding(constructed.store, constructed.orgBinding)
        return {}
      }
    }
  }
  return defineMemoryBackend({
    name: captured.name,
    features: captured.features as never,
    open: factory
  })
}
