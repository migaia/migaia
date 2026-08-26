/** Stable public text for errors crossing the utils package boundary. */
export const UtilsErrorText = {
  invalidArgument: (field: string, expectation: string) =>
    `[utils] invalid ${field}: ${expectation}`,
  nonErrorValue: '[utils] non-Error value was converted',
  envUnsupported: (capability: string) => `[utils] host capability is unavailable: ${capability}`,
  aborted: '[utils] operation aborted',
  deadlineExceeded: (scope: string, timeoutMs: number) =>
    `[utils] ${scope} deadline exceeded after ${timeoutMs}ms`,
  schedulerRunaway: '[utils] manual scheduler exceeded the 10000-task advance guard',
  errorIdentityConflict: (field: string) =>
    `[utils] error identity conflicts with existing ${field}`,
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
    `[utils] invalid object path at ${path}: ${reason}`
} as const
