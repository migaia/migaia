import { MiddlewarePipelineMode, type ISyncMiddlewareStage } from '@migaia/middleware-pipeline'

/** Type-only stage witness that must not retain any runner implementation. */
const identity: ISyncMiddlewareStage<number> = (value, next) => next(value)

/** Returns a public constant while keeping the stage import erased from runtime output. */
export const readSyncMode = (): string => {
  void identity
  return MiddlewarePipelineMode.sync
}
