/**
 * `@migaia/serialize` 错误码的唯一声明处。
 *
 * 契约见 `docs/contracts/error-codes.md`：错误由 `(source, code)` 二元组唯一定位，`source` 恒为
 * `'@migaia/serialize'`。抛出点必须引用本文件的常量，不得内联字面量。
 *
 * 码值是公开 API 的一部分，改名等同破坏性变更（`docs/contracts/error-code-rollout.sdd.md` §1.2）。
 */
export const SerializeErrorCode = {
  /**
   * `registry.dispose()` 之后又调用 `encode`/`decode`。
   *
   * 调用方应新建 registry，不要复用已释放实例。落实 registry 的两阶段「先切断新请求，再释放」契约。
   */
  registryDisposed: 'REGISTRY_DISPOSED',

  /**
   * 请求的 `type` 没有对应的注册 parser。
   *
   * 调用方检查插件是否已注册、存档格式标签是否正确；这是稳定的配置/格式问题，不要重试同一 type。
   */
  codecNotFound: 'CODEC_NOT_FOUND',

  /**
   * 编码期失败：parser `encode` 抛错、流式编码中途失败、或产出为空。
   *
   * 原始异常在 `cause`；调用方按 `chunkIndex`/`bytesConsumed` 定位损坏位置。
   */
  encodeFailed: 'ENCODE_FAILED',

  /**
   * 解码期失败：parser `decode` 抛错、或流式解码中途失败。
   *
   * 原始异常在 `cause`；调用方按 `chunkIndex`/`bytesConsumed` 定位损坏位置。
   */
  decodeFailed: 'DECODE_FAILED',

  /**
   * Chunk 形状非法（不是 `[type, data]` 对、text/bytes 数据类型错、未知形态标签、 或 value 段被用于只接受线材的载体）。
   *
   * 调用方检查 parser 输出与输入 chunk；这是 parser 实现错误或存档损坏，不是后端问题。
   */
  invalidChunk: 'INVALID_CHUNK',

  /**
   * 编解码被协作式取消（`AbortSignal` 在 parser 返回后被中止）。
   *
   * 调用方按取消处理，可用新 signal 重试；与 `ENCODE_FAILED`/`DECODE_FAILED` 的不可恢复失败区分。
   */
  aborted: 'ABORTED',

  /**
   * 入参校验失败：非法插件 type、空插件表、重复插件 type、帧预算/maxInFlight 非法、scheduler 结构非法（非 `{ now, schedule }` 鸭子类型）。
   *
   * 调用方修正参数；具体是哪个参数见消息文案。
   */
  invalidOption: 'INVALID_OPTION',

  /**
   * 环境能力缺失：`createSerializeRegistry` 构造期探测不到 `TextEncoder`/`TextDecoder`（Encoding API）。
   *
   * 调用方要么注入 `encoder`/`decoder`，要么在具备 Encoding API 的宿主运行；原始缺失原因在 `cause`。
   */
  envUnsupported: 'ENV_UNSUPPORTED'
} as const;

export type ISerializeErrorCode = (typeof SerializeErrorCode)[keyof typeof SerializeErrorCode];
