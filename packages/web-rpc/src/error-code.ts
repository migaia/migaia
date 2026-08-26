/**
 * `@migaia/web-rpc` 错误码的唯一声明处。
 *
 * 契约见 `docs/contracts/error-codes.md`：错误由 `(source, code)` 二元组唯一定位，`source` 恒为
 * `'@migaia/web-rpc'`。抛出点必须引用本文件的常量，不得内联字面量。
 *
 * 码值是公开 API 的一部分，改名等同破坏性变更（`docs/contracts/error-code-rollout.sdd.md` §1.2）。
 * 标注「预留」的码保留在公开表里以维持稳定，但当前没有抛出点（见 `docs/contracts/error-codes.md` §7「注册一致」的「仅诊断/预留」口径）。
 */
export const WebRpcErrorCode = {
  /**
   * 两个 middleware 在同一 factory 里声明了相同的 `name`。
   *
   * 安装器在安装任何 middleware 之前拒绝；调用方应给每个 middleware 唯一的 name。落实 §7.1 的 「重复 singleton middleware 创建失败」。
   */
  middlewareDuplicated: 'MIDDLEWARE_DUPLICATED',

  /**
   * 某个必需 capability 未安装，却执行了依赖它的操作。
   *
   * 例如未装 `connect` 就构造 endpoint、未装 `ping` 就调用 `ping()`、未装 `abort` 就传 `signal`。 调用方应补齐对应的
   * middleware。
   */
  middlewareMissing: 'MIDDLEWARE_MISSING',

  /**
   * 某个 middleware 安装失败（`WebRpcError`，cause 挂原始安装异常）。
   *
   * 调用方检查 middleware 工厂实现；安装失败是稳定错误，不要对同一描述符重试。
   */
  pluginInstallFailed: 'PLUGIN_INSTALL_FAILED',

  /**
   * Factory / middleware / transport 描述符非法或配置字段取值不合法。
   *
   * 这是参数/配置类错误的统一出口；调用方应按 `detail` 修正配置后重试，不要对同一份配置重试。
   */
  invalidConfig: 'INVALID_CONFIG',

  /**
   * 同一个 method 被 `provide()` 注册了两次。
   *
   * 同名 provider 不覆盖；调用方应合并实现或改名。
   */
  providerDuplicated: 'PROVIDER_DUPLICATED',

  /**
   * 预留：生成 `generatedId` 所需的安全随机源不可用。
   *
   * 当前实现把该路径归一为 `INVALID_CONFIG`；保留此码用于未来把「随机源缺失」从「配置错误」中独立出来。
   */
  uuidUnavailable: 'UUID_UNAVAILABLE',

  /**
   * 预留：`uuid.generate` 返回了空字符串。
   *
   * 当前实现走 `INVALID_CONFIG`；保留此码用于未来把 generator 返回值校验独立出来。
   */
  uuidInvalid: 'UUID_INVALID',

  /**
   * 预留：新生成的 taskId 与当前 Pending Map 冲突。
   *
   * 当前实现走 `INVALID_CONFIG`；保留此码用于未来把「ID 冲突」从「配置错误」中独立出来。
   */
  uuidConflict: 'UUID_CONFLICT',

  /**
   * Protocol codec / scheme / envelope 非法，作为 `WebRpcProtocolError` 的基础码。
   *
   * 调用方检查 protocol 配置与对端 scheme 是否一致，不要对同一报文重试。
   */
  protocolInvalid: 'PROTOCOL_INVALID',

  /**
   * 预留：收到不支持的 protocol scheme。
   *
   * 当前实现丢弃并触发 hooks；保留此码用于未来把「scheme 不支持」从「protocol 非法」中细分。
   */
  protocolUnsupported: 'PROTOCOL_UNSUPPORTED',

  /**
   * 预留：protocol 解密失败。
   *
   * 当前实现归一为 `PROTOCOL_INVALID`；保留此码用于未来把「解密失败」独立出来。
   */
  protocolDecryptFailed: 'PROTOCOL_DECRYPT_FAILED',

  /**
   * Contract 字段、方向或 request/response 关联不合法，作为 `WebRpcContractError` 的基础码。
   *
   * 调用方检查 version、identifier、sender/target 方向或 taskId/method 关联。
   */
  contractInvalid: 'CONTRACT_INVALID',

  /**
   * 报文 version 不在 `acceptVersions` 里。
   *
   * 调用方应升级/降级两端的 version 配置；丢弃的入站报文不会重试成功。
   */
  contractVersionUnsupported: 'CONTRACT_VERSION_UNSUPPORTED',

  /**
   * Codec 的 payload 不符合其输入规则，作为 `WebRpcSerializationError` / `WebRpcChunkError` 的基础码。
   *
   * 调用方检查 data 与 codec 的契约，不要对同一 payload 重试。
   */
  payloadInvalid: 'PAYLOAD_INVALID',

  /**
   * 预留：payload 超过大小上限。
   *
   * 当前实现抛 `WebRpcSerializationError`（→ `PAYLOAD_INVALID`）；保留此码用于未来把「超限」从「格式非法」中细分。
   */
  payloadTooLarge: 'PAYLOAD_TOO_LARGE',

  /**
   * 目标 method 没有对应的 provider 或 event listener。
   *
   * 调用方检查 method 拼写与远端注册；不可重试（method 存在与否是稳定的）。
   */
  methodNotFound: 'METHOD_NOT_FOUND',

  /**
   * Provider 执行器解析不到目标 method 的 provider（`Provider not found`）。
   *
   * 调用方检查 method 是否已 `provide()`；不可重试。与 `METHOD_NOT_FOUND` 语义相邻但保留独立线材码（既有行为不改）。
   */
  providerNotFound: 'PROVIDER_NOT_FOUND',

  /**
   * 非 dispatch provider 没有返回 `ctx.success()` / `ctx.failed()`。
   *
   * 调用方应让 provider 的每个非 dispatch 分支都显式返回结果，或确认本意是 dispatch。
   */
  providerNotSettled: 'PROVIDER_NOT_SETTLED',

  /**
   * Provider 抛出了未处理异常，作为 `INTERNAL` 响应的标准码。
   *
   * 原始异常只进本地 hooks（脱敏），不进对端；调用方看远端会收到 `WebRpcRemoteError`（code `INTERNAL`）。
   */
  internal: 'INTERNAL',

  /**
   * 目标或 receiver 未解析、失活或不属于当前 binding。
   *
   * 调用方检查 targetId 是否已注册/发现，或 `receiverSelector` 是否返回了未知 receiver。
   */
  targetUnknown: 'TARGET_UNKNOWN',

  /**
   * 操作要求独立 receiver，但目标是匿名 BroadcastChannel 广播组。
   *
   * 调用方应配置 `uniqueTargetId` + `identifier` 后 pin，或放弃对广播组的逐实例操作。
   */
  targetNotIdentifiable: 'TARGET_NOT_IDENTIFIABLE',

  /**
   * Endpoint 已 dispose 后继续调用其 API（`WebRpcLifecycleError`）。
   *
   * 调用方应新建 endpoint，不要复用已关闭的实例。
   */
  endpointDisposed: 'ENDPOINT_DISPOSED',

  /**
   * 调用方 AbortSignal 取消了本地 send（`WebRpcAbortError`）。
   *
   * 这是协作式取消的结果；调用方按取消处理，不要把它当作远端失败。
   */
  cancelled: 'CANCELLED',

  /**
   * 本地 deadline 到期（`WebRpcTimeoutError`）。
   *
   * 调用方检查目标是否可达、超时是否过短；是否重试由 `timeout.retry` 的本地策略决定。
   */
  deadlineExceeded: 'DEADLINE_EXCEEDED',

  /**
   * `ctx.success()` / `ctx.failed()` 在 provider 任务结束后仍被调用。
   *
   * 结果已过期，不会产生 wire 副作用；调用方应把响应逻辑收敛到 provider 的同步/await 生命周期内。
   */
  contextExpired: 'PROVIDER_CONTEXT_EXPIRED',

  /**
   * Transport 发送失败、terminal 事件或 transport 关闭（`WebRpcTransportError`）。
   *
   * 调用方检查底层通道状态；这是可重试的瞬时类失败（相对远端业务失败）。
   */
  transport: 'TRANSPORT',

  /**
   * Authentication 的逐 frame transform（encrypt/sign/verify/decrypt）失败（`WebRpcAuthenticationError`）。
   *
   * 调用方检查密钥/算法配置；失败不向远端回传细节。
   */
  authenticationFailed: 'AUTHENTICATION_FAILED',

  /**
   * Connect 验证后能安全确认来源，但身份不通过（`authentication.rejected` hooks 码，不抛）。
   *
   * 调用方在 identifier 里核实 `__unique_id__` 与自己的认证材料；恶意同源参与者属预期被拒对象。
   */
  unauthenticated: 'UNAUTHENTICATED',

  /**
   * 预留：provider 明确拒绝（应用级授权失败）。
   *
   * 当前无抛出点；保留此码用于未来把「应用拒绝」从「transport 不可用」中独立出来。
   */
  forbidden: 'FORBIDDEN',

  /**
   * 预留：transport/peer 当前不可用。
   *
   * 当前实现归一为 `TRANSPORT`；保留此码用于未来把「暂时不可用」从「transport 失败」中细分。
   */
  unavailable: 'UNAVAILABLE',

  /**
   * Method 的 params/result 不满足 contract schema（`WebRpcSchemaValidationError`）。
   *
   * 调用方按 `data.issues` 修正 data；schema 失败是稳定的，不要重试同一份 data。
   */
  schemaInvalid: 'SCHEMA_INVALID',

  /**
   * 同一个 capability 被重复发布，或冻结的 capability registry 被二次写入。
   *
   * 调用方检查 middleware 是否重复声明了保留 capability；这是配置错误。
   */
  capabilityConflict: 'CAPABILITY_CONFLICT',

  /**
   * 本地容量限制（provider admission / replay ledger / discovery waiter / outbound id / chunk 容量）拒绝新工作。
   *
   * 调用方降低并发、缩短 TTL 或扩容；是背压信号，不是逻辑错误。
   */
  overloaded: 'OVERLOADED',

  /**
   * Chunk frame 格式非法，作为 `WebRpcChunkError` 的基础码。
   *
   * 调用方检查分片配置（chunkSize ≥ 4）与对端实现；非法帧只触发 hooks，不重试。
   */
  chunkInvalid: 'CHUNK_INVALID',

  /**
   * 预留：单个 chunk 超过 `maxChunkBytes`。
   *
   * 当前实现静默拒绝并触发 `chunk.rejected`；保留此码用于未来把「单帧超限」显式化。
   */
  chunkTooLarge: 'CHUNK_TOO_LARGE',

  /**
   * 预留：并发重组 / 缓冲字节超过 chunk 容量。
   *
   * 当前实现静默拒绝并触发 `chunk.rejected`；保留此码用于未来把「容量耗尽」显式化。
   */
  chunkCapacityExceeded: 'CHUNK_CAPACITY_EXCEEDED',

  /**
   * 预留：分片重组在 `receiveTimeoutMs` 内未完成。
   *
   * 当前实现静默过期并触发 `chunk.expired`；保留此码用于未来把「重组超时」显式化。
   */
  chunkReceiveTimeout: 'CHUNK_RECEIVE_TIMEOUT',

  /**
   * 预留：chunk-ack 在超时内未收到。
   *
   * 当前实现不维护 outbound ack 状态机；保留此码用于未来引入可靠 chunk 投递时使用。
   */
  chunkAckTimeout: 'CHUNK_ACK_TIMEOUT'
} as const

export type IWebRpcErrorCode = (typeof WebRpcErrorCode)[keyof typeof WebRpcErrorCode]
