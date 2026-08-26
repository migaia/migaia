/**
 * `@migaia/store-middleware` 错误码的唯一声明处。
 *
 * 契约见 `docs/contracts/error-codes.md`：错误由 `(source, code)` 二元组唯一定位，`source` 恒为
 * `'@migaia/store-middleware'`。抛出点必须引用本文件的常量，不得内联字面量。
 *
 * 码值是公开 API 的一部分，改名等同破坏性变更（`docs/contracts/error-code-rollout.sdd.md` §1.2）。
 */
export const StoreMiddlewareErrorCode = {
  /** Host options were null or non-object at the JavaScript package boundary. */
  invalidOption: 'INVALID_OPTION',
  /**
   * Middleware stage 没有调用 `next()`，事件链在此被过滤。
   *
   * 仅诊断（`reportError`），不抛出；调用方检查 stage 是否遗漏了 `next(event)`，或确认本意就是过滤。
   */
  middlewareNotChained: 'MIDDLEWARE_NOT_CHAINED',

  /**
   * 在 `actions-only` 模式下，store 方法之外直接写字段。
   *
   * 调用方应把写入收敛到 store 方法、`$set`/`$hydrate`/`$batch`，或改用 `off` 模式。
   */
  actionScopeRequired: 'ACTION_SCOPE_REQUIRED',

  /**
   * `ClonePolicy.immutable` 遇到 `structuredClone` 无法独立复制的值（函数、DOM 句柄、class 实例）。
   *
   * 调用方改用 `ClonePolicy.diagnostic`/`opaque`，或让该子树可克隆。
   */
  cloneUnsupported: 'CLONE_UNSUPPORTED',

  /**
   * DevTools 的 state 命令（jump/reset）在未配置 `applyState` 时被调用。
   *
   * 调用方在 `bindStoreMiddleware` 的 core 里提供 `applyState`，或不要发起 state 命令。
   */
  devtoolsCapability: 'DEVTOOLS_CAPABILITY',

  /**
   * `ClonePolicy.immutable` 需要 `structuredClone`，但当前环境缺失。
   *
   * 调用方提供 polyfill，或改用 `diagnostic`/`opaque`；这是部署能力缺失，不是逻辑错误。
   */
  envUnsupported: 'ENV_UNSUPPORTED',

  /**
   * Binding or host cleanup failed after all cleanup actions were attempted. The caller must
   * inspect `errors[]` and treat the host as terminal.
   */
  cleanupFailed: 'CLEANUP_FAILED'
} as const

export type IStoreMiddlewareErrorCode =
  (typeof StoreMiddlewareErrorCode)[keyof typeof StoreMiddlewareErrorCode]
