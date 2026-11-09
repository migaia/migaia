type ISyncBranch<TValue> = { readonly index: number; readonly value: TValue }
import type { IAbortSignal } from '@migaia/utils/promise'
import type {
  IMiddlewarePipelineContext,
  IMiddlewarePipelineOptions,
  ISyncMiddlewareStage
} from '../runtime-types.ts'
import {
  admit,
  check,
  invokeWithContext,
  invokeStageWithContext,
  snapshotStages
} from '../runtime-context.ts'
import {
  MiddlewarePipelineNext,
  MiddlewarePipelineViolation,
  type IMiddlewarePipelineViolationHandler
} from '../state-constants.ts'
import { throwMiddlewarePipelineDownstreamFailures } from '../errors.ts'
import { PipelineSubmissions } from '../pipeline-submissions.ts'
export const runSyncMiddleware = <TValue>(
  stages: readonly ISyncMiddlewareStage<TValue>[],
  value: TValue,
  done: (value: TValue, context?: IMiddlewarePipelineContext) => void,
  onViolation: IMiddlewarePipelineViolationHandler,
  signal?: IAbortSignal,
  assertActive?: () => void,
  nextPolicy: MiddlewarePipelineNext = MiddlewarePipelineNext.single
): void => {
  if (nextPolicy === MiddlewarePipelineNext.multiple)
    return runMultipleSyncPipeline(stages, value, done, {
      signal,
      assertActive,
      onViolation,
      next: nextPolicy
    })
  const context = admit(signal)
  assertActive?.()
  /** Caller-stage identity snapshot; dispatch never observes later list mutation. */
  const stageSnapshot = snapshotStages(stages)
  let current = value
  for (let index = 0; index < stageSnapshot.length; index += 1) {
    const stage = stageSnapshot[index]
    /** Sync stages commit one value locally; no per-stage guard object is needed. */
    let nextValue = current
    /** Each captured next retains its stage's identity so later calls remain detectable. */
    let called = false
    /** Closed only after a normal stage return, preserving the existing throw path. */
    let returned = false
    /** Accepts at most one value before the stage returns; it never executes downstream. */
    const next = (valueAfter: TValue): void => {
      if (returned) {
        onViolation(MiddlewarePipelineViolation.late)
        return
      }
      if (called) {
        onViolation(MiddlewarePipelineViolation.duplicate)
        return
      }
      called = true
      nextValue = valueAfter
    }
    check(context)
    invokeStageWithContext(stage, current, next, context)
    returned = true
    check(context)
    assertActive?.()
    if (!called) return
    current = nextValue
  }
  check(context)
  invokeWithContext(done, current, context)
}

/** Runs an asynchronous stage sequence with runner-owned downstream failure composition. */
export const runMultipleSyncPipeline = <TValue>(
  stages: readonly ISyncMiddlewareStage<TValue>[],
  value: TValue,
  done: (value: TValue, context?: IMiddlewarePipelineContext) => void,
  options: IMiddlewarePipelineOptions
): void => {
  /** Canonical admission runs before any stage or terminal. */
  const context = admit(options.signal)
  /** Caller mutations cannot change the suffix traversals already accepted by this run. */
  const snapshot = snapshotStages(stages)
  /** LIFO suffix requests preserve each stage's submission order. */
  const pending: ISyncBranch<TValue>[] = [{ index: 0, value }]
  /** Independent failures retain registration order while every accepted suffix is traversed. */
  const failures: unknown[] = []
  while (pending.length > 0) {
    const branch = pending.pop()!
    try {
      check(context)
      options.assertActive?.()
      if (branch.index === snapshot.length) {
        invokeWithContext(done, branch.value, context)
        continue
      }
      /** This stage owns its retained callback independently of later branch entries. */
      const submissions = new PipelineSubmissions<TValue>(
        MiddlewarePipelineNext.multiple,
        options.onViolation
      )
      try {
        invokeStageWithContext(snapshot[branch.index]!, branch.value, submissions.next, context)
      } finally {
        submissions.close()
      }
      check(context)
      options.assertActive?.()
      for (let index = submissions.count - 1; index >= 0; index -= 1)
        pending.push({ index: branch.index + 1, value: submissions.at(index) })
    } catch (error) {
      failures.push(error)
    }
  }
  throwMiddlewarePipelineDownstreamFailures(failures)
}

/** A suffix is entered once; an iterator resumes only after that suffix completes. */
