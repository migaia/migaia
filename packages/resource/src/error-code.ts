/**
 * `@migaia/resource` 错误码的唯一声明处。
 *
 * 契约见 `docs/contracts/error-codes.md`：错误由 `(source, code)` 二元组唯一定位，`source` 恒为
 * `'@migaia/resource'`。抛出点必须引用本文件的常量，不得内联字面量。
 *
 * 迁移背景（`docs/lifecycle/migration.sdd.md` §3.7.2）：本表把包内原本裸 `throw new Error('…')`
 * 的字符串归纳成码。`REQUEST_ABORTED` / `REQUEST_CANCELLED` 必须保持抛出值是 `DOMException` 且 `name ===
 * 'AbortError'`——调用方（含 `store-react` 的 suspension 路径）按 `AbortError` 判定；码只作为 附加字段挂上，不替换类型。
 *
 * 码值是公开 API 的一部分，改名等同破坏性变更。
 */
export const ResourceErrorCode = {
  /**
   * 在已 `dispose()` 的 Resource 上调用任意读取/操作方法时抛出。
   *
   * 释放后所有对外方法一律拒绝，避免读到已停止追踪的陈旧状态。调用方应停止持有该实例的引用， 改用重新创建的 Resource。
   */
  resourceDisposed: 'RESOURCE_DISPOSED',

  /**
   * 请求被主动中止时，`fetcher` 收到的 `signal` 触发、或内部转发给调用方的 `DOMException`。
   *
   * 保持 `DOMException('...', 'AbortError')` 类型不变，`code` 只作为附加字段。调用方通常按 `error.name === 'AbortError'`
   * 判定并静默处理，而不是当作真实失败。
   */
  requestAborted: 'REQUEST_ABORTED',

  /**
   * 调用方显式 `cancel()` 导致当前 pending 请求被取消时，state 落入 `cancelled` 所携带的 `DOMException`。
   *
   * 同样保持 `DOMException('...', 'AbortError')` 类型不变。与 `REQUEST_ABORTED` 的区别只在于触发源 ——一个是 fetcher
   * 内部信号中止，一个是调用方显式取消。
   */
  requestCancelled: 'REQUEST_CANCELLED',

  /**
   * 请求取消已经完成状态收敛，但取消期间的 timer/listener cleanup 失败。 `REQUEST_CANCELLED` 专用于携带 `AbortError` 的
   * cancelled state；本码落实 migration.sdd.md §3.7.2 的 cleanup 与状态错误分离，调用方应记录 cleanup 失败并继续把 Resource
   * 视为已取消。
   */
  cancellationCleanupFailed: 'CANCELLATION_CLEANUP_FAILED',

  /**
   * 读取 `promise` 或在 `pending`/`idle` 状态下 `#materialize()` 时，内部没有一个正在进行或已缓存的 Promise 可返回。
   *
   * 这通常意味着状态机进入了不一致的中间态；调用方应检查是否绕过了正常的 `refetch()`/`invalidate()` 路径直接摆弄内部状态。
   */
  noActivePromise: 'NO_ACTIVE_PROMISE',

  /**
   * `hydrate()` 收到的快照 `version` 不是 `1`，或 `updatedAt`/`expiresAt` 不是有限数字时抛出。
   *
   * 快照通常来自 SSR 序列化或持久化存储，格式漂移应该在装载时就失败，而不是让 Resource 带着损坏的 `expiresAt` 继续运行。调用方应检查快照的产出/序列化路径。
   */
  invalidSnapshot: 'INVALID_SNAPSHOT',

  /**
   * 构造/调用时传入的选项（`ttl`、`retry` 次数、`retryDelay`）不满足取值要求时抛出。
   *
   * 这是入口参数校验，早失败优于把非法配置带进状态机。调用方应修正传入的选项值。
   */
  invalidOption: 'INVALID_OPTION',

  /**
   * `fetcher` 抛出用于 Suspense 的值，但探测其 `.then` 时 getter 抛错，无法判定是否为 thenable。
   *
   * 原始抛出值与 getter 异常都通过 `AggregateError.errors` 保持 `===` 可达（`error-codes.md` §2/§3.2）；调用方应检查
   * fetcher 抛出的 Suspense 值为何带 hostile getter，不要把它当成普通 fetch 失败静默重试。
   */
  suspenseProbeFailed: 'SUSPENSE_PROBE_FAILED'
} as const

export type IResourceErrorCode = (typeof ResourceErrorCode)[keyof typeof ResourceErrorCode]
