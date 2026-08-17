/**
 * `@migaia/store-persist` 错误码的唯一声明处。
 *
 * 契约见 `docs/contracts/error-codes.md`：错误由 `(source, code)` 二元组唯一定位，`source` 恒为
 * `'@migaia/store-persist'`。抛出点必须引用本文件的常量，不得内联字面量。
 *
 * 码值是公开 API 的一部分，改名等同破坏性变更（`docs/contracts/error-code-rollout.sdd.md` §1.2）。
 */
export const StorePersistErrorCode = {
  /**
   * 没有为某个 key 解析到 codec。
   *
   * 调用方为 `persist`/`persistUnit` 显式提供 `codec`，或确认默认 codec 可用。
   */
  codecNotResolved: 'CODEC_NOT_RESOLVED',

  /**
   * Codec 的产出形态与后端能力/契约不匹配（structured 不受支持、binary 未产出字节、text 未产出字符串等）。
   *
   * 调用方检查 codec 的 `output` 与后端 `capabilities`；这是配置/实现错配，不是瞬时失败。
   */
  codecOutputMismatch: 'CODEC_OUTPUT_MISMATCH',

  /**
   * Binary codec 需要后端的 `getBytes`/`setBytes` 能力，但当前 storage 不具备。
   *
   * 调用方换一个 record-capable 后端（memory/IndexedDB），或改用 text codec。
   */
  backendCapability: 'BACKEND_CAPABILITY',

  /**
   * 存档 envelope 非法或版本与当前 store 不匹配（缺 state、version 不可用、版本不一致需 migrate）。
   *
   * 调用方检查存档是否被损坏、version 是否与 `persist` 配置一致；版本不一致时提供 `migrate`。
   */
  envelopeInvalid: 'ENVELOPE_INVALID',

  /**
   * 编码失败（JSON codec 无法序列化该值）。
   *
   * 调用方检查待存值是否可 JSON 序列化；原始异常在 `cause`。
   */
  encodeFailed: 'ENCODE_FAILED',

  /**
   * Hydrate 与随后的写回都失败了（`AggregateError`，两个原因都沿链可达）。
   *
   * 调用方展开 `error.errors` 分别处理；这是双重失败，不是单一瞬时错误。
   */
  hydrateAndWriteFailed: 'HYDRATE_AND_WRITE_FAILED',

  /**
   * 持久化操作因 `dispose()` 被中止（错误名保持 `AbortError`）。
   *
   * 调用方按取消处理；dispose 后不再写回。
   */
  abortedByDispose: 'ABORTED_BY_DISPOSE',

  /**
   * 持久化配置入参非法（version 必须是安全非负整数等）。
   *
   * 调用方修正配置后重试；这是永久性参数错误。
   */
  invalidOption: 'INVALID_OPTION'
} as const;

export type IStorePersistErrorCode =
  (typeof StorePersistErrorCode)[keyof typeof StorePersistErrorCode];
