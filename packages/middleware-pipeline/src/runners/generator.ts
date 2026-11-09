import type { IAbortSignal } from '@migaia/utils/promise'
import type {
  IMiddlewarePipelineContext,
  IMiddlewarePipelineOptions,
  IGeneratorMiddlewareStage
} from '../runtime-types.ts'
import {
  admit,
  check,
  invokeWithContext,
  cleanupSyncIterator,
  snapshotStages
} from '../runtime-context.ts'
import {
  MiddlewarePipelineGeneratorSignals,
  MiddlewarePipelineNext,
  type IGeneratorMiddlewareSignals
} from '../state-constants.ts'

import {
  reduceGeneratorTerminal,
  returnGeneratorFailure,
  yieldedValue,
  type IGeneratorTask
} from '../generator-control.ts'
export const runGeneratorMiddleware = <TValue>(
  stages: readonly IGeneratorMiddlewareStage<TValue>[],
  value: TValue,
  done: (value: TValue, context?: IMiddlewarePipelineContext) => void,
  signals: IGeneratorMiddlewareSignals = MiddlewarePipelineGeneratorSignals,
  signal?: IAbortSignal,
  assertActive?: () => void,
  nextPolicy: MiddlewarePipelineNext = MiddlewarePipelineNext.single
): void => {
  if (nextPolicy === MiddlewarePipelineNext.multiple)
    return runMultipleGeneratorPipeline(stages, value, done, signals, {
      signal,
      assertActive,
      onViolation: () => undefined,
      next: nextPolicy
    })
  const context = admit(signal)
  assertActive?.()
  /** Caller-stage identity snapshot; generator dispatch uses one fixed stage sequence. */
  const stageSnapshot = snapshotStages(stages)
  let current = value
  for (const stage of stageSnapshot) {
    check(context)
    const iterator = invokeWithContext(stage, current, context)
    let last = current
    let step = iterator.next()
    while (!step.done) {
      try {
        check(context)
      } catch (abortFailure) {
        cleanupSyncIterator(iterator, abortFailure)
      }
      last = step.value === signals.undefined ? (undefined as TValue) : (step.value as TValue)
      step = iterator.next()
    }
    check(context)
    assertActive?.()
    /** Terminal signal reduced by the canonical generator transition contract. */
    const reduction = reduceGeneratorTerminal(step.value, last, signals)
    if (reduction.halted) return
    current = reduction.value
  }
  check(context)
  invokeWithContext(done, current, context)
}

/** Serially drains asynchronous generator stages and commits only each terminal transition. */
/** Reduces asynchronous generator stages and awaits cancellation cleanup before rejecting. */
export const runMultipleGeneratorPipeline = <TValue>(
  stages: readonly IGeneratorMiddlewareStage<TValue>[],
  value: TValue,
  done: (value: TValue, context?: IMiddlewarePipelineContext) => void,
  signals: IGeneratorMiddlewareSignals,
  options: IMiddlewarePipelineOptions
): void => {
  /** Admission is shared with every other runner. */
  const context = admit(options.signal)
  /** One immutable snapshot serves every suffix traversal. */
  const snapshot = snapshotStages(stages)
  /** Resume tasks sit below their yielded suffix work. */
  const pending: IGeneratorTask<
    TValue,
    Generator<TValue | symbol, TValue | symbol | undefined, void>
  >[] = [{ index: 0, value }]
  while (pending.length > 0) {
    const task = pending.pop()!
    try {
      check(context)
      options.assertActive?.()
      if (!('iterator' in task)) {
        if (task.index === snapshot.length) {
          invokeWithContext(done, task.value, context)
          continue
        }
        /** The factory and all yielded suffixes stay under this one task stack. */
        const iterator = invokeWithContext(snapshot[task.index]!, task.value, context)
        pending.push({ index: task.index, iterator })
        continue
      }
      /** A failed suffix resumes exactly its originating yield through the native throw method. */
      const step = task.failure ? task.iterator.throw(task.failure.error) : task.iterator.next()
      check(context)
      options.assertActive?.()
      if (step.done) {
        if (
          step.value === undefined ||
          step.value === signals.continue ||
          step.value === signals.halt
        )
          continue
      } else pending.push({ index: task.index, iterator: task.iterator })
      pending.push({
        index: task.index + 1,
        value: yieldedValue<TValue>(step.value as TValue | symbol, signals)
      })
    } catch (error) {
      /** Interrupted iterators drain their original cleanup before failure reaches an ancestor. */
      let primary = error
      if ('iterator' in task) {
        try {
          cleanupSyncIterator(task.iterator, primary)
        } catch (cleanup) {
          primary = cleanup
        }
      }
      returnGeneratorFailure(pending, primary)
    }
  }
}

/** Awaits each async yield traversal and terminal I/O before resuming its originating iterator. */
