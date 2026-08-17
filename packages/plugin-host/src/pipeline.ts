import { createPluginHostTypeError, tagPluginHostError } from './error-text.js';
import { PluginHostErrorCode } from './error-code.js';
import type {
  IPipelineMode,
  ISyncPipelineStage,
  IAsyncPipelineStage,
  IGeneratorPipelineStage
} from './typing.js';
import { GENERATOR_CONTINUE, GENERATOR_HALT, GENERATOR_UNDEFINED } from './typing.js';
import { PluginHostPipelineMode, type IPluginHostPipelineViolation } from './state-constants.js';

export type IPipelineStage<TValue> =
  | ISyncPipelineStage<TValue>
  | IAsyncPipelineStage<TValue>
  | IGeneratorPipelineStage<TValue>;
export type IPipelineViolationHandler = (kind: IPluginHostPipelineViolation) => void;

/** Adapt the public synchronous stage shape to the async pipeline contract. */
export const adaptSyncStageToAsync =
  <TValue>(
    stage: ISyncPipelineStage<TValue>,
    // 可选以兼容既有外部调用 `adaptSyncStageToAsync(stage)`（AF-30）；Host 内部仍显式传入 `#onPipelineViolation`。
    onViolation: IPipelineViolationHandler = () => {}
  ): IAsyncPipelineStage<TValue> =>
  async (value, next) => {
    let downstream: Promise<void> | undefined;
    let called = false;
    let returned = false;
    stage(value, (nextValue) => {
      if (returned) {
        onViolation('late');
        return;
      }
      if (called) {
        onViolation('duplicate');
        return;
      }
      called = true;
      downstream = next(nextValue);
    });
    returned = true;
    // 只 await 第一次合法 next 的 downstream（AF-29）：重复/迟到 next 不覆盖它，第一次 rejection 仍被观测。
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
    if (!completed) assertActive?.();
    // 用布尔位判断「发生过错误」，而非以 `undefined` 作哨兵：`throw undefined` / `reject(undefined)` 必须可见（AF-24）。
    if (hasStageError && hasDownstreamError)
      throw tagPluginHostError(
        new AggregateError([stageError, downstreamError], 'pipeline stage and downstream failed'),
        PluginHostErrorCode.pipelineFailed
      );
    if (hasStageError) throw stageError;
    if (hasDownstreamError) throw downstreamError;
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
  if (mode === PluginHostPipelineMode.sync)
    return runSyncPipeline(
      stages as readonly ISyncPipelineStage<TValue>[],
      value,
      done,
      onNextViolation
    );
  if (mode === PluginHostPipelineMode.async)
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
  if (typeof stage !== 'function')
    throw createPluginHostTypeError('pipeline stage must be a function');
  stages.push(stage);
  const registrationIndex = stages.length - 1;
  track(() => {
    const index =
      stages[registrationIndex] === stage ? registrationIndex : stages.lastIndexOf(stage);
    // Duplicate registrations are indistinguishable; removing any matching occurrence is equivalent.
    if (index !== -1) stages.splice(index, 1);
  });
};
