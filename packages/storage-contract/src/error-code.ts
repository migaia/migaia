/**
 * `@migaia/storage-contract` 错误码的唯一声明处。
 *
 * 契约见 `docs/contracts/error-codes.md`：错误由 `(source, code)` 二元组唯一定位，`source` 恒为
 * `'@migaia/storage-contract'`。抛出点必须引用本文件的常量，不得内联字面量。
 *
 * 码值是公开 API 的一部分，改名等同破坏性变更。
 */
export const StorageContractErrorCode = Object.freeze({
  /**
   * 契约级入参/描述符结构校验失败：codec 描述符、capabilities 描述符、key 域、transaction 选项、 operation context
   * 等公共契约类型不符合声明的形状。
   *
   * 落实 `docs/store-persist/storage-web-integration.sdd.md` §4.2：运行期公共 API 参数与 contract 结构校验用
   * `INVALID_ARGUMENT`（adapter 专有配置校验用 web 的 `INVALID_CONFIG`，不归本码）。
   *
   * 调用方修正入参后重试；这是永久性传参错误，不是可重试的瞬时失败。
   */
  invalidArgument: 'INVALID_ARGUMENT',

  /**
   * `IStorageKey` 违反 key 域（类型非法、深度/节点/二进制字节超限、循环、空数组）。
   *
   * 落实 `docs/store-persist/storage-web-integration.sdd.md` §4.2 的契约级 key 域校验。
   *
   * 调用方修正 key；这是永久性错误，不要重试同一 key。
   */
  invalidKey: 'INVALID_KEY',

  /**
   * 调用了当前后端不提供的能力（`asRecordStore` 收窄失败、structured codec 落到 text-only 后端）。
   *
   * 落实 `docs/store-persist/storage-web-integration.sdd.md` §4.2 的契约级能力收窄语义。
   *
   * 调用方应先用 `capabilities`/`isRecordStore` 分支，或换一个具备该能力的后端；不做静默降级。
   */
  unsupported: 'UNSUPPORTED_CAPABILITY',

  /**
   * Store 已 `dispose()` 后继续调用其任何方法（契约生命周期违规）。
   *
   * 落实 `docs/store-persist/storage-web-integration.sdd.md` §4.2 的契约级生命周期语义。
   *
   * 调用方应新建 store，不要复用已关闭实例。
   */
  disposed: 'STORE_DISPOSED',

  /**
   * 操作被 `IOperationContext.signal` 取消或 `timeoutMs` 到期（契约级取消语义）。
   *
   * 落实 `docs/store-persist/storage-web-integration.sdd.md` §4.2 的契约级取消语义。
   *
   * 调用方按取消处理；已进入原子提交的写按提交事实返回，不伪报回滚。
   */
  aborted: 'ABORTED'
} as const)

export type IStorageContractErrorCode =
  (typeof StorageContractErrorCode)[keyof typeof StorageContractErrorCode]
