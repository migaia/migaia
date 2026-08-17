import { createMiddlewarePipelineExecutionError } from './errors.js';
import {
  GENERATOR_CONTINUE,
  GENERATOR_HALT,
  GENERATOR_UNDEFINED,
  MiddlewarePipelineGeneratorSignals,
  MiddlewarePipelineViolation,
  type IGeneratorMiddlewareSignals,
  type IMiddlewarePipelineViolationHandler
} from './state-constants.js';

export {
  GENERATOR_CONTINUE,
  GENERATOR_HALT,
  GENERATOR_UNDEFINED,
  MiddlewarePipelineGeneratorSignals,
  MiddlewarePipelineMode,
  MiddlewarePipelineViolation
} from './state-constants.js';
export type {
  IGeneratorMiddlewareSignals,
  IMiddlewarePipelineMode,
  IMiddlewarePipelineViolation,
  IMiddlewarePipelineViolationHandler
} from './state-constants.js';

/** Explicit generator result used when the payload itself may be undefined. */
export { MIDDLEWARE_PIPELINE_SOURCE, MiddlewarePipelineErrorCode } from './error-code.js';
export type { IMiddlewarePipelineErrorCode } from './error-code.js';

type IGeneratorUndefinedSignal<TValue> = undefined extends TValue
  ? typeof GENERATOR_UNDEFINED
  : never;

export type ISyncMiddlewareStage<TValue> = (value: TValue, next: (value: TValue) => void) => void;
export type IAsyncMiddlewareStage<TValue> = (
  value: TValue,
  next: (value: TValue) => Promise<void>
) => void | Promise<void>;
export type IGeneratorMiddlewareStage<TValue> = (
  value: TValue
) => Generator<
  TValue,
  | TValue
  | IGeneratorUndefinedSignal<TValue>
  | typeof GENERATOR_HALT
  | typeof GENERATOR_CONTINUE
  | undefined,
  void
>;

export type IMiddlewarePipelineOptions = {
  readonly onViolation: IMiddlewarePipelineViolationHandler;
  readonly assertActive?: () => void;
  /** Host-owned error construction for the stage+downstream failure case. */
  readonly combineStageAndDownstreamError?: (stage: unknown, downstream: unknown) => unknown;
};

/** Adapts a sync stage to async middleware while preserving next() violations. */
export const adaptSyncStageToAsync =
  <TValue>(
    stage: ISyncMiddlewareStage<TValue>,
    onViolation: IMiddlewarePipelineViolationHandler = () => {}
  ): IAsyncMiddlewareStage<TValue> =>
  async (value, next) => {
    let downstream: Promise<void> | undefined;
    let called = false;
    let returned = false;
    stage(value, (nextValue) => {
      if (returned) return onViolation(MiddlewarePipelineViolation.late);
      if (called) return onViolation(MiddlewarePipelineViolation.duplicate);
      called = true;
      downstream = next(nextValue);
    });
    returned = true;
    await downstream;
  };

/** Adapts a sync stage to generator middleware while preserving next() violations. */
export const adaptSyncStageToGenerator = <TValue>(
  stage: ISyncMiddlewareStage<TValue>,
  onViolation: IMiddlewarePipelineViolationHandler
): IGeneratorMiddlewareStage<TValue> =>
  function* (value) {
    let passed = false;
    let returned = false;
    let nextValue = value;
    stage(value, (candidate) => {
      if (returned) return onViolation(MiddlewarePipelineViolation.late);
      if (passed) return onViolation(MiddlewarePipelineViolation.duplicate);
      passed = true;
      nextValue = candidate;
    });
    returned = true;
    if (!passed) return GENERATOR_HALT;
    yield nextValue;
    return GENERATOR_CONTINUE;
  };

export const runSyncMiddleware = <TValue>(
  stages: readonly ISyncMiddlewareStage<TValue>[],
  value: TValue,
  done: (value: TValue) => void,
  onViolation: IMiddlewarePipelineViolationHandler
): void => {
  let current = value;
  for (let index = 0; index < stages.length; index += 1) {
    const stage = stages[index];
    let called = false;
    let returned = false;
    let nextValue = current;
    const next = (valueAfter: TValue): void => {
      if (returned) return onViolation(MiddlewarePipelineViolation.late);
      if (called) return onViolation(MiddlewarePipelineViolation.duplicate);
      called = true;
      nextValue = valueAfter;
    };
    stage(current, next);
    returned = true;
    if (!called) return;
    current = nextValue;
  }
  done(current);
};

export const runAsyncMiddleware = async <TValue>(
  stages: readonly IAsyncMiddlewareStage<TValue>[],
  value: TValue,
  done: (value: TValue) => void | Promise<void>,
  options: IMiddlewarePipelineOptions
): Promise<void> => {
  let index = -1;
  let completed = false;
  const step = async (current: TValue): Promise<void> => {
    options.assertActive?.();
    index += 1;
    const stage = stages[index];
    if (!stage) {
      completed = true;
      return done(current);
    }
    let pending: Promise<void> | undefined;
    let called = false;
    let returned = false;
    const next = (nextValue: TValue): Promise<void> => {
      if (returned) {
        options.onViolation(MiddlewarePipelineViolation.late);
        return Promise.resolve();
      }
      if (called) {
        options.onViolation(MiddlewarePipelineViolation.duplicate);
        return Promise.resolve();
      }
      called = true;
      pending = Promise.resolve().then(() => step(nextValue));
      return pending;
    };
    let stageError: unknown;
    let hasStageError = false;
    try {
      await stage(current, next);
    } catch (error) {
      stageError = error;
      hasStageError = true;
    }
    returned = true;
    let downstreamError: unknown;
    let hasDownstreamError = false;
    if (pending) {
      try {
        await pending;
      } catch (error) {
        downstreamError = error;
        hasDownstreamError = true;
      }
    }
    if (!completed) options.assertActive?.();
    if (hasStageError && hasDownstreamError) {
      throw (
        options.combineStageAndDownstreamError?.(stageError, downstreamError) ??
        createMiddlewarePipelineExecutionError(stageError, downstreamError)
      );
    }
    if (hasStageError) throw stageError;
    if (hasDownstreamError) throw downstreamError;
  };
  await step(value);
};

export const runGeneratorMiddleware = <TValue>(
  stages: readonly IGeneratorMiddlewareStage<TValue>[],
  value: TValue,
  done: (value: TValue) => void,
  signals: IGeneratorMiddlewareSignals = MiddlewarePipelineGeneratorSignals
): void => {
  let current = value;
  for (const stage of stages) {
    const iterator = stage(current);
    let last = current;
    let step = iterator.next();
    while (!step.done) {
      last = step.value;
      step = iterator.next();
    }
    if (step.value === signals.halt || step.value === undefined) return;
    current =
      step.value === signals.undefined
        ? (undefined as TValue)
        : step.value === signals.continue
          ? last
          : (step.value as TValue);
  }
  done(current);
};
