/**
 * DOM-free 子路径入口：只导出纯内存后端 `memoryStorageHost`。
 *
 * 与主入口 `@migaia/storage-web`（含 indexedDbHost/localStorageHost/sessionStorageHost/cookiesHost 等 DOM
 * 后端） 分离，供 SSR/Node/testing 等无 DOM 环境按 `@migaia/storage-web/memory` 单独引入，不把 IDB/WebStorage 的 DOM
 * 类型泄漏进编译中立 fixture。
 */
export { memoryStorageHost } from './backends/memory.js'
