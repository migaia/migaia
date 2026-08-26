import type { IAbortSignal } from '@migaia/lifecycle'
import type {
  IAsyncGeneratorMiddlewareStage,
  IGeneratorMiddlewareStage,
  IMiddlewarePipelineAbortSignal,
  IMiddlewarePipelineContext,
  IMiddlewarePipelineControlOptions,
  ISyncMiddlewareStage
} from '@migaia/middleware-pipeline'

/** Compile-time consumer proof for native, lifecycle, and minimal structural signals. */
const nativeSignal: IMiddlewarePipelineAbortSignal = {} as AbortSignal
const lifecycleSignal: IMiddlewarePipelineAbortSignal = {} as IAbortSignal
const customSignal: IMiddlewarePipelineAbortSignal = {
  aborted: false,
  addEventListener() {},
  removeEventListener() {}
}
const context: IMiddlewarePipelineContext = { signal: nativeSignal }
const control: IMiddlewarePipelineControlOptions = { signal: lifecycleSignal }
const syncStage: ISyncMiddlewareStage<number> = (value, next, received) => {
  void received?.signal
  next(value)
}
const generatorStage: IGeneratorMiddlewareStage<number> = function* (value, received) {
  void received?.signal
  yield value
  return undefined
}
const asyncGeneratorStage: IAsyncGeneratorMiddlewareStage<number> = async function* (
  value,
  received
) {
  void received?.signal
  yield value
  return undefined
}

export const packedConsumerTypes = {
  nativeSignal,
  lifecycleSignal,
  customSignal,
  context,
  control,
  syncStage,
  generatorStage,
  asyncGeneratorStage
}
