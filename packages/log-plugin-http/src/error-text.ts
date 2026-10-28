/** Stable HTTP messages preserve existing caller diagnostics while the package owner changes. */
export const LogHttpErrorText = {
  /** Creation cannot succeed without a POST transport. */
  transportUnavailable: '[logger] HTTP transport is unavailable in this runtime',
  /** Original serialization failures remain reachable through cause. */
  serializeFailed: '[logger] http 日志序列化失败',
  /** Network rejection is wrapped once without rebuilding an existing HTTP delivery error. */
  transportFailed: 'HTTP transport failed',
  /** Existing status text is retained for retryable and final HTTP responses. */
  deliveryFailed: (status: number): string => `日志推送失败: HTTP ${status}`,
  /** The retained Retry-After bound uses the same public option-admission message. */
  invalidOption: 'logger option admission failed'
} as const
