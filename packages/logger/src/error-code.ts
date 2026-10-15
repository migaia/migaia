/**
 * The single declaration site for `@migaia/logger` error codes.
 *
 * See `docs/contracts/error-codes.md`. The pair `(source, code)` uniquely identifies an error.
 * `source` is always `'@migaia/logger'`. Throw sites use these constants instead of inline values.
 *
 * Code values are public API. Renaming a code is a breaking change. See
 * `docs/contracts/error-code-rollout.sdd.md` §1.2.
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
   * Thrown when the process plugin is installed again with a different configuration.
   *
   * Use the same configuration or uninstall the plugin before reinstalling.
   */
  pluginConfigConflict: 'PLUGIN_CONFIG_CONFLICT',

  /**
   * Thrown when the host runtime has no HTTP transport (`fetch`).
   *
   * Supply a runtime manager with `fetch` or use the HTTP plugin on a host that supports fetch.
   */
  transportUnavailable: 'TRANSPORT_UNAVAILABLE',

  /**
   * Thrown when serializing HTTP log entries fails.
   *
   * `cause` retains the original serialization error. Inspect the logged payload.
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
   * `AggregateError.errors` and may create a fresh plugin instance after runtime state resets. A
   * batcher whose final drain left entries undelivered reports this code with `detail.dropped`.
   */
  pluginUninstallCleanupFailed: 'PLUGIN_UNINSTALL_CLEANUP_FAILED',

  /**
   * Logger shutdown cleanup failed while cancelling a deadline task or invoking the captured exit
   * path. Enforces logger SDD LG-R24 and §5.5; callers must inspect the primary and cleanup errors
   * before deciding whether the process can continue.
   */
  pluginShutdownCleanupFailed: 'PLUGIN_SHUTDOWN_CLEANUP_FAILED',

  /**
   * Diagnostic code reported when a failure hook throws. It is not thrown itself.
   *
   * The reporter uses only `runtime.console.error` or `runtime.write`, preventing recursive failure
   * reporting.
   */
  hookFailed: 'HOOK_FAILED',

  /**
   * Thrown when `extends()` receives the current logger itself.
   *
   * Do not add a logger to its own forwarding targets.
   */
  extendsSelf: 'EXTENDS_SELF',

  /**
   * Thrown when `extends()` would create a forwarding cycle. The target logger can already forward
   * through its own targets back to the current logger.
   *
   * Inspect the forwarding graph and remove the cycle.
   */
  extendsCycle: 'EXTENDS_CYCLE',

  /**
   * A bounded batch/direct-HTTP owner had no admission slot for another full batch, so it dropped
   * the oldest queued batch (or the incoming one when every pending batch is in flight). Reported
   * through the logger failure path, not thrown to the producer; `detail.dropped` is the dropped
   * entry count. Callers should raise `maxPendingBatches` or relieve the slow batch callback.
   */
  batchOverflow: 'BATCH_OVERFLOW',
  /**
   * File plugin installation found neither an injected file-system capability nor the supported
   * Node default. Enforces R1 BZ35; callers must inject `fs` or use the Node condition.
   */
  fileSinkUnavailable: 'FILE_SINK_UNAVAILABLE'
} as const

export type ILoggerErrorCode = (typeof LoggerErrorCode)[keyof typeof LoggerErrorCode]
