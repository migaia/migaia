/**
 * `@migaia/store-light` 错误码的唯一声明处。
 *
 * 契约见 `docs/contracts/error-codes.md`：错误由 `(source, code)` 二元组唯一定位，`source` 恒为
 * `'@migaia/store-light'`。抛出点必须引用本文件的常量，不得内联字面量。
 *
 * 码值是公开 API 的一部分，改名等同破坏性变更（`docs/contracts/error-code-rollout.sdd.md` §1.2）。
 */
export const StoreLightErrorCode = {
  /**
   * 在 store 释放（disposed）后访问其字段/快照/订阅。
   *
   * 调用方不得复用已释放的 store；重新 `createStore()`/`createAsyncStore()` 取新实例。
   */
  storeDisposed: 'STORE_DISPOSED',

  /**
   * 在资源已释放或正在关闭时读/捕获/保留资源，或资源工厂返回了已释放的值。
   *
   * 调用方按「已释放」处理并停止依赖该资源；`disposed` 是终态，不可复活。
   */
  resourceDisposed: 'RESOURCE_DISPOSED',

  /**
   * 使用了一个无效或已被 commit/discard 消费掉的资源捕获令牌。
   *
   * 调用方检查捕获令牌的生命周期：令牌只在 commit 前有效且只能提交一次。
   */
  captureInvalid: 'CAPTURE_INVALID',

  /**
   * 用未知或已不可见的资源版本号请求保留/捕获。
   *
   * 调用方应从当前快照重新取版本号，不要缓存跨重载的版本 id。
   */
  unknownVersion: 'UNKNOWN_VERSION',

  /**
   * 带 dispose 的资源工厂返回了原始值（非对象/函数），无法用引用身份追踪所有权。
   *
   * 调用方让带显式 dispose 的资源始终返回对象/函数值，以承载 `$dispose` 或引用身份。
   */
  identityRequired: 'IDENTITY_REQUIRED',

  /**
   * 对一个没有异步初始化的 store 调用了 `storeReady()`（即用 `createStore()` 建的同步 store）。
   *
   * 调用方改用 `createAsyncStore()` 定义异步字段，或不要对其调用 `storeReady()`。
   */
  noAsyncInit: 'NO_ASYNC_INIT',

  /**
   * 在 store 的异步字段尚未就绪（pending）或初始化已失败（failed）时访问异步状态。
   *
   * 调用方先 `await storeReady()` 再访问异步字段；失败时按初始化失败处理，不要重试读取。
   */
  storeNotReady: 'STORE_NOT_READY',

  /**
   * Store 初始化失败后清理也已失败，两者作为 `AggregateError` 一并抛出。
   *
   * 原始初始化错误与清理错误都沿 `cause`/`errors` 可达（E-T13）；调用方按初始化失败处理并据此诊断清理。
   */
  initAndCleanupFailed: 'INIT_AND_CLEANUP_FAILED',

  /**
   * 向 `createStore()`（同步契约）传入了 IFieldBuilder 异步字段。
   *
   * 调用方改用 `createAsyncStore()` 承载异步/字段构建器定义。
   */
  syncFieldRequired: 'SYNC_FIELD_REQUIRED',

  /**
   * 诊断码，不抛出。异步 action 在第一个 `await` 之后的写操作不参与批量。
   *
   * 仅经 `console.warn` 上报，用于提醒调用方把后续写显式包进 `$batch()`。
   */
  actionBatchBoundary: 'ACTION_BATCH_BOUNDARY',

  /**
   * 宿主缺少 `ResourceCaptureRegistry` 所需的 `WeakRef`/`FinalizationRegistry` 能力。
   *
   * 调用方在宿主沙箱启用这些能力；这是部署问题，不是逻辑错误。
   */
  envUnsupported: 'ENV_UNSUPPORTED',

  /**
   * 入参/字段校验失败：`keepAliveMs` 非法、`$set` 目标字段不可写、`$hydrate` 出现未知字段。
   *
   * 调用方修正参数；具体是哪个字段/值见消息文案。
   */
  invalidOption: 'INVALID_OPTION'
} as const

export type IStoreLightErrorCode = (typeof StoreLightErrorCode)[keyof typeof StoreLightErrorCode]
