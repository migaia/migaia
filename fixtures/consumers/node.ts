/** Check real package declarations for a DOM-free Node consumer, including native RPC message IO. */
// @migaia/storage-web 主入口是 web-only（localStorageHost/sessionStorageHost/document.cookie/
// IndexedDB 全是浏览器 API），Node 主线程没有这些全局对象——见
// 但 `memoryStorageHost` 是纯内存后端
// （Map 实现、SSR/Node/testing 降级目标），经 DOM-free 子路径 `@migaia/storage-web/memory`
// 单独引入，不把 IDB/WebStorage 的 DOM 类型带进来。
import { MessageChannel } from 'node:worker_threads'
import type { IRpcMessageIO } from '@migaia/rpc-host/sdk'
import { Logger, type ILogEntry, type ISink } from '@migaia/logger'
import { createCapabilityHost } from '@migaia/capability'
import { jsonPlugin } from '@migaia/serialize'
import { createRuntime } from '@migaia/reactive'
import { Resource } from '@migaia/resource'
import { memoryStorageHost } from '@migaia/storage-web/memory'
import { createStore } from '@migaia/store-light'
import { ObservableArray } from '@migaia/store-indexed'
import { atomDef, createAtomStore } from '@migaia/store-keyed'
import { createSSRRequestScope } from '@migaia/store-ssr'
import { createMutationPolicy } from '@migaia/store-middleware'
import { getDependencyTree } from '@migaia/store-devtools'
import { createEventChannel } from '@migaia/event-subscriber'
import { subscribeUntil } from '@migaia/event-subscriber/subscriber'
import { createAbortController } from '@migaia/lifecycle'
import type { IAbortSignal } from '@migaia/utils/promise'

const capabilityHost = createCapabilityHost(undefined)
void capabilityHost.dispose()
jsonPlugin()
const runtime = createRuntime()
runtime.signal(0).dispose()
new Resource(() => 1, runtime).dispose()
memoryStorageHost().dispose()
createStore({ count: 0 }).$dispose()
new ObservableArray([0]).dispose()
createAtomStore(runtime).dispose()
atomDef(0)
createSSRRequestScope().dispose()
void createMutationPolicy
void getDependencyTree

const eventChannel = createEventChannel<number>()
const lifecycleSignal: IAbortSignal = createAbortController().signal
const eventSignal: IAbortSignal = lifecycleSignal
subscribeUntil(eventChannel, eventSignal, (event) => {
  void event.value
})

const sink: ISink = (entry: ILogEntry) => {
  void entry.message
}
new Logger({
  execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
  plugins: [
    {
      name: 'consumer-sink',
      install: (core: any) => {
        core.useSink(sink)
        return {}
      }
    }
  ] as const
})

/** The native channel remains the consumer's resource rather than a second RPC endpoint. */
const channel = new MessageChannel()
/** Node adapter authors implement native IO; the SDK alone owns carrier/codec/session behavior. */
const messageIO: IRpcMessageIO = {
  /** Native handoff preserves the actual transfer list and the SDK's write-start callback. */
  send: (value, transfer, options) => {
    options?.onWriteStart?.()
    channel.port1.postMessage(value, transfer)
  },
  /** The carrier owns this native listener's lifetime through its exact removal receipt. */
  onMessage: (listener) => {
    channel.port1.on('message', listener)
    return () => {
      channel.port1.off('message', listener)
    }
  },
  /** Native close notification retires the same carrier without a second connection owner. */
  onClose: (listener) => {
    channel.port1.on('close', listener)
    return () => {
      channel.port1.off('close', listener)
    }
  },
  /** Native cleanup belongs to the original channel endpoint. */
  close: () => channel.port1.close()
}
void messageIO
channel.port1.close()
channel.port2.close()
