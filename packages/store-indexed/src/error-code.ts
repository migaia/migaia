/**
 * `@migaia/store-indexed` 错误码的唯一声明处。
 *
 * 契约见 `docs/contracts/error-codes.md`：错误由 `(source, code)` 二元组唯一定位，`source` 恒为
 * `'@migaia/store-indexed'`。抛出点必须引用本文件的常量，不得内联字面量。
 *
 * 码值是公开 API 的一部分，改名等同破坏性变更（`docs/contracts/error-code-rollout.sdd.md` §1.2）。
 */
export const StoreIndexedErrorCode = {
  /**
   * 集合已 `dispose()` 后继续读写。
   *
   * 调用方应新建集合，不要复用已释放实例。
   */
  collectionDisposed: 'COLLECTION_DISPOSED',

  /**
   * `ObservableArray` 下标越界。
   *
   * 调用方检查下标是否在 `[0, length)`；这是永久性参数错误，不要重试同一下标。
   */
  indexOutOfRange: 'INDEX_OUT_OF_RANGE',

  /**
   * `ObservableArray` 下标不是整数。
   *
   * 调用方修正下标；数组索引必须为整数。
   */
  invalidIndex: 'INVALID_INDEX',

  /**
   * 在一次 tracked 读取中读取了属于另一个 Runtime 的集合。
   *
   * 调用方让集合与订阅它的 effect/observer 使用同一 Runtime；`peek` 不受此限制。
   */
  crossRuntime: 'CROSS_RUNTIME'
} as const;

export type IStoreIndexedErrorCode =
  (typeof StoreIndexedErrorCode)[keyof typeof StoreIndexedErrorCode];
