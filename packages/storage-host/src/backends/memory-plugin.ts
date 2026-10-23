import { type ITransactionScope, type records } from '@migaia/storage-contract'
import { StorageError, StorageErrorCode } from '../errors.js'
import { StorageErrorText } from '../error-text.js'
import { isStorageErrorFamily } from '../core/error-family.js'
import { definePlugin, defineStorageBackendKind } from '../contracts.js'
import type {
  IStoragePluginCore,
  IStorageFeatureRecord,
  IStorageBackendPlugin,
  IStorageFeatureStoreCompatibility
} from '../types.js'
import { createMemoryBackend, type IMemoryBackendStore, type IMemoryOptions } from './memory.js'
import { snapshotMemoryCapacity } from './memory-capacity.js'

/** Exact memory token keeps native data and the original transaction owner in the neutral host. */
export const memoryBackendKind = defineStorageBackendKind<
  IMemoryBackendStore,
  undefined,
  {
    getTransactionClient(scope: ITransactionScope<unknown, typeof records>): undefined
  }
>()('memory')

/** Options preserve the original native fields and literal installation id. */
type IMemoryPluginOptions<N extends string> = IMemoryOptions & { readonly id?: N }
/** Default construction stays literal inside the contextual host plugin tuple. */
export function memoryBackendPlugin(
  options?: IMemoryPluginOptions<'memory'> & { readonly id?: undefined },
  features?: undefined
): IStorageBackendPlugin<typeof memoryBackendKind, 'memory', {}, IMemoryBackendStore>
/** Selected roots are a separate final parameter, independent of native options. */
export function memoryBackendPlugin<const F extends IStorageFeatureRecord>(
  options: (IMemoryPluginOptions<'memory'> & { readonly id?: undefined }) | undefined,
  features: F & IStorageFeatureStoreCompatibility<typeof memoryBackendKind, F, IMemoryBackendStore>
): IStorageBackendPlugin<typeof memoryBackendKind, 'memory', F, IMemoryBackendStore>
/** An explicit id retains its literal without widening the absent Feature set. */
export function memoryBackendPlugin<const N extends string>(
  options: IMemoryPluginOptions<N> & { readonly id: N },
  features?: undefined
): IStorageBackendPlugin<typeof memoryBackendKind, N, {}, IMemoryBackendStore>
/** Explicit ids and selected roots retain both exact public type facts. */
export function memoryBackendPlugin<const N extends string, const F extends IStorageFeatureRecord>(
  options: IMemoryPluginOptions<N> & { readonly id: N },
  features: F & IStorageFeatureStoreCompatibility<typeof memoryBackendKind, F, IMemoryBackendStore>
): IStorageBackendPlugin<typeof memoryBackendKind, N, F, IMemoryBackendStore>
/** Define an isolated native memory backend; acquisition waits for its original install window. */
export function memoryBackendPlugin<
  const N extends string = 'memory',
  const F extends IStorageFeatureRecord = {}
>(
  options: IMemoryPluginOptions<N> = {},
  features?: F & IStorageFeatureStoreCompatibility<typeof memoryBackendKind, F, IMemoryBackendStore>
): IStorageBackendPlugin<typeof memoryBackendKind, N, F, IMemoryBackendStore> {
  /** The plugin identity is captured before registering the original static Feature graph. */
  const captured = (() => {
    try {
      if (typeof options !== 'object' || options === null)
        throw new TypeError(StorageErrorText.memoryOptions)
      /** Own getters are consumed once before native acquisition and the Feature graph is captured. */
      const id = (options.id ?? 'memory') as N
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
        id,
        features,
        capacity,
        options: { namespace, concurrency, owner: label === undefined ? undefined : { label } }
      }
    } catch (cause) {
      if (isStorageErrorFamily(cause)) throw cause
      throw new StorageError(StorageErrorCode.invalidConfig, { backend: 'memory', cause })
    }
  })()
  /** The descriptor captures only its own constructed store, controller and provider installer. */
  const factory = (core: IStoragePluginCore<F>) => {
    /** Native acquisition occurs once in install, before any resource is transferred to the host. */
    let constructed: ReturnType<typeof createMemoryBackend> | undefined
    return {
      kind: memoryBackendKind,
      featureExpose: () => ({
        getClient: () => undefined,
        getTransactionClient: (scope: ITransactionScope<unknown, typeof records>) => {
          constructed!.assertScope(scope)
          return undefined
        }
      }),
      capabilityInstaller: (_store: IMemoryBackendStore) => constructed!.installer,
      install: () => {
        constructed = createMemoryBackend(core, captured.options, captured.capacity)
        core.registerStore(constructed.store)
        core.registerChangeController(constructed.store, constructed.controller)
        core.registerOrgBinding(constructed.store, constructed.orgBinding)
        return {}
      }
    }
  }
  return definePlugin<N, typeof factory, F>(captured.id, factory, captured.features)
}
