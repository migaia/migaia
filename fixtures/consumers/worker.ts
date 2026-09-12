import { createWebWorkerTransport } from '@migaia/web-rpc/adapters/web-worker'
import { indexedDbHost } from '@migaia/storage-web/indexed-db'
import { memoryStorageHost } from '@migaia/storage-web/memory'
import { WorkerAdapter } from '@migaia/store-worker'
import { sharedInt32 } from '@migaia/store-shared'

declare const self: DedicatedWorkerGlobalScope

const transport = createWebWorkerTransport(self)
transport.send({ kind: 'worker-consumer-contract' })

// storage-web 在 Worker 上下文里可用的部分：IndexedDB 有，localStorageHost/
// sessionStorageHost/document.cookie 没有（Worker 全局没有 document，
// localStorageHost 也不总是可用）——这个 fixture 只验证类型层能在 WebWorker
// lib 下编译通过；真实 Worker 里运行时可用性未做专门的 e2e 验证，是已知缺口。
void indexedDbHost().dispose()
void memoryStorageHost().dispose()
void WorkerAdapter
void sharedInt32
