import {
  createPipeline,
  MiddlewarePipelineMode,
  type IAsyncGeneratorMiddlewareStage,
  type IAsyncMiddlewareStage,
  type ICreatePipelineOptions,
  type IGeneratorMiddlewareSignals,
  type IGeneratorMiddlewareStage,
  type IMiddlewarePipelineContext,
  type IMiddlewarePipelineControlOptions,
  type IMiddlewarePipelineViolationHandler,
  type ISyncMiddlewareStage
} from '../src/index.js'

/** Async construction options accepted by migrated behavior-baseline calls. */
type IAsyncTestOptions = Omit<ICreatePipelineOptions<typeof MiddlewarePipelineMode.async>, 'mode'>

/** Runs one sync baseline through the unified public factory. */
export const runSyncForTest = <TValue>(
  stages: readonly ISyncMiddlewareStage<TValue>[],
  value: TValue,
  done: (value: TValue, context?: IMiddlewarePipelineContext) => void,
  onViolation: IMiddlewarePipelineViolationHandler,
  control?: IMiddlewarePipelineControlOptions
): void =>
  createPipeline<TValue>({ mode: MiddlewarePipelineMode.sync, onViolation }).run(
    stages,
    value,
    done,
    control
  )

/** Runs one async baseline through the unified public factory. */
export const runAsyncForTest = <TValue>(
  stages: readonly IAsyncMiddlewareStage<TValue>[],
  value: TValue,
  done: (value: TValue, context?: IMiddlewarePipelineContext) => void | Promise<void>,
  options: IAsyncTestOptions
): Promise<void> =>
  createPipeline<TValue>({ mode: MiddlewarePipelineMode.async, ...options }).run(
    stages,
    value,
    done
  )

/** Runs one generator baseline through the unified public factory. */
export const runGeneratorForTest = <TValue>(
  stages: readonly IGeneratorMiddlewareStage<TValue>[],
  value: TValue,
  done: (value: TValue, context?: IMiddlewarePipelineContext) => void,
  signals?: IGeneratorMiddlewareSignals,
  control?: IMiddlewarePipelineControlOptions
): void =>
  createPipeline<TValue>({ mode: MiddlewarePipelineMode.generator, signals }).run(
    stages,
    value,
    done,
    control
  )

/** Runs one async-generator baseline through the unified public factory. */
export const runAsyncGeneratorForTest = <TValue>(
  stages: readonly IAsyncGeneratorMiddlewareStage<TValue>[],
  value: TValue,
  done: (value: TValue, context?: IMiddlewarePipelineContext) => void | Promise<void>,
  signals?: IGeneratorMiddlewareSignals,
  control?: IMiddlewarePipelineControlOptions
): Promise<void> =>
  createPipeline<TValue>({ mode: MiddlewarePipelineMode.asyncGenerator, signals }).run(
    stages,
    value,
    done,
    control
  )

/** Lifts one sync stage into async mode through the unified public factory. */
export const liftSyncToAsyncForTest = <TValue>(
  stage: ISyncMiddlewareStage<TValue>,
  onViolation: IMiddlewarePipelineViolationHandler = () => undefined
): IAsyncMiddlewareStage<TValue> =>
  createPipeline<TValue>({ mode: MiddlewarePipelineMode.async, onViolation }).lift(
    stage,
    MiddlewarePipelineMode.sync
  )

/** Lifts one sync stage into generator mode through the unified public factory. */
export const liftSyncToGeneratorForTest = <TValue>(
  stage: ISyncMiddlewareStage<TValue>,
  onViolation: IMiddlewarePipelineViolationHandler
): IGeneratorMiddlewareStage<TValue> =>
  createPipeline<TValue>({ mode: MiddlewarePipelineMode.generator, onViolation }).lift(
    stage,
    MiddlewarePipelineMode.sync
  )

/** Lifts one generator stage into async-generator mode through the unified public factory. */
export const liftGeneratorToAsyncGeneratorForTest = <TValue>(
  stage: IGeneratorMiddlewareStage<TValue>
): IAsyncGeneratorMiddlewareStage<TValue> =>
  createPipeline<TValue>({ mode: MiddlewarePipelineMode.asyncGenerator }).lift(
    stage,
    MiddlewarePipelineMode.generator
  )

/** Lifts one sync stage into async-generator mode through the unified public factory. */
export const liftSyncToAsyncGeneratorForTest = <TValue>(
  stage: ISyncMiddlewareStage<TValue>,
  onViolation: IMiddlewarePipelineViolationHandler
): IAsyncGeneratorMiddlewareStage<TValue> =>
  createPipeline<TValue>({ mode: MiddlewarePipelineMode.asyncGenerator, onViolation }).lift(
    stage,
    MiddlewarePipelineMode.sync
  )
