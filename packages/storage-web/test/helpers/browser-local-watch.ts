import { createStorageHost } from '@migaia/storage-host'
import { localStorageBackendPlugin } from '../../src/local-storage.js'

/** One browser fixture retains only its real iterator and host cleanup closures. */
let current:
  | {
      read: () => Promise<unknown>
      close: () => Promise<void>
    }
  | undefined

/** Subscribe before the peer page writes so only native cross-document events can complete read. */
export async function prepareLocalStorageWatch(namespace: string, orgId: string) {
  await current?.close()
  const host = await createStorageHost({ plugins: [localStorageBackendPlugin({ namespace })] })
  const store = host.org(orgId).backend('local')
  const stream = store.watch('theme')
  const pending = stream.next()
  current = {
    read: async () => {
      const result = await pending
      return { change: result.value, value: await store.get('theme') }
    },
    close: async () => {
      await stream.dispose()
      await host.dispose()
    }
  }
  return store.capabilities.changeFeed
}

/** The reader waits on its already-started native iterator rather than a second listener or poll. */
export async function readLocalStorageWatch() {
  return current!.read()
}

/** Release the exact iterator before its host; disposing the borrowed organization grants no close. */
export async function closeLocalStorageWatch() {
  await current?.close()
  current = undefined
}

/** A separate page writes through the same public backend and physical organization mapping. */
export async function writeLocalStorageWatch(namespace: string, orgId: string, value: string) {
  const host = await createStorageHost({ plugins: [localStorageBackendPlugin({ namespace })] })
  try {
    await host.org(orgId).backend('local').set('theme', value)
  } finally {
    await host.dispose()
  }
}

/** Declaration merging exposes only callable native test scenarios to the browser runner. */
declare global {
  interface Window {
    prepareLocalStorageWatch: typeof prepareLocalStorageWatch
    readLocalStorageWatch: typeof readLocalStorageWatch
    closeLocalStorageWatch: typeof closeLocalStorageWatch
    writeLocalStorageWatch: typeof writeLocalStorageWatch
  }
}
window.prepareLocalStorageWatch = prepareLocalStorageWatch
window.readLocalStorageWatch = readLocalStorageWatch
window.closeLocalStorageWatch = closeLocalStorageWatch
window.writeLocalStorageWatch = writeLocalStorageWatch
