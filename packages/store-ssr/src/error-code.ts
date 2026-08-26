/**
 * `@migaia/store-ssr` 错误码的唯一声明处。
 *
 * 契约见 `docs/contracts/error-codes.md`：错误由 `(source, code)` 二元组唯一定位，`source` 恒为
 * `'@migaia/store-ssr'`。抛出点必须引用本文件的常量，不得内联字面量。
 *
 * 码值是公开 API 的一部分，改名等同破坏性变更（`docs/contracts/error-code-rollout.sdd.md` §1.2）。
 */
export const StoreSsrErrorCode = {
  /**
   * 在请求 scope 释放（disposed）后继续注册/脱水/读取。
   *
   * 调用方不得复用已释放的请求 scope；每个请求新建一个 `SSRRequestScope`。
   */
  scopeDisposed: 'SCOPE_DISPOSED',

  /**
   * 请求 scope 释放时多个 store/resource 清理失败，作为 `AggregateError` 抛出。
   *
   * 各失败原因沿 `errors[]` 可达；调用方按释放失败处理。
   */
  scopeDisposalFailed: 'SCOPE_DISPOSAL_FAILED',

  /**
   * `hydrate()` 对多个 store/resource 应用失败，作为 `AggregateError` 抛出（尽力而为，非原子）。
   *
   * 各失败原因沿 `errors[]` 可达；调用方按水合失败处理。
   */
  hydrateFailed: 'HYDRATE_FAILED',

  /**
   * SSR 快照形状非法：`stores`/`resources` 不是纯对象，或某个资源快照字段非法。
   *
   * 调用方检查传入的 `ISSRState` 结构。
   */
  invalidSnapshot: 'INVALID_SNAPSHOT',

  /**
   * 内联状态脚本 id 非法，或 `ISSRState.version` 不是受支持的 1。
   *
   * 调用方使用合法 id / 受支持的版本号。
   */
  invalidStateScript: 'INVALID_STATE_SCRIPT',

  /**
   * SSR store/resource 注册键非法（空串或 `__proto__`）。
   *
   * 调用方使用非空、非保留的字符串键。
   */
  invalidStoreKey: 'INVALID_STORE_KEY',

  /**
   * 载荷包含无法 JSON 序列化的值：循环引用、非有限数、非纯对象、 超节点/深度上限、或非 JSON 类型。
   *
   * 调用方把状态收敛为可 JSON 序列化的纯值。
   */
  serializeUnsupported: 'SERIALIZE_UNSUPPORTED',

  /**
   * 入参校验失败：`timeoutMs` 非法、同时给 `runtime` 与 `runtimeOptions`、键重复。
   *
   * 调用方修正参数；具体是哪个参数见消息文案。
   */
  invalidOption: 'INVALID_OPTION',

  /**
   * 注册的 store/resource 属于另一个 Runtime，与本请求 scope 不隔离。
   *
   * 调用方在同一 Runtime 内创建 store/resource 再注册。
   */
  crossRuntime: 'CROSS_RUNTIME',

  /**
   * Codec 契约/注册问题：encode 返回了 value chunk（应产出 wire 数据）， 或载荷引用的 codec 类型在读取侧未注册。
   *
   * 调用方修正 codec 输出，或先注册对应 codec 再读取。
   */
  codecContract: 'CODEC_CONTRACT',

  /**
   * `awaitResources()` 期间资源持续注册新资源，超过探测轮数上限仍未收敛。
   *
   * 调用方检查资源工厂/依赖是否形成了无限注册链。
   */
  resourceRoundLimit: 'RESOURCE_ROUND_LIMIT',

  /**
   * A registered resource did not settle before the SSR deadline. The caller may render without
   * that resource or retry on the client.
   */
  resourceTimeout: 'RESOURCE_TIMEOUT'
} as const

export type IStoreSsrErrorCode = (typeof StoreSsrErrorCode)[keyof typeof StoreSsrErrorCode]
