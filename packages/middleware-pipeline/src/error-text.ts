/** Middleware-pipeline 自有错误的稳定文本；由默认双失败组合路径引用。 */
export const MiddlewarePipelineErrorText = {
  /** `runAsyncMiddleware` 无 host 组合器时用于保留既有 AggregateError message。 */
  executionFailed: 'middleware stage and downstream failed',
  /** `createPipeline` 拒绝不属于公开 mode 值域的创建选项。 */
  invalidMode: 'middleware pipeline mode is invalid',
  /** `lift` 拒绝目标 mode 不支持的来源 stage，要求调用方选择合法提升方向。 */
  unsupportedLift: 'middleware pipeline stage cannot be lifted to the target mode'
} as const
