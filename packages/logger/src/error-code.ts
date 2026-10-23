/**
 * The single declaration site for `@migaia/logger` error codes.
 *
 * The pair `(source, code)` identifies package-owned failures with source `'@migaia/logger'`. Throw
 * sites use these constants instead of inline values.
 *
 * Code values are public API. Renaming a code is a breaking change.
 */
export const LoggerErrorCode = {
  /**
   * Logger construction received an unreadable or structurally invalid public option. The caller
   * must fix the option; the native `TypeError` keeps the original accessor failure in `cause` when
   * one exists. Also rejects shutdown clock failure after admitted plugin cleanup has run.
   */
  invalidOption: 'INVALID_OPTION',

  /**
   * A pipeline supplied a replacement without a current-realm Date time. Dispatch reports this
   * native TypeError and keeps delivering the original entry; the plugin must preserve its Date.
   */
  pipelineEntryInvalid: 'PIPELINE_ENTRY_INVALID',

  /**
   * Process plugin/logger installation is attempted while runtime shutdown is already in progress.
   * Enforces terminal shutdown: shutdown admission is terminal for that runtime. The caller must
   * wait for shutdown to settle or install the logger without the process plugin.
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
   * Enforces transport delivery reporting; callers must inspect the endpoint/transport and apply
   * their own delivery remediation while logger failure policy contains the sink failure.
   */
  deliveryFailed: 'DELIVERY_FAILED',

  /**
   * HTTP plugin construction receives a retry count that is not a finite non-negative integer.
   * Enforces plugin configuration admission; callers must correct the plugin configuration before
   * constructing or installing the logger.
   */
  invalidRetryCount: 'INVALID_RETRY_COUNT',

  /**
   * A bounded logger flush or shutdown phase reaches its absolute deadline with work unfinished.
   * Enforces bounded delivery; callers must treat delivery as degraded and inspect the reported
   * pending work instead of assuming every entry was delivered.
   */
  lifecycleDeadline: 'LIFECYCLE_DEADLINE',

  /**
   * Process plugin installation fails and listener rollback reports one or more additional errors.
   * Enforces aggregated shutdown reporting; callers must inspect `AggregateError.errors`, fix the
   * primary installation failure, and verify runtime listeners before retrying installation.
   */
  processInstallRollbackFailed: 'PROCESS_INSTALL_ROLLBACK_FAILED',

  /**
   * Logger plugin final uninstall cleanup attempted every registered action but one or more actions
   * failed. Enforces cleanup containment; callers must inspect the cause or `AggregateError.errors`
   * and may create a fresh plugin instance after runtime state resets. A batcher whose final drain
   * left entries undelivered reports this code with `detail.dropped`.
   */
  pluginUninstallCleanupFailed: 'PLUGIN_UNINSTALL_CLEANUP_FAILED',

  /**
   * Logger shutdown cleanup failed while cancelling a deadline task or invoking the captured exit
   * path. Enforces cleanup containment; callers must inspect the primary and cleanup errors before
   * deciding whether the process can continue.
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
   * Node default. Enforces explicit host injection; callers must inject `fs` or use the Node
   * condition.
   */
  fileSinkUnavailable: 'FILE_SINK_UNAVAILABLE',
  /** A record contains unsupported JSON data; correct the payload before retrying. */
  logPayloadInvalid: 'LOG_PAYLOAD_INVALID',
  /** Another connection retains the SQLite file lock; wait for its owner or choose another file. */
  logStoreLocked: 'LOG_STORE_LOCKED',
  /** The same injected store is already borrowed by another installed durable plugin. */
  logStoreInUse: 'LOG_STORE_IN_USE',
  /** The runtime has no supported builtin SQLite module; use Node, Deno, or Bun with SQLite. */
  logStoreUnavailable: 'LOG_STORE_UNAVAILABLE',
  /** Storage or cleanup failed; inspect cause and reopen after an uncertain commit outcome. */
  logStoreIoFailed: 'LOG_STORE_IO_FAILED',
  /** Committed metadata or undo records are inconsistent; do not guess or overwrite recovery. */
  logStoreCorrupt: 'LOG_STORE_CORRUPT',
  /** A sequence cannot be represented safely; move to a fresh log instead of wrapping. */
  logSequenceExhausted: 'LOG_SEQUENCE_EXHAUSTED',
  /** Truncation passed a subscriber cursor; restart from an explicitly retained position. */
  logSubscriptionTruncated: 'LOG_SUBSCRIPTION_TRUNCATED',
  /** A state transition targets a missing or terminal record; terminal records cannot reopen. */
  walRecordInvalid: 'WAL_RECORD_INVALID',
  /** An active undo transaction already exists; forget it explicitly or use another identity. */
  undoRecordExists: 'UNDO_RECORD_EXISTS'
} as const

/** Stable semantic failure values, interpreted with LOGGER_SOURCE and the original cause chain. */
export type ILoggerErrorCode = (typeof LoggerErrorCode)[keyof typeof LoggerErrorCode]
