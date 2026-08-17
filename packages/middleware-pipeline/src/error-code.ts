/** `errors.ts` 默认双失败工厂与 `docs/contracts/error-codes.md` 注册表共用的稳定 source。 */
export const MIDDLEWARE_PIPELINE_SOURCE = '@migaia/middleware-pipeline';

/** `@migaia/middleware-pipeline` 的包边界错误码唯一声明处。 */
export const MiddlewarePipelineErrorCode = {
  /**
   * 当前 stage 与它已经启动的 downstream 同时失败，且调用方未提供错误组合策略时抛出。
   *
   * 落实 `middleware-pipeline.sdd.md` MP-R08；调用方应检查 `AggregateError.errors` 中的两个原始失败，或通过
   * `combineStageAndDownstreamError` 接管领域错误。
   */
  executionFailed: 'EXECUTION_FAILED'
} as const;

export type IMiddlewarePipelineErrorCode =
  (typeof MiddlewarePipelineErrorCode)[keyof typeof MiddlewarePipelineErrorCode];
