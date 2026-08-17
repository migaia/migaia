/**
 * `@migaia/store-devtools` 错误码的唯一声明处。
 *
 * 契约见 `docs/contracts/error-codes.md`：错误由 `(source, code)` 二元组唯一定位，`source` 恒为
 * `'@migaia/store-devtools'`。抛出点必须引用本文件的常量，不得内联字面量。
 *
 * 码值是公开 API 的一部分，改名等同破坏性变更（`docs/contracts/error-code-rollout.sdd.md` §1.2）。
 */
export const StoreDevtoolsErrorCode = {
  /**
   * `createStoreDevTools` 返回的会话已 `dispose()` 后继续调用其变更方法。
   *
   * 调用方应新建会话，不要复用已关闭实例；只读队列在 dispose 后仍可读。
   */
  sessionDisposed: 'SESSION_DISPOSED',

  /**
   * `jumpTo(id)` 传了一个不在历史里的 id（或已被 `maxHistory` 裁剪掉）。
   *
   * 调用方检查 id 是否仍存活于 `history`；这是永久性参数错误，不要重试同一 id。
   */
  unknownHistoryEntry: 'UNKNOWN_HISTORY_ENTRY'
} as const;

export type IStoreDevtoolsErrorCode =
  (typeof StoreDevtoolsErrorCode)[keyof typeof StoreDevtoolsErrorCode];
