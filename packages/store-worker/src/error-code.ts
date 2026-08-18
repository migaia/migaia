/**
 * `@migaia/store-worker` 错误码的唯一声明处。
 *
 * 契约见 `docs/contracts/error-codes.md`：错误由 `(source, code)` 二元组唯一定位，`source` 恒为
 * `'@migaia/store-worker'`。抛出点必须引用本文件的常量，不得内联字面量。
 *
 * 码值是公开 API 的一部分，改名等同破坏性变更（`docs/contracts/error-code-rollout.sdd.md` §1.2）。
 */
export const StoreWorkerErrorCode = {
  /** Worker parser/adapter options were not an object at the JavaScript boundary. */
  invalidOption: 'INVALID_OPTION',
  /**
   * Worker 适配器已释放后继续调用。
   *
   * 调用方不得复用已释放的适配器；重新创建适配器实例。
   */
  adapterDisposed: 'ADAPTER_DISPOSED',

  /**
   * Worker 侧的序列化请求被协作式取消（AbortSignal）。
   *
   * 调用方按取消处理；`ownership: 'transfer'` 时输入已 detach 不可重试。
   */
  requestAborted: 'REQUEST_ABORTED',

  /**
   * 发给 worker 的请求 chunk 形状非法。
   *
   * 调用方检查请求负载是否符合 `ISerializeChunk` 形状；这是协议错误。
   */
  invalidRequestChunk: 'INVALID_REQUEST_CHUNK',

  /**
   * Worker 返回的 chunk 形状非法。
   *
   * 调用方检查 worker 侧 parser 输出；这是 worker 实现错误。
   */
  invalidResponseChunk: 'INVALID_RESPONSE_CHUNK',

  /**
   * 合并 worker 产出的 wire chunk 失败（空列表，或把 value 段并入字节流）。
   *
   * 调用方检查 worker parser 的输出分段；这是 parser 实现错误。
   */
  chunkMergeFailed: 'CHUNK_MERGE_FAILED',

  /**
   * Endpoint and/or owned Worker cleanup failed during parser disposal. The caller must inspect
   * `cause`/`errors[]` and treat the parser as terminal.
   */
  cleanupFailed: 'CLEANUP_FAILED'
} as const;

export type IStoreWorkerErrorCode =
  (typeof StoreWorkerErrorCode)[keyof typeof StoreWorkerErrorCode];
