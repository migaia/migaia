// 公共上下文类型已迁往 `@migaia/storage-contract`；本文件 re-export 以保持既有 import 路径不变。
export type {
  IOperationContext,
  IWriteOptions,
  ISyncWriteOptions,
  IConflictPolicy,
  IStorageKey,
  IKeyRange
} from '@migaia/storage-contract'
export { ConflictPolicy } from '@migaia/storage-contract'
