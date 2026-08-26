import { GENERATOR_CONTINUE, runAsyncGeneratorMiddleware } from '@migaia/middleware-pipeline'
import type { IAsyncGeneratorMiddlewareStage } from '@migaia/middleware-pipeline'

/** Async-generator-only fixture used to verify public-boundary tree shaking. */
const stage: IAsyncGeneratorMiddlewareStage<number> = async function* (value) {
  yield value + 1
  return GENERATOR_CONTINUE
}

/** Stable fixture marker retained in the generated production chunk. */
export const runAsyncGeneratorOnly = (): Promise<void> =>
  runAsyncGeneratorMiddleware([stage], 1, () => undefined)
