/**
 * `@migaia/logger` 错误码的唯一声明处。
 *
 * 契约见 `docs/contracts/error-codes.md`：错误由 `(source, code)` 二元组唯一定位，`source` 恒为
 * `'@migaia/logger'`。抛出点必须引用本文件的常量，不得内联字面量。
 *
 * 码值是公开 API 的一部分，改名等同破坏性变更（`docs/contracts/error-code-rollout.sdd.md` §1.2）。
 */
export const LoggerErrorCode = {
  /**
   * Logger construction received an unreadable or structurally invalid public option. The caller
   * must fix the option; the native `TypeError` keeps the original accessor failure in `cause` when
   * one exists.
   */
  invalidOption: 'INVALID_OPTION',

  /**
   * Process plugin/logger installation is attempted while runtime shutdown is already in progress.
   * Enforces logger SDD §4.3 and §5.1: shutdown admission is terminal for that runtime. The caller
   * must wait for shutdown to settle or install the logger without the process plugin.
   */
  runtimeShuttingDown: 'RUNTIME_SHUTTING_DOWN',

  /**
   * Process 插件被以不同的配置重复安装。
   *
   * 调用方统一配置，或先卸载再重装。
   */
  pluginConfigConflict: 'PLUGIN_CONFIG_CONFLICT',

  /**
   * 宿主运行时没有可用的 HTTP transport（`fetch`）。
   *
   * 调用方提供 `runtimeFetch` 或在支持 fetch 的运行时使用 http 插件。
   */
  transportUnavailable: 'TRANSPORT_UNAVAILABLE',

  /**
   * Http 日志序列化失败。
   *
   * 原始序列化错误挂在 `cause`；调用方检查被记录的载荷。
   */
  serializeFailed: 'SERIALIZE_FAILED',

  /**
   * HTTP delivery receives a non-success response or exhausts retryable transport attempts.
   * Enforces logger SDD §4.5 and §5.3 (LG-R6-4/LG-R18); callers must inspect the endpoint/transport
   * and apply their own delivery remediation while logger failure policy contains the sink
   * failure.
   */
  deliveryFailed: 'DELIVERY_FAILED',

  /**
   * HTTP plugin construction receives a retry count that is not a finite non-negative integer.
   * Enforces logger SDD §4.5 (LG-R6-8); callers must correct the plugin configuration before
   * constructing or installing the logger.
   */
  invalidRetryCount: 'INVALID_RETRY_COUNT',

  /**
   * A bounded logger flush or shutdown phase reaches its absolute deadline with work unfinished.
   * Enforces logger SDD §4.2 and §5.2 (LG-R6-5); callers must treat delivery as degraded and
   * inspect the reported pending work instead of assuming every entry was delivered.
   */
  lifecycleDeadline: 'LIFECYCLE_DEADLINE',

  /**
   * Process plugin installation fails and listener rollback reports one or more additional errors.
   * Enforces logger SDD §4.3 and §5.3 (LG-R11); callers must inspect `AggregateError.errors`, fix
   * the primary installation failure, and verify runtime listeners before retrying installation.
   */
  processInstallRollbackFailed: 'PROCESS_INSTALL_ROLLBACK_FAILED',

  /**
   * Logger plugin final uninstall cleanup attempted every registered action but one or more actions
   * failed. Enforces logger SDD LG-R23/LG-R24 and §5.5; callers must inspect the cause or
   * `AggregateError.errors` and may create a fresh plugin instance after runtime state resets.
   */
  pluginUninstallCleanupFailed: 'PLUGIN_UNINSTALL_CLEANUP_FAILED',

  /**
   * Logger shutdown cleanup failed while cancelling a deadline task or invoking the captured exit
   * path. Enforces logger SDD LG-R24 and §5.5; callers must inspect the primary and cleanup errors
   * before deciding whether the process can continue.
   */
  pluginShutdownCleanupFailed: 'PLUGIN_SHUTDOWN_CLEANUP_FAILED',

  /**
   * 诊断码，不抛出。failure hook 自身抛错时由 reporter 边界上报。
   *
   * 仅经 `runtime.console.error`/`runtime.write` 上报，保证失败上报通道自身不会递归失败。
   */
  hookFailed: 'HOOK_FAILED',

  /**
   * `extends()` 传入自身（自引用）。
   *
   * 调用方不要把自己加入自己的 extends 目标列表。
   */
  extendsSelf: 'EXTENDS_SELF',

  /**
   * `extends()` 会形成循环转发链（目标 logger 已能沿其 extends 链转发回当前 logger）。
   *
   * 调用方检查 extends 拓扑，拆除环路。
   */
  extendsCycle: 'EXTENDS_CYCLE'
} as const

export type ILoggerErrorCode = (typeof LoggerErrorCode)[keyof typeof LoggerErrorCode]
