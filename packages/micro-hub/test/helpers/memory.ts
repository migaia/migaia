import { onTestFinished } from 'vitest'
import { createStorageHost } from '@migaia/storage-host'
import { memoryBackendPlugin, type IMemoryBackendStore } from '@migaia/storage-host/plugins/memory'

/** Acquire the real memory registration and release its original host after the case settles. */
export async function createMemoryTestStore(): Promise<IMemoryBackendStore> {
  /** Tests exercise the same provider and lifecycle admission as production consumers. */
  const host = await createStorageHost({ plugins: [memoryBackendPlugin()] })
  onTestFinished(() => host.dispose())
  return host.backend('memory')
}
