/** Stable error domain owned by this code table; package moves preserve this identity. */
export const ERROR_SOURCE = 'middleware.pipeline'

/**
 * Stable source attached to package-owned input, execution, and cancellation failures. A failure
 * already carrying another complete semantic source/code keeps that original identity.
 */
export const MIDDLEWARE_PIPELINE_SOURCE = ERROR_SOURCE

/**
 * Stable codes for failures owned by this package. Branch on source/code rather than message text;
 * native error types and originals remain available directly or through
 * cause/AggregateError.errors.
 */
export const MiddlewarePipelineErrorCode = {
  /**
   * Reports failure in both the current stage and its started downstream when no error combiner is
   * supplied. Also identifies unclassified stage, terminal, host, violation callback, or combiner
   * failures while preserving native identity where possible and retaining original failures.
   * Inspect both independent failures in `AggregateError.errors`, or supply an error combiner that
   * retains them through cause/errors when a domain-specific error is required.
   */
  executionFailed: 'EXECUTION_FAILED',
  /**
   * Several already-started async downstream traversals failed. Inspect errors in submission order;
   * each entry is the original failure, independent of its settlement order.
   */
  multipleDownstreamFailed: 'MULTIPLE_DOWNSTREAM_FAILED',
  /**
   * Invalid mode, onViolation or other callback, signal/control shape, signals, or lift target. The
   * caller must correct the supplied option rather than retrying the same input.
   */
  invalidOption: 'INVALID_OPTION',
  /**
   * A cooperative checkpoint observes cancellation. Unclassified Error reasons gain identity where
   * attachable; other reasons remain on cause. Started work is awaited, not forcibly interrupted.
   */
  aborted: 'ABORTED',
  /** Iterator cleanup failed during cancellation. errors contains abort first, then cleanup failure. */
  abortCleanupFailed: 'ABORT_CLEANUP_FAILED'
} as const

/**
 * Union of the package's semantic failure codes; next-call violations use a separate diagnostic
 * domain.
 */
export type IMiddlewarePipelineErrorCode =
  (typeof MiddlewarePipelineErrorCode)[keyof typeof MiddlewarePipelineErrorCode]
