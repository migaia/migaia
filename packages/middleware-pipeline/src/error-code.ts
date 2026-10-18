/**
 * Defines the stable `source` shared by the default dual-failure factory in `errors.ts` and the
 * error-code registry.
 */
export const MIDDLEWARE_PIPELINE_SOURCE = '@migaia/middleware-pipeline'

/** Owns the package-boundary error-code declarations for `@migaia/middleware-pipeline`. */
export const MiddlewarePipelineErrorCode = {
  /**
   * Reports failure in both the current stage and its started downstream when no error combiner is
   * supplied. Also identifies unclassified stage, terminal, host, violation callback, or combiner
   * failures while preserving native identity and every original error. Enforces
   * `middleware-pipeline.sdd.md` MP-R08. Inspect both original failures in `AggregateError.errors`,
   * or provide `combineStageAndDownstreamError` for domain errors.
   */
  executionFailed: 'EXECUTION_FAILED',
  /**
   * Invalid mode, onViolation or other callback, signal/control shape, signals, or lift target. The
   * caller must correct the supplied option rather than retrying the same input.
   */
  invalidOption: 'INVALID_OPTION',
  /**
   * Cooperative abort: unclassified native Error reasons gain identity in place; other values stay
   * on cause.
   */
  aborted: 'ABORTED',
  /** Abort cleanup and abort primary both failed; caller should inspect errors in order. */
  abortCleanupFailed: 'ABORT_CLEANUP_FAILED'
} as const

export type IMiddlewarePipelineErrorCode =
  (typeof MiddlewarePipelineErrorCode)[keyof typeof MiddlewarePipelineErrorCode]
