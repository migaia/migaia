/** Logging host failures retain the canonical logging semantic domain. */
export const ERROR_SOURCE = 'logging'
/** Public semantic codes used by host-owned configuration, delivery and cleanup paths. */
export const LogHostErrorCode = {
  /** Invalid construction/configuration input requires a corrected caller option. */
  invalidOption: 'INVALID_OPTION',
  /** A pipeline replacement lost its Date; delivery keeps the prior valid entry and reports it. */
  pipelineEntryInvalid: 'PIPELINE_ENTRY_INVALID',
  /** Configuration admission has closed during terminal shutdown. */
  runtimeShuttingDown: 'RUNTIME_SHUTTING_DOWN',
  /** An existing plugin configuration conflicts with a new installation. */
  pluginConfigConflict: 'PLUGIN_CONFIG_CONFLICT',
  /** A bounded flush/shutdown phase ran out of its shared lifecycle wait budget. */
  lifecycleDeadline: 'LIFECYCLE_DEADLINE',
  /** Plugin release attempted all owned cleanup but at least one cleanup failed. */
  pluginUninstallCleanupFailed: 'PLUGIN_UNINSTALL_CLEANUP_FAILED',
  /** Terminal cleanup failed; callers inspect the structured disposal result and original cause. */
  pluginShutdownCleanupFailed: 'PLUGIN_SHUTDOWN_CLEANUP_FAILED',
  /** A failure listener failed while observing another failure; the terminal reporter receives it. */
  hookFailed: 'HOOK_FAILED',
  /** Batch capacity dropped the oldest queued batch, or incoming data if all batches were active. */
  batchOverflow: 'BATCH_OVERFLOW',
  /** A bounded output attempt failed; cause retains the original timeout or delivery failure. */
  deliveryFailed: 'DELIVERY_FAILED',
  /** Retry attempts must be a positive safe integer before any output is installed. */
  invalidRetryCount: 'INVALID_RETRY_COUNT',
  /** Entry admission dropped the oldest unprocessed entry to maintain the pending bound. */
  queueOverflow: 'QUEUE_OVERFLOW',
  /** A host cannot register itself as a forwarding target. */
  forwardSelf: 'FORWARD_SELF',
  /** A new forwarding edge would reach its own source through existing target edges. */
  forwardCycle: 'FORWARD_CYCLE'
} as const
/** Stable semantic values are interpreted together with the logging source and cause chain. */
export type ILogHostErrorCode = (typeof LogHostErrorCode)[keyof typeof LogHostErrorCode]
