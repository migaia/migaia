import type { IAbortSignal } from '@migaia/utils/promise'
import type {
  IAsyncGeneratorMiddlewareStage,
  IGeneratorMiddlewareStage,
  IMiddlewarePipelineContext,
  IMiddlewarePipelineControlOptions,
  ISyncMiddlewareStage
} from '@migaia/middleware-pipeline'

/** Compile-time consumer proof for native, lifecycle, and minimal structural signals. */
const nativeSignal: IAbortSignal = {} as AbortSignal
const lifecycleSignal: IAbortSignal = {} as IAbortSignal
const customSignal: IAbortSignal = {
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
