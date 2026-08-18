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

type IAsyncControlPath = {
  /** Marks an entry or post-stage active guard as runner control flow rather than a stage failure. */
  hasActiveError: boolean;
  /** Retains exact active guard value for control-path propagation. */
  activeError: unknown;
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
    let stageError: unknown;
    let hasStageError = false;
    try {
      stage(value, (nextValue) => {
        if (returned) return onViolation(MiddlewarePipelineViolation.late);
        if (called) return onViolation(MiddlewarePipelineViolation.duplicate);
        called = true;
        downstream = next(nextValue);
      });
    } catch (error) {
      stageError = error;
      hasStageError = true;
    }
    returned = true;
    let downstreamError: unknown;
    let hasDownstreamError = false;
    if (downstream) {
      try {
        await downstream;
      } catch (error) {
        downstreamError = error;
        hasDownstreamError = true;
      }
    }
    // The runner owns stage+downstream composition. Standalone adapter calls preserve the
    // stage's identity while still observing downstream, preventing a second AggregateError from
    // entering the host combiner when this adapter is nested inside runAsyncMiddleware.
    if (hasStageError) throw stageError;
    if (hasDownstreamError) throw downstreamError;
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
  /** Caller-stage identity snapshot; dispatch never observes later list mutation. */
  const stageSnapshot = stages.slice();
  let current = value;
  for (let index = 0; index < stageSnapshot.length; index += 1) {
    const stage = stageSnapshot[index];
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
  /** Caller-stage identity snapshot; async dispatch never re-reads the mutable input list. */
  const stageSnapshot = stages.slice();
  let index = -1;
  let completed = false;
  /** Executes one stage and reports runner-owned active control to its parent. */
  const step = async (current: TValue, parentControlPath?: IAsyncControlPath): Promise<void> => {
    /** Records an exact entry or post-stage active guard failure on this frame's parent slot. */
    const markParentActiveError = (error: unknown): void => {
      if (!parentControlPath) return;
      parentControlPath.hasActiveError = true;
      parentControlPath.activeError = error;
    };
    try {
      options.assertActive?.();
    } catch (error) {
      markParentActiveError(error);
      throw error;
    }
    index += 1;
    const stage = stageSnapshot[index];
    if (index >= stageSnapshot.length) {
      completed = true;
      return done(current);
    }
    let pending: Promise<void> | undefined;
    let called = false;
    let returned = false;
    /** Control metadata owned by this frame for its directly started downstream step. */
    const downstreamControlPath: IAsyncControlPath = {
      hasActiveError: false,
      activeError: undefined
    };
    /** Captured downstream rejection; observation starts before the stage settles. */
    let downstreamError: unknown;
    let hasDownstreamError = false;
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
      /** Internal downstream Promise retained for independent failure observation. */
      const downstreamPromise = Promise.resolve().then(() =>
        step(nextValue, downstreamControlPath)
      );
      pending = downstreamPromise;
      void downstreamPromise.then(undefined, (error) => {
        downstreamError = error;
        hasDownstreamError = true;
      });
      return downstreamPromise;
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
    if (pending) {
      try {
        await pending;
      } catch (error) {
        downstreamError = error;
        hasDownstreamError = true;
      }
    }
    if (downstreamControlPath.hasActiveError) {
      /** Exact runner-owned active guard value, kept separate from ordinary failures. */
      const activeError = downstreamControlPath.activeError;
      if (hasStageError) {
        // A child control error is metadata only while it remains this frame's final error.
        // An independently thrown stage error must not taint the parent frame's control slot.
        if (stageError === activeError) markParentActiveError(activeError);
        throw stageError;
      }
      markParentActiveError(activeError);
      throw activeError;
    }
    if (hasStageError && hasDownstreamError) {
      if (options.combineStageAndDownstreamError) {
        throw options.combineStageAndDownstreamError(stageError, downstreamError);
      }
      throw createMiddlewarePipelineExecutionError(stageError, downstreamError);
    }
    if (hasStageError) throw stageError;
    if (hasDownstreamError) throw downstreamError;
    if (!completed) {
      try {
        options.assertActive?.();
      } catch (error) {
        markParentActiveError(error);
        throw error;
      }
    }
  };
  await step(value);
};

export const runGeneratorMiddleware = <TValue>(
  stages: readonly IGeneratorMiddlewareStage<TValue>[],
  value: TValue,
  done: (value: TValue) => void,
  signals: IGeneratorMiddlewareSignals = MiddlewarePipelineGeneratorSignals
): void => {
  /** Caller-stage identity snapshot; generator dispatch uses one fixed stage sequence. */
  const stageSnapshot = stages.slice();
  let current = value;
  for (const stage of stageSnapshot) {
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
