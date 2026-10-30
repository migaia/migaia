import { memoryNotificationsFeature } from '../../src/features/memory-notifications.ts'
import { memoryChangeFeedFeature } from '../../src/features/memory-change-feed.ts'
import { afterEach } from 'vitest'
import { createStorageHost } from '../../src/index.ts'
import { memoryBackendPlugin, type IMemoryBackendStore } from '../../src/plugins/memory.ts'
import type { IStorageBackendPluginHandle, IStorageHost } from '../../src/types.ts'
/** Each migrated behavior baseline acquires a genuine installed memory backend and its host. */
const hosts: Array<{ dispose(): Promise<void> }> = []
afterEach(async () => {
  for (const host of hosts.splice(0).reverse()) await host.dispose()
})
/** Install the explicitly supplied entity plugins in a real storage host owned by this test. */
export async function entityHost<const P extends readonly IStorageBackendPluginHandle[]>(
  ...plugins: P
): Promise<IStorageHost<P>> {
  /**
   * The fixture keeps the actual native host; it never connects a repository on the caller's
   * behalf.
   */
  const host = await createStorageHost({ plugins: plugins as never })
  hosts.push(host)
  return host as IStorageHost<P>
}
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
