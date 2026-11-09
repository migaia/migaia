import type { IAbortSignal } from '@migaia/utils/promise'
import type {
  IMiddlewarePipelineContext,
  IMiddlewarePipelineOptions,
  IAsyncGeneratorMiddlewareStage
} from '../runtime-types.ts'
import {
  admit,
  check,
  invokeWithContext,
  cleanupAsyncIterator,
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
export const runAsyncGeneratorMiddleware = async <TValue>(
  stages: readonly IAsyncGeneratorMiddlewareStage<TValue>[],
  value: TValue,
  done: (value: TValue, context?: IMiddlewarePipelineContext) => void | Promise<void>,
  signals: IGeneratorMiddlewareSignals = MiddlewarePipelineGeneratorSignals,
  signal?: IAbortSignal,
  assertActive?: () => void,
  nextPolicy: MiddlewarePipelineNext = MiddlewarePipelineNext.single
): Promise<void> => {
  if (nextPolicy === MiddlewarePipelineNext.multiple)
    return runMultipleAsyncGeneratorPipeline(stages, value, done, signals, {
      signal,
      assertActive,
      onViolation: () => undefined,
      next: nextPolicy
    })
  const context = admit(signal)
  assertActive?.()
  /** Caller-stage identity snapshot; async iteration never re-reads the mutable input list. */
  const stageSnapshot = snapshotStages(stages)
  let current = value
  for (const stage of stageSnapshot) {
    /** Iterator is driven with its native receiver through direct method syntax. */
    check(context)
    const iterator = invokeWithContext(stage, current, context)
    let last = current
    let step = await iterator.next()
    while (!step.done) {
      try {
        check(context)
      } catch (abortFailure) {
        await cleanupAsyncIterator(iterator, abortFailure)
      }
      last = step.value === signals.undefined ? (undefined as TValue) : (step.value as TValue)
      step = await iterator.next()
    }
    check(context)
    assertActive?.()
    /** Terminal signal reduced only after the current stage has completely settled. */
    const reduction = reduceGeneratorTerminal(step.value, last, signals)
    if (reduction.halted) return
    current = reduction.value
  }
  check(context)
  await invokeWithContext(done, current, context)
}
export const runMultipleAsyncGeneratorPipeline = async <TValue>(
  stages: readonly IAsyncGeneratorMiddlewareStage<TValue>[],
  value: TValue,
  done: (value: TValue, context?: IMiddlewarePipelineContext) => void | Promise<void>,
  signals: IGeneratorMiddlewareSignals,
  options: IMiddlewarePipelineOptions
): Promise<void> => {
  /** Admission is shared with every other runner. */
  const context = admit(options.signal)
  /** One immutable snapshot serves every suffix traversal. */
  const snapshot = snapshotStages(stages)
  /** Resume tasks sit below their yielded suffix work. */
  const pending: IGeneratorTask<
    TValue,
    AsyncGenerator<TValue | symbol, TValue | symbol | undefined, void>
  >[] = [{ index: 0, value }]
  while (pending.length > 0) {
    const task = pending.pop()!
    try {
      check(context)
      options.assertActive?.()
      if (!('iterator' in task)) {
        if (task.index === snapshot.length) {
          await invokeWithContext(done, task.value, context)
          continue
        }
        /** One native iterator owns this stage and each subsequent yielded suffix. */
        const iterator = invokeWithContext(snapshot[task.index]!, task.value, context)
        pending.push({ index: task.index, iterator })
        continue
      }
      /** Await failure delivery at the original yield before the stage may submit another value. */
      const step = task.failure
        ? await task.iterator.throw(task.failure.error)
        : await task.iterator.next()
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
      /** The stage owns thrown-back errors; actual return-cleanup failures retain this primary. */
      let primary = error
      if ('iterator' in task) {
        try {
          await cleanupAsyncIterator(task.iterator, primary)
        } catch (cleanup) {
          primary = cleanup
        }
      }
      returnGeneratorFailure(pending, primary)
    }
  }
}
