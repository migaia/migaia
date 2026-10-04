/** Stable error source for core and browser adapters that throw core error classes. */
export const ERROR_SOURCE = '@migaia/rpc/core'

/**
 * `@migaia/rpc/core` 错误码的唯一声明处。
 *
 * 契约见 `docs/contracts/error-codes.md`：错误由 `(source, code)` 二元组唯一定位，`source` 恒为
 * `'@migaia/rpc/core'`。抛出点必须引用本文件的常量，不得内联字面量。
 *
 * 码值是公开 API 的一部分，改名等同破坏性变更（`docs/contracts/error-code-rollout.sdd.md` §1.2）。
 * 本表只保留有实际抛出点的码；迁移时删除的历史预留码记录在 `rpc-layering.sdd.md` R2。
 */
export const RpcCoreErrorCode = {
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
   * A Runtime API operation requires a mode or capability absent from the actual peer agreement.
   * Enforces D5/D42; choose a supported method/mode rather than retrying the same operation.
   */
  capabilityUnsupported: 'CAPABILITY_UNSUPPORTED',

  /**
   * Factory / middleware / transport 描述符非法或配置字段取值不合法。 Replay r12 also rejects encrypt-only
   * configuration, unavailable entropy and exhausted counters.
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
   * Protocol codec / scheme / envelope 非法，或 caller 无法还原响应错误、provider 收到非法 abort 载荷；作为
   * `RpcProtocolError` 的基础码。
   *
   * 调用方检查 protocol 配置与对端 scheme 是否一致；载荷已发送或取消已生效时检查对端，不要对同一报文重试。
   */
  protocolInvalid: 'PROTOCOL_INVALID',

  /**
   * Contract 字段、方向或 request/response 关联不合法，作为 `RpcContractError` 的基础码。
   *
   * 调用方检查 version、identifier、sender/target 方向或 taskId/method 关联。
   */
  contractInvalid: 'CONTRACT_INVALID',

  /**
   * Codec 的 payload 不符合其输入规则，或发送端错误序列化的读取、data 投影降级；作为 `RpcSerializationError` / `RpcChunkError`
   * 的基础码。 Physical batch shape/encoding failures preserve the contract cause; malformed semantic
   * members are reported individually without discarding valid siblings.
   *
   * 调用方检查 data、codec 或抛出值；载荷已照常发送或取消已生效时不应重试同一 payload。
   */
  payloadInvalid: 'PAYLOAD_INVALID',

  /**
   * Provider 执行器解析不到目标 method 的 provider（`Provider not found`）。
   *
   * 调用方检查 method 是否已 `provide()`；不可重试。这是入站 provider 查找失败的线材码。
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
   * 原始异常只进本地 hooks（脱敏），不进对端；调用方看远端会收到 `RpcRemoteError`（code `INTERNAL`）。
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
   * Endpoint 已 dispose 后继续调用其 API（`RpcLifecycleError`）。
   *
   * 调用方应新建 endpoint，不要复用已关闭的实例。
   */
  endpointDisposed: 'ENDPOINT_DISPOSED',

  /**
   * 调用方 AbortSignal 取消了本地 send（`RpcAbortError`）。
   *
   * 这是协作式取消的结果；调用方按取消处理，不要把它当作远端失败。
   */
  cancelled: 'CANCELLED',

  /**
   * 本地 deadline 到期（`RpcTimeoutError`）。
   *
   * 调用方检查目标是否可达或超时是否过短；请求失败按单次传输结果处理。
   */
  deadlineExceeded: 'DEADLINE_EXCEEDED',

  /**
   * `ctx.success()` / `ctx.failed()` 在 provider 任务结束后仍被调用。
   *
   * 结果已过期，不会产生 wire 副作用；调用方应把响应逻辑收敛到 provider 的同步/await 生命周期内。
   */
  contextExpired: 'PROVIDER_CONTEXT_EXPIRED',

  /**
   * Transport 发送失败、terminal 事件或 transport 关闭（`RpcTransportError`）。
   *
   * 调用方检查底层通道状态；这是可重试的瞬时类失败（相对远端业务失败）。
   */
  transport: 'TRANSPORT',

  /**
   * Authentication 的逐 frame transform（encrypt/sign/verify/decrypt）失败（`RpcAuthenticationError`）。
   * Replay r12 rejects missing/invalid binding, duplicate counters and untrusted physical
   * sessions.
   *
   * 调用方检查密钥/算法配置；失败不向远端回传细节。
   */
  authenticationFailed: 'AUTHENTICATION_FAILED',

  /**
   * Method 的 params/result 不满足 contract schema（`RpcSchemaValidationError`）。
   *
   * 调用方按 `data.issues` 修正 data；schema 失败是稳定的，不要重试同一份 data。
   */
  schemaInvalid: 'SCHEMA_INVALID',

  /**
   * 同一个 capability 被重复发布，或冻结的 capability registry 被二次写入。 I28 D8/D11 also rejects folded Feature
   * method collisions and ambiguous runtime instances.
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
   * A stream frame may have been sent before its transport rejected; the caller must open a fresh
   * stream and never replay delivered values (streaming R7).
   */
  streamResultUnknown: 'STREAM_RESULT_UNKNOWN',

  /**
   * Chunk frame 格式非法，作为 `RpcChunkError` 的基础码。
   *
   * 调用方检查分片配置（chunkSize ≥ 4）与对端实现；非法帧只触发 hooks，不重试。
   */
  chunkInvalid: 'CHUNK_INVALID',

  /** 无同步报告器的 safeRead 遇到 getter/Proxy 抛错，或报告器自身抛错（R11）。 调用方应修复输入对象，或在拥有诊断 sink 的边界传入同步 report。 */
  propertyReadFailed: 'PROPERTY_READ_FAILED',

  /**
   * A keyed call already executed but its result was not retained for replay. The caller must
   * resolve the outcome before issuing another non-idempotent attempt.
   */
  idempotencyResultUnavailable: 'IDEMPOTENCY_RESULT_UNAVAILABLE',

  /**
   * A string conversion throws without a synchronous reporter, or its reporter throws (cleanup
   * R12). The caller must repair the input or provide a synchronous diagnostic sink.
   */
  stringConversionFailed: 'STRING_CONVERSION_FAILED'
} as const

export type IRpcCoreErrorCode = (typeof RpcCoreErrorCode)[keyof typeof RpcCoreErrorCode]
