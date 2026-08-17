import {
  MIDDLEWARE_PIPELINE_SOURCE,
  MiddlewarePipelineErrorCode,
  type IMiddlewarePipelineErrorCode
} from './error-code.js';
import { MiddlewarePipelineErrorText } from './error-text.js';

/** 同时保留 stage/downstream 原错误，并给默认 AggregateError 附加包边界契约。 */
export const createMiddlewarePipelineExecutionError = (
  stageError: unknown,
  downstreamError: unknown
): AggregateError & {
  readonly source: typeof MIDDLEWARE_PIPELINE_SOURCE;
  readonly code: IMiddlewarePipelineErrorCode;
} => {
  /** AggregateError is retained so both original failures remain identity-reachable. */
  const error = new AggregateError(
    [stageError, downstreamError],
    MiddlewarePipelineErrorText.executionFailed
  );
  Object.defineProperty(error, 'source', {
    value: MIDDLEWARE_PIPELINE_SOURCE,
    enumerable: true
  });
  Object.defineProperty(error, 'code', {
    value: MiddlewarePipelineErrorCode.executionFailed,
    enumerable: true
  });
  return error as AggregateError & {
    readonly source: typeof MIDDLEWARE_PIPELINE_SOURCE;
    readonly code: IMiddlewarePipelineErrorCode;
  };
};
