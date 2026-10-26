import type { IAbortSignal } from '@migaia/utils/promise'
import { createRuntime } from '@migaia/reactive'
import { createStore } from '@migaia/store-light'
import { createStorageHost } from '@migaia/storage-host'
import { localStorageBackendPlugin } from '@migaia/storage-web/local-storage'
import { cookieBackendPlugin } from '@migaia/storage-web/cookies'
import { indexedDbBackendPlugin } from '@migaia/storage-web/indexed-db'
import { StoreProvider } from '@migaia/store-react'
import { number as wasmNumber } from '@migaia/store-wasm'
import { createEventChannel } from '@migaia/event-subscriber'
import { subscribeUntil } from '@migaia/event-subscriber/subscriber'

const runtime = createRuntime()
const state = createStore({ count: 0 }, { runtime })

document.documentElement.dataset.storeCount = String(state.count)

/** The browser consumer installs all three public backend plugins through their owning Host. */
const storage = await createStorageHost({
  plugins: [localStorageBackendPlugin(), cookieBackendPlugin(), indexedDbBackendPlugin()]
})
try {
  await storage.backend('local').set('k', 'v')
  await storage.backend('cookies').set('k', 'v')
} finally {
  await storage.dispose()
}
void StoreProvider
void wasmNumber

const eventChannel = createEventChannel<number>()
const browserSignal: IAbortSignal = new AbortController().signal
subscribeUntil(eventChannel, browserSignal, (event) => {
  void event.value
})
