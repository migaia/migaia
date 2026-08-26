/**
 * `@migaia/store-react` 错误码的唯一声明处。
 *
 * 契约见 `docs/contracts/error-codes.md`：错误由 `(source, code)` 二元组唯一定位，`source` 恒为
 * `'@migaia/store-react'`。抛出点必须引用本文件的常量，不得内联字面量。
 *
 * 码值是公开 API 的一部分，改名等同破坏性变更（`docs/contracts/error-code-rollout.sdd.md` §1.2）。
 */
export const StoreReactErrorCode = {
  /**
   * Provider registry 已 `dispose()` 后继续注册/读取。
   *
   * 调用方应新建 registry，不要复用已释放实例。
   */
  registryDisposed: 'REGISTRY_DISPOSED',

  /**
   * Provider registry 释放失败（`AggregateError` 外壳）。
   *
   * 调用方展开 `error.errors` 逐条处理；这是释放路径的不可恢复失败。
   */
  registryDisposalFailed: 'REGISTRY_DISPOSAL_FAILED',

  /**
   * Hook 在缺少 `StoreProvider` 时被调用。
   *
   * 调用方把子树包进 `StoreProvider`，或改用不依赖 Provider 的 protocol hook。
   */
  providerRequired: 'PROVIDER_REQUIRED',

  /**
   * API 需要某个 feature，但它在 Provider 配置里未显式启用。
   *
   * 调用方在 `StoreProvider` 的 `features` 里显式开启该 path。
   */
  featureDisabled: 'FEATURE_DISABLED',

  /**
   * 注册表里没有对应 token 的 store。
   *
   * 调用方确认该 store 已在 registry `register`，且 token 一致。
   */
  storeMissing: 'STORE_MISSING',

  /**
   * 同一个 token 被注册了两次。
   *
   * 调用方去重注册，或让两个 Provider 拥有各自的 registry。
   */
  storeDuplicate: 'STORE_DUPLICATE',

  /**
   * Provider store 属于另一个 Runtime。
   *
   * 调用方让 store 与 registry 使用同一 Runtime；跨 Runtime 注入被拒绝。
   */
  crossRuntime: 'CROSS_RUNTIME',

  /**
   * Provider/token 配置非法（缺 debug name、features.wasm 与 ready 组合矛盾等）。
   *
   * 调用方修正配置后重试；这是永久性配置错误。
   */
  invalidConfig: 'INVALID_CONFIG',

  /**
   * The provider readiness barrier rejected before rendering could continue. The caller should
   * inspect `cause` and fix the underlying store/resource failure.
   */
  readyRejected: 'READY_REJECTED'
} as const

export type IStoreReactErrorCode = (typeof StoreReactErrorCode)[keyof typeof StoreReactErrorCode]
