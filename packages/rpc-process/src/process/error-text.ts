/** Native Process adapters own their private presentation; callers classify source/code instead. */
export const RpcProcessErrorText = {
  /** OS sampling reports a fixed message and retains native failure details only on cause. */
  usageSampleFailed: 'process resource sampling failed',
  /** Invalid OS statistics remain unavailable rather than producing fabricated resource values. */
  usageInvalid: 'process resource statistics are invalid',
  /** A closed native channel rejects additional work with the existing connection diagnostic. */
  channelClosed: 'process channel is closed',
  /** A failed native dial or launch retains the original system error as cause. */
  connectFailed: 'process channel connection failed',
  /** A native listener reports its binding failure without changing its semantic code. */
  listenFailed: 'process channel listener failed',
  /** Native adapter option admission preserves the existing non-reflecting diagnostic. */
  optionsInvalid: 'process channel options are invalid',
  /** Native authorization rejects the connection without exposing secret-bearing exceptions. */
  authRejected: 'process channel authentication rejected'
} as const
