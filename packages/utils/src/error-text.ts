/** Stable public text for errors crossing the utils package boundary. */
export const UtilsErrorText = {
  invalidArgument: (field: string, expectation: string) =>
    `[utils] invalid ${field}: ${expectation}`,
  nonErrorValue: '[utils] non-Error value was converted',
  envUnsupported: (capability: string) => `[utils] host capability is unavailable: ${capability}`,
  /**
   * Stable capability labels passed to `envUnsupported(capability)` by the default scheduler in
   * `scheduler.ts`; they name which host capability (monotonic clock, finite clock reading, timers,
   * deferred queue) was missing so the message stays identical across hosts.
   */
  schedulerCapability: {
    monotonicClock: 'performance.now',
    finiteClock: 'finite performance.now value',
    timers: 'setTimeout/clearTimeout',
    /** Default deferred work requires this host queue while custom schedulers may supply their own. */
    microtasks: 'queueMicrotask'
  },
  /** The deferred-work entry rejects a non-function before any scheduler registration. */
  deferredCallback: '[utils] deferred callback must be a function',
  /** One scheduler receiver must provide its optional deferred method or the ordinary timer method. */
  deferredScheduler: '[utils] scheduler must provide a callable defer or schedule method',
  /** Failed method capture retains the caller's original getter error through cause. */
  deferredAccessor: '[utils] failed to read scheduler deferred methods',
  aborted: '[utils] operation aborted',
  deadlineExceeded: (scope: string, timeoutMs: number) =>
    `[utils] ${scope} deadline exceeded after ${timeoutMs}ms`,
  schedulerRunaway: '[utils] manual scheduler exceeded the 10000-task advance guard',
  errorIdentityConflict: (field: string) =>
    `[utils] error identity conflicts with existing ${field}`,
  /** Stable text for rejected cross-realm error trees, retaining the failing pointer and rule. */
  errorChainInvalid: (pointer: string, violation: string) =>
    `[utils] invalid error chain at ${pointer}: ${violation}`,
  cleanupFailed: '[utils] asynchronous operation cleanup failed',
  cloneUnsupported: '[utils] immutable snapshot is unsupported for this value',
  invalidEncoding: (encoding: string, offset: number) =>
    `[utils] invalid ${encoding} input at offset ${offset}`,
  limiterClosed: '[utils] concurrency limiter is closed',
  reentrantCall: '[utils] reentrant call is not allowed',
  configUnsupported: (path: string, reason: string) =>
    `[utils] unsupported config value at ${path}: ${reason}`,
  configReadonly: (path: string) => `[utils] readonly config mutation is not allowed at ${path}`,
  configConflict: (path: string, reason: string) => `[utils] config conflict at ${path}: ${reason}`,
  configLimitExceeded: (limit: string, path: string) =>
    `[utils] config ${limit} limit exceeded at ${path}`,
  configPathInvalid: (path: string, reason: string) =>
    `[utils] invalid config path at ${path}: ${reason}`,
  objectPathInvalid: (path: string, reason: string) =>
    `[utils] invalid object path at ${path}: ${reason}`,
  /** Stable text for malformed template configuration or unsafe value conversion. */
  formatInvalid: (reason: string) => `[utils] invalid string format: ${reason}`,
  /** Stable text for a strict template placeholder that has no own-property value. */
  formatValueMissing: (path: string) => `[utils] missing string format value at ${path}`,
  /** Stable text for locale or Intl number-format configuration rejected by the host. */
  numberFormatInvalid: '[utils] invalid number format configuration'
} as const
