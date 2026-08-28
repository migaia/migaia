// @migaia/storage-web 主入口是 web-only（localStorage/sessionStorage/document.cookie/
// IndexedDB 全是浏览器 API），Node 主线程没有这些全局对象——见
// docs/storage-web/web-storage-foundation.sdd.md §12.6。但 `memoryStorage` 是纯内存后端
// （Map 实现、SSR/Node/testing 降级目标），经 DOM-free 子路径 `@migaia/storage-web/memory`
// 单独引入，不把 IDB/WebStorage 的 DOM 类型带进来。
import { MessageChannel } from 'node:worker_threads'
import { createNodeMessagePortTransport } from '@migaia/web-rpc/adapters/message-port'
import { Logger, type ILogEntry, type ISink } from '@migaia/logger'
import { createCapabilityHost } from '@migaia/capability'
import { jsonPlugin } from '@migaia/serialize'
import { Signal, createRuntime } from '@migaia/reactive'
import { Resource } from '@migaia/resource'
import { memoryStorage } from '@migaia/storage-web/memory'
import { createStore } from '@migaia/store-light'
import { ObservableArray } from '@migaia/store-indexed'
import { atomDef, createAtomStore } from '@migaia/store-keyed'
import { createSSRRequestScope } from '@migaia/store-ssr'
import { createMutationPolicy } from '@migaia/store-middleware'
import { getDependencyTree } from '@migaia/store-devtools'
import { createEventChannel, type IEventAbortSignal } from '@migaia/event-subscriber'
import { createAbortController, type IAbortSignal } from '@migaia/lifecycle'

const capabilityHost = createCapabilityHost(undefined)
void capabilityHost.dispose()
jsonPlugin()
const runtime = createRuntime()
new Signal(0, runtime).dispose()
new Resource(() => 1, runtime).dispose()
memoryStorage().dispose()
createStore({ count: 0 }).$dispose()
new ObservableArray([0]).dispose()
createAtomStore(runtime).dispose()
atomDef(0)
createSSRRequestScope().dispose()
void createMutationPolicy
void getDependencyTree

const eventChannel = createEventChannel<number>()
const lifecycleSignal: IAbortSignal = createAbortController().signal
const eventSignal: IEventAbortSignal = lifecycleSignal
eventChannel.subscribeUntil(eventSignal, (event) => {
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

const channel = new MessageChannel()
const transport = createNodeMessagePortTransport(channel.port1)

transport.send({ kind: 'node-consumer-contract' })
channel.port1.close()
channel.port2.close()
