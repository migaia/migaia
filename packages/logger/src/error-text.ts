/** Stable logger failure text consumed by failure reporting and tests. */
export const LoggerErrorText = {
  /** Public logger option admission failed before any plugin side effect was allowed. */
  invalidOption: 'logger option admission failed',
  /** Deadline reached while draining logger work. */
  flushDeadline: 'flush deadline reached',
  /** Deadline reached while flushing an extends target. */
  forwardDeadline: 'extends flush deadline reached',
  /** Deadline reached while waiting for a shutdown handler. */
  shutdownHandlerDeadline: 'shutdown handler deadline reached',
  /** Pending work remained after the logger flush deadline. */
  pendingAfterFlushDeadline: 'flush deadline reached with pending work remaining',
  /** Failure hook itself threw while reporting another failure. */
  failureHookThrew: '[logger] failure hook threw:',
  /** Metadata tagging failed because a thrown Error was non-extensible; its wrapper retains `cause`. */
  errorTaggingFailed: 'logger error tagging failed',
  /** Reading the public scheduler option or its capability accessors failed during admission. */
  schedulerGetterFailed: 'scheduler getter failed',
  /** Scheduler admission found no callable now() and schedule() capabilities. */
  invalidScheduler: 'scheduler must provide now() and schedule() functions',
  /** HTTP response could not be delivered successfully. */
  httpDeliveryFailed: (status: number): string => `日志推送失败: HTTP ${status}`,
  /** Runtime fetch rejected after the HTTP plugin exhausted its configured attempts. */
  httpTransportFailed: 'HTTP transport failed',
  /** HTTP request serialization failed before transport could be attempted. */
  httpSerializeFailed: '[logger] http 日志序列化失败',
  /** Runtime does not expose a fetch transport required by the HTTP plugin. */
  httpTransportUnavailable: '[logger] HTTP transport is unavailable in this runtime',
  /** HTTP request timeout must remain a finite non-negative scheduler delay. */
  invalidRequestTimeout: 'HTTP request timeout must be a finite non-negative number',
  /** HTTP retry configuration violates the bounded retry contract. */
  invalidRetryCount: 'HTTP retries must be a finite non-negative integer',
  /** Process runtime rejects new logger installation during shutdown. */
  processRuntimeShuttingDown: '[logger] process runtime is shutting down',
  /** Process plugin already owns the runtime with another configuration. */
  processConfigConflict: '[logger] process plugin already installed with different configuration',
  /** Fatal diagnostic emitted for an uncaught exception. */
  processUncaughtException: '未捕获异常，进程即将退出',
  /** Fatal diagnostic emitted for an unhandled promise rejection. */
  processUnhandledRejection: '未处理的 Promise rejection，进程即将退出',
  /** Process plugin rollback failed after the primary installation error. */
  processInstallRollbackFailed: 'process plugin install rollback failed',
  /** Final plugin uninstall ran all cleanup actions but at least one cleanup failed. */
  pluginUninstallCleanupFailed: 'logger plugin uninstall cleanup failed',
  /** Shutdown cleanup failed while cancelling a task or invoking the captured exit path. */
  pluginShutdownCleanupFailed: 'logger shutdown cleanup failed',
  /** `extends()` was asked to add the current logger as its own target. */
  extendsSelf: (id: string): string => `[logger] extends() 不能传入自己 (id=${id})`,
  /** `extends()` would create a cycle back to the current logger. */
  extendsCycle: (id: string): string =>
    `[logger] extends() 会形成循环引用：目标 logger 已经能沿着它自己的 extends 链路 转发回当前 logger (id=${id})，已阻止这次调用`
} as const;
