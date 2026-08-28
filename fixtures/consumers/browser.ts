import { createRuntime } from '@migaia/reactive'
import { createStore } from '@migaia/store-light'
import { localStorage } from '@migaia/storage-web/local-storage'
import { cookies } from '@migaia/storage-web/cookies'
import { indexedDb } from '@migaia/storage-web/indexed-db'
import { StoreProvider } from '@migaia/store-react'
import { number as wasmNumber } from '@migaia/store-wasm'
import { createEventChannel, type IEventAbortSignal } from '@migaia/event-subscriber'

const runtime = createRuntime()
const state = createStore({ count: 0 }, { runtime })

document.documentElement.dataset.storeCount = String(state.count)

// storage-web 是 web-only：浏览器主线程消费者验证 localStorage/cookies/indexedDb
// 三个后端工厂都能正常引入并类型检查通过。
void localStorage().set('k', 'v')
void cookies().set('k', 'v')
void indexedDb().dispose()
void StoreProvider
void wasmNumber

const eventChannel = createEventChannel<number>()
const browserSignal: IEventAbortSignal = new AbortController().signal
eventChannel.subscribeUntil(browserSignal, (event) => {
  void event.value
})
