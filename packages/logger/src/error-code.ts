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
   * Process 插件检测到运行时正在关停，拒绝新的 process 日志。
   *
   * 调用方按关停处理；这是进程级终态，不可恢复。
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
} as const;

export type ILoggerErrorCode = (typeof LoggerErrorCode)[keyof typeof LoggerErrorCode];
