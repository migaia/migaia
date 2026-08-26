// 能力描述类型与 guard 已迁往 `@migaia/storage-contract`；本文件 re-export 以保持既有 import 路径不变。
export type { IBackendKind, IStorageCapabilities } from '@migaia/storage-contract'
export { snapshotStorageCapabilities, isStorageCapabilities } from '@migaia/storage-contract'
