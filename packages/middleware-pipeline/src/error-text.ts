/** Middleware-pipeline 自有错误的稳定文本；由默认双失败组合路径引用。 */
export const MiddlewarePipelineErrorText = {
  /** `runAsyncMiddleware` 无 host 组合器时用于保留既有 AggregateError message。 */
  executionFailed: 'middleware stage and downstream failed'
} as const;
