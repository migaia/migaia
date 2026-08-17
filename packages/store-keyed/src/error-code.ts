/**
 * `@migaia/store-keyed` 错误码的唯一声明处。
 *
 * 契约见 `docs/contracts/error-codes.md`：错误由 `(source, code)` 二元组唯一定位，`source` 恒为
 * `'@migaia/store-keyed'`。抛出点必须引用本文件的常量，不得内联字面量。
 *
 * 码值是公开 API 的一部分，改名等同破坏性变更（`docs/contracts/error-code-rollout.sdd.md` §1.2）。
 */
export const StoreKeyedErrorCode = {
  /**
   * 在 atom store 释放（disposed）后继续使用它。
   *
   * 调用方不得复用已释放的 store；重新创建 store 实例。
   */
  atomStoreDisposed: 'ATOM_STORE_DISPOSED',

  /**
   * 在 family 释放（disposed）后继续读取/写入其条目。
   *
   * 调用方不得复用已释放的 family；重新 `createFamily()`。
   */
  familyDisposed: 'FAMILY_DISPOSED',

  /**
   * Atom store 或 family 释放时，多个条目清理失败，作为 `AggregateError` 抛出。
   *
   * 各失败原因沿 `errors[]` 可达；调用方按释放失败处理并据此诊断。
   */
  disposalFailed: 'DISPOSAL_FAILED',

  /**
   * Family 容量淘汰时多个条目淘汰失败，作为 `AggregateError` 抛出。
   *
   * 各失败原因沿 `errors[]` 可达；调用方按淘汰失败处理。
   */
  evictionFailed: 'EVICTION_FAILED',

  /**
   * 在同一个渲染/预览栈内检测到循环的 atom 预览。
   *
   * 调用方检查派生依赖是否形成了环。
   */
  circularPreview: 'CIRCULAR_PREVIEW',

  /**
   * Atom override 链成环，无法解析最终定义。
   *
   * 调用方检查 override 目标是否互相指向。
   */
  cyclicOverride: 'CYCLIC_OVERRIDE',

  /**
   * Override 目标破坏了原定义的写入契约（可写 → 只读）。
   *
   * 调用方保持 override 前后的读写语义一致。
   */
  overrideContract: 'OVERRIDE_CONTRACT',

  /**
   * 未标记 `previewSafe` 的 primitive-factory 在预览路径被求值。
   *
   * 调用方为工厂标记 `previewSafe`，或避免在预览阶段触发其求值。
   */
  previewUnsafe: 'PREVIEW_UNSAFE',

  /**
   * 跨 Runtime 访问 atom，两个 Runtime 的依赖图互不可见。
   *
   * 调用方在同一 Runtime 内完成访问，不跨运行时共享 atom。
   */
  crossRuntime: 'CROSS_RUNTIME',

  /**
   * 宿主缺少 family 定义缓存所需的 `WeakRef`/`FinalizationRegistry` 能力。
   *
   * 调用方在宿主沙箱启用这些能力；这是部署问题，不是逻辑错误。
   */
  envUnsupported: 'ENV_UNSUPPORTED',

  /**
   * 入参校验失败：`maxSize`/`ttl` 非法、非 atom 定义、焦点路径为空/不可读写、 键重复、目标键缺失、异步初始值（thenable）。
   *
   * 调用方修正参数；具体是哪个参数见消息文案。
   */
  invalidOption: 'INVALID_OPTION'
} as const;

export type IStoreKeyedErrorCode = (typeof StoreKeyedErrorCode)[keyof typeof StoreKeyedErrorCode];
