/** Canonical signal contract diagnostics; kept separate so unused runners tree-shake cleanly. */
export const MiddlewarePipelineSignalText = {
  invalidOption: 'middleware pipeline signal option is invalid',
  aborted: 'middleware pipeline aborted',
  abortCleanupFailed: 'middleware pipeline abort cleanup failed'
} as const
