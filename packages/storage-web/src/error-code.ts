/**
 * `@migaia/storage-web` 错误码的唯一声明处。
 *
 * 契约见 `docs/contracts/error-codes.md`：错误由 `(source, code)` 二元组唯一定位，`source` 恒为
 * `'@migaia/storage-web'`。抛出点必须引用本文件的常量，不得内联字面量。
 *
 * 码值是公开 API 的一部分，改名等同破坏性变更。5 个契约级码（`UNSUPPORTED_CAPABILITY`/`ABORTED`/
 * `STORE_DISPOSED`/`INVALID_ARGUMENT`/`INVALID_KEY`）已迁往 `@migaia/storage-contract`；本表新增
 * `INVALID_CONFIG` 承载 web adapter 专有配置校验，见 `docs/store-persist/storage-web-integration.sdd.md`
 * §4.2。
 */
export const StorageErrorCode = Object.freeze({
  /**
   * 存储后端不可用：隐私模式探测失败、localStorage/IndexedDB/document 被禁用或缺失。
   *
   * 调用方不应重试同一后端；可显式降级到 `memoryStorage`，或提示用户开启存储权限。落实 §10.1 的可用性探测契约。
   */
  unavailable: 'BACKEND_UNAVAILABLE',

  /**
   * 写入命中浏览器配额上限（`QuotaExceededError` / Firefox `NS_ERROR_DOM_QUOTA_REACHED` 等）。
   *
   * 调用方应清理不再需要的数据或改用 IndexedDB；这是持久性失败，不是瞬时失败。
   */
  quotaExceeded: 'QUOTA_EXCEEDED',

  /**
   * 序列化后的 cookie 值超过单值 4KB 上限。
   *
   * 调用方应缩短 value/name/属性，或改存 IndexedDB；库不做静默截断。
   */
  valueTooLarge: 'VALUE_TOO_LARGE',

  /**
   * 序列化失败（`JSON.stringify` 抛错、codec encode 非预期输出、memory `structuredClone` 写失败）。
   *
   * 调用方检查待存值是否可序列化；这是数据形状问题，不是后端问题。
   */
  serializeFailed: 'SERIALIZE_FAILED',

  /**
   * 反序列化失败（`JSON.parse` 抛错、envelope 结构非法、codec decode 非预期输出）。
   *
   * 调用方检查落盘数据是否被外部改写或由更高版本写入；`onInvalid` 按 stage `decode` 处置。
   */
  deserializeFailed: 'DESERIALIZE_FAILED',

  /**
   * Schema 校验失败（`ISchemaAdapter.validate` 抛错或返回 issues）。
   *
   * 调用方按 schema 修正数据；`onInvalid` 按 stage `validate` 处置。
   */
  validationFailed: 'VALIDATION_FAILED',

  /**
   * 迁移函数执行失败。
   *
   * 单条记录迁移失败不影响其他记录；调用方按 stage `migrate` 隔离或修复迁移逻辑。
   */
  migrationFailed: 'MIGRATION_FAILED',

  /**
   * IndexedDB 事务创建/提交失败，或 transaction callback 抛出了非 `StorageError`。
   *
   * 调用方检查事务是否跨过了自动提交边界、scope 是否逃逸；瞬时并发失败可重试。
   */
  transactionFailed: 'TRANSACTION_FAILED',

  /**
   * Value/bytes/record 三通道逻辑 key 冲突，且未指定 `conflictPolicy: 'replace'`。
   *
   * 调用方要么换 key，要么显式声明 replace 以原子删除其他通道同名值。
   */
  duplicateKey: 'DUPLICATE_KEY',

  /**
   * Entity envelope `__v` 或 IndexedDB schema 版本高于当前代码所知的版本。
   *
   * 调用方应升级代码或降级数据；旧代码不得误读/覆盖新版本数据。
   */
  versionUnsupported: 'VERSION_UNSUPPORTED',

  /**
   * 扩展点（schema/codec/namespaceCodec/comparator/diagnostic）抛出了未归类的异常。
   *
   * 调用方检查扩展实现；`extensionStage` 区分是哪个扩展点失败，原始异常在 `cause`。
   */
  extensionFailed: 'EXTENSION_FAILED',

  /**
   * Transaction 提交时 read revision 或 global epoch 已变（并发写冲突）。
   *
   * 调用方重读后重试整个 transaction；这是可重试的并发冲突，不是数据损坏。
   */
  transactionConflict: 'TRANSACTION_CONFLICT',

  /**
   * Cookie 写入后读回不可见（浏览器静默拒绝）。
   *
   * 调用方检查 cookie 属性（path/domain/SameSite/secure）与容量；隐私策略仍可能异步清除。
   */
  writeFailed: 'WRITE_FAILED',

  /**
   * Cookie 同名多 scope 可见，无法确定目标值的归属。
   *
   * 调用方让每个 scope 的 cookie 名唯一，或在构造期固定 scope 后不再产生歧义。
   */
  cookieScopeAmbiguous: 'COOKIE_SCOPE_AMBIGUOUS',

  /**
   * Web adapter 专有输入/配置校验失败（cookie SameSite/Secure/Partitioned/scope、IndexedDB factory/store
   * 名/IDBKeyRange、 migration/schema/entity/namespace codec 配置、backend option、`selectCodec` 的
   * onDiagnostic 等）。
   *
   * 落实 `docs/store-persist/storage-web-integration.sdd.md` §4.2/D-13：契约级结构校验用 storage-contract 的
   * `INVALID_ARGUMENT`，本码只承载 adapter 专有配置校验（`error-code-rollout.sdd.md` §3「参数校验统一」的局部例外）。
   *
   * 调用方修正对应配置后重试；这是永久性传参/配置错误。
   */
  invalidConfig: 'INVALID_CONFIG',

  /**
   * IndexedDB sidecar contains an index row whose authoritative record is absent. Enforces the V2
   * orphan-reporting rule; callers should repair or rebuild the index rather than treating the
   * skipped row as a successful query result.
   */
  indexOrphan: 'INDEX_ORPHAN',

  /**
   * An indexed mutation would assign one logical unique key to two authoritative records. Enforces
   * storage-v2 SWV2-E04 inside the record/sidecar transaction; callers must choose a different
   * indexed value or remove the competing record before retrying.
   */
  indexUniqueConflict: 'INDEX_UNIQUE_CONFLICT',

  /**
   * A native `iterateRecordIndex` page observed the global or scope mutation epoch change between
   * pages. Enforces storage-v2 SWV2-E19/D26: each page validates a short readonly transaction, then
   * closes it before yielding; callers must restart the query rather than trust a mixed snapshot.
   */
  indexQueryInvalidated: 'INDEX_QUERY_INVALIDATED',

  /**
   * A live-query consumer attempted to refresh after its terminal disposal. Enforces storage-v2
   * SWV2-E12: disposal cannot revive subscriptions or owned reactive state; callers must create a
   * new live query instead of reusing the disposed handle.
   */
  liveQueryDisposed: 'LIVE_QUERY_DISPOSED',

  /**
   * A backfill operation presented an expired owner, stale generation, or conflicting checkpoint.
   * Enforces storage-v2 SWV2-E15/E18: the batch must be rejected and rolled back; callers should
   * retry through a fresh repository operation after the current handle is reacquired.
   */
  indexBackfillStale: 'INDEX_BACKFILL_STALE'
} as const)

export type IStorageErrorCode = (typeof StorageErrorCode)[keyof typeof StorageErrorCode]
