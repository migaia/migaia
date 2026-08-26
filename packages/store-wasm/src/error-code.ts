/**
 * `@migaia/store-wasm` 错误码的唯一声明处。
 *
 * 契约见 `docs/contracts/error-codes.md`：错误由 `(source, code)` 二元组唯一定位，`source` 恒为
 * `'@migaia/store-wasm'`。抛出点必须引用本文件的常量，不得内联字面量。
 *
 * 码值是公开 API 的一部分，改名等同破坏性变更（`docs/contracts/error-code-rollout.sdd.md` §1.2）。
 */
export const StoreWasmErrorCode = {
  /**
   * 在 `ensureWasm()` 尚未完成（或失败后）就同步创建/分配字段。
   *
   * 调用方先 `await ensureWasm()`，或用 `StoreProvider` 的 `ready` 屏障保证初始化完成。
   */
  notInitialized: 'NOT_INITIALIZED',

  /**
   * 读写/使用一个已 `dispose()` 的 wasm 字段。
   *
   * 调用方应新建字段，不要复用已释放实例；具体操作进 `detail`。
   */
  fieldDisposed: 'FIELD_DISPOSED',

  /**
   * 字段初始化被取消（AbortSignal）。
   *
   * 调用方按取消处理；这是协作式取消的结果。
   */
  initAborted: 'INIT_ABORTED',

  /**
   * `wasm.record` 的字段名撞上了保留名（`dispose`/`disposed`）。
   *
   * 调用方换一个字段名。
   */
  reservedFieldName: 'RESERVED_FIELD_NAME',

  /**
   * WASM 分配失败或对齐校验失败（byteLen 超 Wasm32 上限、8 字节对齐不满足、读到的长度损坏）。
   *
   * 调用方检查分配参数与内存完整性；这是分配/内存层失败，不是逻辑错误。
   */
  allocationFailed: 'ALLOCATION_FAILED',

  /**
   * 字段构造/写入参数非法（长度超限、granularity 非法、下标/范围越界等）。
   *
   * 调用方修正参数；这是永久性参数错误。
   */
  invalidOption: 'INVALID_OPTION',

  /**
   * 字段释放或构造回滚期间有多个 owned resource 清理失败。
   *
   * 调用方应检查 `AggregateError.errors`；所有原始清理错误均按执行顺序保留。
   */
  cleanupFailed: 'CLEANUP_FAILED'
} as const

export type IStoreWasmErrorCode = (typeof StoreWasmErrorCode)[keyof typeof StoreWasmErrorCode]
