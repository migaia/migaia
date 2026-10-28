/** Stable diagnostics preserve the moved process messages and error traceability. */
export const LogProcessErrorText = {
  /** New group members are refused during the current group shutdown. */
  runtimeShuttingDown: '[logger] process runtime is shutting down',
  /** Existing same-process configuration and scheduler policy must agree. */
  configConflict: '[logger] process plugin already installed with different configuration',
  /** Fatal entry emitted before an uncaught-exception shutdown. */
  uncaughtException: '未捕获异常，进程即将退出',
  /** Fatal entry emitted before an unhandled-rejection shutdown. */
  unhandledRejection: '未处理的 Promise rejection，进程即将退出',
  /** Rollback retains installation primary before every cleanup error. */
  installRollbackFailed: 'process plugin install rollback failed',
  /** Final uninstall keeps the established aggregate wrapper message. */
  uninstallCleanupFailed: 'logger plugin uninstall cleanup failed',
  /** Timer/exit cleanup keeps the established aggregate wrapper message. */
  shutdownCleanupFailed: 'logger shutdown cleanup failed',
  /** A frozen/sealed error receives a native-type wrapper retaining the original through cause. */
  taggingFailed: 'logger error tagging failed',
  /** A rejected primitive is rendered exactly as the original event payload. */
  rejectionReason: (reason: unknown): string => String(reason)
} as const
