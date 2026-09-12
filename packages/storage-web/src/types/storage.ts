// store 形状契约与运行时收窄 guard 已迁往 `@migaia/storage-contract`；本文件 re-export 以保持既有 import 路径不变。
export type {
  IKeyValueStore,
  ISyncKeyValueStore,
  IRecordStore,
  ISyncCapableStore
} from '@migaia/storage-contract'
export { isKeyValueStore, asRecordStore, isRecordStore } from '@migaia/storage-contract'

/**
 * 结构等价于 DOM 的 `Storage` 接口，但不引用那个全局——只在 lib 里有 "DOM" 时才存在，而本包同时面向 Worker （lib: WebWorker，无
 * DOM）等场景。若这里直接写 `Storage`，即使某个消费者只 import `indexedDbHost`（用不到这个类型）， TypeScript 仍会在解析
 * `@migaia/storage-web` 这个模块的声明图时把整个 barrel 一起类型检查，DOM-only 的 `Storage` 名字 在 WebWorker lib 下解析失败。这是
 * web 后端专用结构，**留在 storage-web**，不进 `@migaia/storage-contract`。
 */
export type IWebStorageLike = {
  readonly length: number
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
  clear(): void
  key(index: number): string | null
}
