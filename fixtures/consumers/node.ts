// @migaia/storage-web 故意不在这里引入：它是 web-only 包（localStorage/
// sessionStorage/document.cookie/IndexedDB 全是浏览器 API），Node 主线程
// 没有这些全局对象。见 docs/storage-web/web-storage-foundation.sdd.md §12.6。
import { MessageChannel } from 'node:worker_threads'
import { createNodeMessagePortTransport } from '@migaia/web-rpc/message-port'
import { Logger, type ILogEntry, type ISink } from '@migaia/logger'
import { createCapabilityHost } from '@migaia/capability'
import { jsonPlugin } from '@migaia/serialize'
import { Signal, createRuntime } from '@migaia/reactive'
import { Resource } from '@migaia/resource'
import { createStore } from '@migaia/store-light'
import { ObservableArray } from '@migaia/store-indexed'
import { atomDef, createAtomStore } from '@migaia/store-keyed'
import { memoryStorage } from '@migaia/store-persist'
import { createSSRRequestScope } from '@migaia/store-ssr'
import { createMutationPolicy } from '@migaia/store-middleware'
import { getDependencyTree } from '@migaia/store-devtools'

const capabilityHost = createCapabilityHost(undefined)
capabilityHost.disposeNow()
jsonPlugin()
const runtime = createRuntime()
new Signal(0, runtime).dispose()
new Resource(() => 1, runtime).dispose()
createStore({ count: 0 }).$dispose()
new ObservableArray([0]).dispose()
createAtomStore(runtime).dispose()
atomDef(0)
memoryStorage()
createSSRRequestScope().dispose()
void createMutationPolicy
void getDependencyTree

const sink: ISink = (entry: ILogEntry) => {
  void entry.message
}
new Logger({
  plugins: [{ name: 'consumer-sink', install: (core: any) => { core.useSink(sink); return {} } }] as const
})

const channel = new MessageChannel()
const transport = createNodeMessagePortTransport(channel.port1)

transport.send({ kind: 'node-consumer-contract' })
channel.port1.close()
channel.port2.close()
