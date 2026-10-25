import { memoryTestFeatures } from '../helpers/memory-features.js'
import { memoryBackendKind, memoryBackendPlugin } from '@migaia/storage-host'
import { localStorageBackendKind, localStorageBackendPlugin } from '../../src/local-storage.js'
import { reactiveFeature } from '../../src/features/reactive.js'

/** Targets retain opaque native identities through the backend's second Feature argument. */
memoryBackendPlugin(undefined, {
  ...memoryTestFeatures,
  reactive: reactiveFeature(memoryBackendKind)
})
localStorageBackendPlugin(undefined, { reactive: reactiveFeature(localStorageBackendKind) })
// @ts-expect-error the first-party Feature target must match the actual native backend kind.
memoryBackendPlugin(undefined, {
  ...memoryTestFeatures,
  reactive: reactiveFeature(localStorageBackendKind)
})

/** One explicitly multi-target Feature remains valid for each selected kind. */
const shared = reactiveFeature([memoryBackendKind, localStorageBackendKind])
memoryBackendPlugin(undefined, { ...memoryTestFeatures, reactive: shared })
localStorageBackendPlugin(undefined, { reactive: shared })
