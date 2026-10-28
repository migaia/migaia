/** Host-owned stable diagnostics preserve the former logging text wherever behavior is unchanged. */
export const LogHostErrorText = {
  /** Failure observers keep the established diagnostic text while the terminal reporter contains it. */
  failureHookThrew: '[logger] failure hook threw:',
  /** Nonextensible native errors keep their original identity on a native-prototype wrapper cause. */
  errorTaggingFailed: 'logger error tagging failed',
  /** A final output release attempts all actions before collecting their ordered failures. */
  pluginUninstallCleanupFailed: 'logger plugin uninstall cleanup failed',
  /** A clock failure cannot prevent terminal plugin cleanup or lose its original cause. */
  shutdownClockFailed: 'logger shutdown clock failed',
  /** Invalid public options are rejected before any resource-owning installation. */
  invalidOption: 'logger option admission failed',
  /** Scheduler accessors fail at configuration admission while the original remains on cause. */
  schedulerGetterFailed: 'scheduler getter failed',
  /** A selected scheduler must support the canonical clock/task boundary. */
  invalidScheduler: 'scheduler must provide now() and schedule() functions',
  /** Replacement entry Date identity is required by shallow sink snapshots. */
  pipelineEntryInvalid: 'pipeline replacement time must be a current-realm Date',
  /** Work remains after the shared bounded flush deadline. */
  flushDeadline: 'flush deadline reached with pending work remaining',
  /** An unfinished shutdown handler did not settle inside the shared deadline. */
  shutdownHandlerDeadline: 'shutdown handler deadline reached',
  /** Forwarded target draining retains its established diagnostic text. */
  forwardDeadline: 'extends flush deadline reached',
  /** Reported with a dropped count when a batch admission slot is unavailable. */
  batchOverflow: 'logger batch pending capacity is exhausted',
  /** Final batch cleanup counts buffered data not handed to the output. */
  batchDisposeDropped: 'logger batch dispose dropped undelivered entries',
  /** Reported when host entry admission discards the oldest unprocessed entry. */
  queueOverflow: 'log host pending capacity is exhausted',
  /** The original attempt failure remains reachable under this output boundary diagnostic. */
  deliveryFailed: 'log output delivery failed',
  /** Retry feature attempts are total attempts, including the initial delivery. */
  invalidRetryCount: 'retry attempts must be a positive safe integer',
  /** Self-forwarding preserves the old diagnostic message while the public code changes. */
  forwardSelf: (id: string): string => `[logger] extends() 不能传入自己 (id=${id})`,
  /** Cycle rejection preserves the old message and names its source identity. */
  forwardCycle: (id: string): string =>
    `[logger] extends() 会形成循环引用：目标 logger 已经能沿着它自己的 extends 链路 转发回当前 logger (id=${id})，已阻止这次调用`
} as const
