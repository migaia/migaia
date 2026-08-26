/**
 * `@migaia/store-shared` 错误码的唯一声明处。
 *
 * 契约见 `docs/contracts/error-codes.md`：错误由 `(source, code)` 二元组唯一定位，`source` 恒为
 * `'@migaia/store-shared'`。抛出点必须引用本文件的常量，不得内联字面量。
 *
 * 码值是公开 API 的一部分，改名等同破坏性变更（`docs/contracts/error-code-rollout.sdd.md` §1.2）。
 */
export const StoreSharedErrorCode = {
  /**
   * `SharedInt32Array` 已 `dispose()` 后继续读写。
   *
   * 调用方应新建数组，不要复用已释放实例。
   */
  arrayDisposed: 'ARRAY_DISPOSED',

  /**
   * `SharedInt32Signal` 已 `dispose()` 后继续读写。
   *
   * 调用方应新建 signal，不要复用已释放实例。
   */
  signalDisposed: 'SIGNAL_DISPOSED',

  /**
   * 传入的 SharedArrayBuffer 太小，放不下要求的 cell 布局。
   *
   * 调用方应分配更大的 buffer；这是构造期参数错误，不要重试同一 buffer。
   */
  bufferTooSmall: 'BUFFER_TOO_SMALL',

  /**
   * `SharedInt32Array` 下标越界。
   *
   * 调用方检查下标是否在 `[0, length)`；这是永久性参数错误。
   */
  indexOutOfRange: 'INDEX_OUT_OF_RANGE',

  /**
   * Seqlock 在自旋上限内未 settle（cell 未稳定 / 锁未获取 / update 持续失败）。
   *
   * 通常是某个写者持锁期间崩溃留下的死锁，无法自愈；调用方应重建 buffer。
   */
  contentionLimit: 'CONTENTION_LIMIT',

  /**
   * `Atomics.waitAsync` 在当前环境不可用。
   *
   * 调用方用 `sync()` 自己拉取，或换支持 waitAsync 的运行时；库不做静默降级。
   */
  envUnsupported: 'ENV_UNSUPPORTED',

  /**
   * 构造/写入口参非法（长度非负整数、int32 范围）。
   *
   * 调用方修正入参；这是永久性参数错误。
   */
  invalidOption: 'INVALID_OPTION'
} as const

export type IStoreSharedErrorCode = (typeof StoreSharedErrorCode)[keyof typeof StoreSharedErrorCode]
