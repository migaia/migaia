import { afterEach } from 'vitest'
import {
  createStorageHost,
  memoryBackendPlugin,
  type IMemoryBackendStore
} from '../../src/index.js'
/** Each migrated behavior baseline acquires a genuine installed memory backend and its host. */
const hosts: Array<{ dispose(): Promise<void> }> = []
afterEach(async () => {
  for (const host of hosts.splice(0).reverse()) await host.dispose()
})
/** Use public installation; no test fabricates a backend core, transaction owner or resource. */
export async function memoryBackend(): Promise<IMemoryBackendStore> {
  const host = await createStorageHost({ plugins: [memoryBackendPlugin()] })
  hosts.push(host)
  return host.backend('memory')
}
