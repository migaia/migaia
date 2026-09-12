import { createRuntime } from '@migaia/reactive'
import { createStore } from '@migaia/store-light'
import { localStorageHost } from '@migaia/storage-web/local-storage'
import { cookiesHost } from '@migaia/storage-web/cookies'
import { indexedDbHost } from '@migaia/storage-web/indexed-db'
import { StoreProvider } from '@migaia/store-react'
import { number as wasmNumber } from '@migaia/store-wasm'
import { createEventChannel, type IEventAbortSignal } from '@migaia/event-subscriber'

const runtime = createRuntime()
const state = createStore({ count: 0 }, { runtime })

document.documentElement.dataset.storeCount = String(state.count)

// storage-web 是 web-only：浏览器主线程消费者验证 localStorageHost/cookiesHost/indexedDbHost
// 三个后端工厂都能正常引入并类型检查通过。
void localStorageHost().set('k', 'v')
void cookiesHost().set('k', 'v')
void indexedDbHost().dispose()
void StoreProvider
void wasmNumber

const eventChannel = createEventChannel<number>()
const browserSignal: IEventAbortSignal = new AbortController().signal
eventChannel.subscribeUntil(browserSignal, (event) => {
  void event.value
})
