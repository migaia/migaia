/** Owns stable error text for the default stage-and-downstream failure combination path. */
export const MiddlewarePipelineErrorText = {
  /**
   * Preserves the existing `AggregateError` message when `runAsyncMiddleware` has no host error
   * combiner.
   */
  executionFailed: 'middleware stage and downstream failed',
  /** Describes `createPipeline` rejecting a creation option outside the public mode values. */
  invalidMode: 'middleware pipeline mode is invalid',
  /**
   * Describes `lift` rejecting a source stage unsupported by the target mode. Callers must choose a
   * supported lift direction.
   */
  unsupportedLift: 'middleware pipeline stage cannot be lifted to the target mode'
} as const
