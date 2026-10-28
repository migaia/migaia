/** Process ownership groups classify installation and terminal cleanup failures. */
export const ERROR_SOURCE = 'logging.process'

/** Every retained process construction/tag/cleanup point keeps its original semantic code. */
export const LogProcessErrorCode = {
  /** The same process group has begun shutdown; do not install more hosts into that group. */
  runtimeShuttingDown: 'RUNTIME_SHUTTING_DOWN',
  /** Same-process policy or scheduler domain differs from its existing group; use matching options. */
  pluginConfigConflict: 'PLUGIN_CONFIG_CONFLICT',
  /** Installation and rollback both failed; the original install error remains first in errors. */
  processInstallRollbackFailed: 'PROCESS_INSTALL_ROLLBACK_FAILED',
  /** Final uninstall attempted every restoration/removal but cleanup failed; inspect its causes. */
  pluginUninstallCleanupFailed: 'PLUGIN_UNINSTALL_CLEANUP_FAILED',
  /** Shutdown timer cancellation or the captured exit failed; inspect ordered cleanup causes. */
  pluginShutdownCleanupFailed: 'PLUGIN_SHUTDOWN_CLEANUP_FAILED'
} as const

/** Stable process failure values are interpreted with the owning source and original causes. */
export type ILogProcessErrorCode = (typeof LogProcessErrorCode)[keyof typeof LogProcessErrorCode]
