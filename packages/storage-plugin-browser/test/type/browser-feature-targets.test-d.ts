import { memoryTestFeatures } from '../helpers/memory-features.ts'
import { memoryBackendPlugin, type IMemoryBackend } from '@migaia/storage-host/plugins/memory'
import { localStorageBackendPlugin, type ILocalStorageBackend } from '../../src/local-storage.ts'
import { reactiveFeature } from '../../src/features/reactive.ts'

/** Targets retain opaque native identities through the backend's `features` option. */
memoryBackendPlugin({
  features: {
    ...memoryTestFeatures,
    reactive: reactiveFeature<IMemoryBackend>()
  }
})
localStorageBackendPlugin({ features: { reactive: reactiveFeature<ILocalStorageBackend>() } })
memoryBackendPlugin({
  features: {
    ...memoryTestFeatures,
    // @ts-expect-error the first-party Feature target must match the actual native backend type.
    reactive: reactiveFeature<ILocalStorageBackend>()
  }
})

/** One explicitly multi-target Feature remains valid for each selected backend type. */
const shared = reactiveFeature<[IMemoryBackend, ILocalStorageBackend]>()
memoryBackendPlugin({ features: { ...memoryTestFeatures, reactive: shared } })
localStorageBackendPlugin({ features: { reactive: shared } })
