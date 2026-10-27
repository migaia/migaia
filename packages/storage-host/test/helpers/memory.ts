import { memoryNotificationsFeature } from '../../src/features/memory-notifications.js'
import { memoryChangeFeedFeature } from '../../src/features/memory-change-feed.js'
import { afterEach } from 'vitest'
import { createStorageHost } from '../../src/index.js'
import { memoryBackendPlugin, type IMemoryBackendStore } from '../../src/plugins/memory.js'
/** Each migrated behavior baseline acquires a genuine installed memory backend and its host. */
const hosts: Array<{ dispose(): Promise<void> }> = []
afterEach(async () => {
  for (const host of hosts.splice(0).reverse()) await host.dispose()
})
/** This fixture explicitly selects the native notification and change-feed Features. */
export type IMemoryBackendWithChangeFeed = IMemoryBackendStore & {
  readonly capabilities: IMemoryBackendStore['capabilities'] & { readonly changeFeed: true }
}
/** Use public installation; no test fabricates a backend core, transaction owner or resource. */
export async function memoryBackend(): Promise<IMemoryBackendWithChangeFeed> {
  const host = await createStorageHost({
    plugins: [
      memoryBackendPlugin(undefined, {
        notifications: memoryNotificationsFeature(),
        changeFeed: memoryChangeFeedFeature()
      })
    ]
  })
  hosts.push(host)
  return host.backend('memory') as IMemoryBackendWithChangeFeed
}
