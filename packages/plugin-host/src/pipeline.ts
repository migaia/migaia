import type {
  IPipelineMode,
  ISyncPipelineStage,
  IAsyncPipelineStage,
  IGeneratorPipelineStage
} from './typing';
import { GENERATOR_CONTINUE, GENERATOR_HALT, GENERATOR_UNDEFINED } from './typing';

export type IPipelineStage<TValue> =
  | ISyncPipelineStage<TValue>
  | IAsyncPipelineStage<TValue>
  | IGeneratorPipelineStage<TValue>;
export type IPipelineViolationHandler = (kind: 'late' | 'duplicate') => void;

/** Adapt the public synchronous stage shape to the async pipeline contract. */
export const adaptSyncStageToAsync =
  <TValue>(stage: ISyncPipelineStage<TValue>): IAsyncPipelineStage<TValue> =>
  async (value, next) => {
    let downstream: Promise<void> | undefined;
    stage(value, (nextValue) => {
      downstream = next(nextValue);
    });
    await downstream;
  };

/** Adapt the public synchronous stage shape to the generator pipeline contract. */
export const adaptSyncStageToGenerator = <TValue>(
  stage: ISyncPipelineStage<TValue>,
  onViolation: IPipelineViolationHandler
): IGeneratorPipelineStage<TValue> =>
  function* (value) {
    let passed = false;
    let returned = false;
    let nextValue = value;
    stage(value, (candidate) => {
      if (returned) return onViolation('late');
      if (passed) return onViolation('duplicate');
      passed = true;
      nextValue = candidate;
    });
    returned = true;
    if (!passed) return GENERATOR_HALT;
    yield nextValue;
    return GENERATOR_CONTINUE;
  };

export const runSyncPipeline = <TValue>(
  stages: readonly ISyncPipelineStage<TValue>[],
  value: TValue,
  done: (value: TValue) => void,
  onViolation: IPipelineViolationHandler
): void => {
  let current = value;
  for (let index = 0; index < stages.length; index += 1) {
    const stage = stages[index];
    let called = false;
    let returned = false;
    let nextValue = current;
    const next = (valueAfter: TValue): void => {
      if (returned) return onViolation('late');
      if (called) return onViolation('duplicate');
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

export const runAsyncPipeline = async <TValue>(
  stages: readonly IAsyncPipelineStage<TValue>[],
  value: TValue,
  done: (value: TValue) => void | Promise<void>,
  onViolation: IPipelineViolationHandler,
  assertActive?: () => void
): Promise<void> => {
  let index = -1;
  let completed = false;
  const step = async (current: TValue): Promise<void> => {
    assertActive?.();
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
        onViolation('late');
        return Promise.resolve();
      }
      if (called) {
        onViolation('duplicate');
        return Promise.resolve();
      }
      called = true;
      // Defer the recursive continuation to a microtask so long synchronous
      // next() chains do not consume the JavaScript call stack.
      pending = Promise.resolve().then(() => step(nextValue));
      return pending;
    };
    let stageError: unknown;
    try {
      await stage(current, next);
    } catch (error) {
      stageError = error;
    }
    returned = true;
    let downstreamError: unknown;
    if (pending) {
      try {
        await pending;
      } catch (error) {
        downstreamError = error;
      }
    }
    if (!completed) assertActive?.();
    if (stageError !== undefined && downstreamError !== undefined)
      throw new AggregateError(
        [stageError, downstreamError],
        'pipeline stage and downstream failed'
      );
    if (stageError !== undefined) throw stageError;
    if (downstreamError !== undefined) throw downstreamError;
  };
  await step(value);
};

export const runGeneratorPipeline = <TValue>(
  stages: readonly IGeneratorPipelineStage<TValue>[],
  value: TValue,
  done: (value: TValue) => void
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
    if (step.value === GENERATOR_HALT || step.value === undefined) return;
    current =
      step.value === GENERATOR_UNDEFINED
        ? (undefined as TValue)
        : step.value === GENERATOR_CONTINUE
          ? last
          : step.value;
  }
  done(current);
};

export const runPipeline = <TValue>(
  mode: IPipelineMode,
  stages: readonly IPipelineStage<TValue>[],
  value: TValue,
  done: (value: TValue) => void,
  onNextViolation: IPipelineViolationHandler,
  assertActive?: () => void
): void | Promise<void> => {
  if (mode === 'sync')
    return runSyncPipeline(
      stages as readonly ISyncPipelineStage<TValue>[],
      value,
      done,
      onNextViolation
    );
  if (mode === 'async')
    return runAsyncPipeline(
      stages as readonly IAsyncPipelineStage<TValue>[],
      value,
      done,
      onNextViolation,
      assertActive
    );
  return runGeneratorPipeline(stages as readonly IGeneratorPipelineStage<TValue>[], value, done);
};

export const registerStage = <TStage>(
  stages: TStage[],
  stage: TStage,
  track: (dispose: () => void) => void
): void => {
  if (typeof stage !== 'function') throw new TypeError('pipeline stage must be a function');
  stages.push(stage);
  const registrationIndex = stages.length - 1;
  track(() => {
    const index =
      stages[registrationIndex] === stage ? registrationIndex : stages.lastIndexOf(stage);
    // Duplicate registrations are indistinguishable; removing any matching occurrence is equivalent.
    if (index !== -1) stages.splice(index, 1);
  });
};
