/** Owns canonical middleware admission, lifting and single-value transitions. */
import {
  PipelineSubmissions,
  runAsyncPipeline,
  runMultipleSyncPipeline,
  runMultipleGeneratorPipeline,
  runMultipleAsyncGeneratorPipeline
} from './execution-runtime.js'
import type { IAbortSignal } from '@migaia/utils/promise'
import { throwMiddlewarePipelineDownstreamFailures } from './errors.js'
import {
  admit,
  check,
  invokeWithContext,
  invokeStageWithContext,
  cleanupSyncIterator,
  cleanupAsyncIterator,
  snapshotStages
} from './runtime-context.js'

import {
  MiddlewarePipelineGeneratorSignals,
  MiddlewarePipelineNext,
  MiddlewarePipelineViolation,
  type IGeneratorMiddlewareSignals,
  type IMiddlewarePipelineViolationHandler
} from './state-constants.js'

/** Explicit generator result used when the payload itself may be undefined. */
type IGeneratorUndefinedSignal<
  TValue,
  TSignals extends IGeneratorMiddlewareSignals
> = undefined extends TValue ? TSignals['undefined'] : never

/** One frozen context shared by stages and done only when this run has an effective abort signal. */
export type IMiddlewarePipelineContext = {
  /**
   * Host-owned effective signal after run-level override; running work must cooperate with
   * cancellation.
   */
  readonly signal: IAbortSignal
}
/** Per-run controls. Omitted controls reuse the construction defaults without creating a controller. */
export type IMiddlewarePipelineControlOptions = {
  /** Overrides the construction signal when supplied; undefined falls back to that default. */
  readonly signal?: IAbortSignal
}
/**
 * Synchronous stage receiving the current value and optional signal context. The first next(value)
 * only submits a value; downstream starts after this stage returns normally. No next short-circuits
 * the run without done. A throw prevents downstream entry; duplicate/late next calls report a
 * violation.
 */
export type ISyncMiddlewareStage<TValue> = (
  value: TValue,
  next: (value: TValue) => void,
  context?: IMiddlewarePipelineContext
) => void
/**
 * Async onion stage: the first next(value) starts downstream immediately and returns its promise.
 * Await next for before/after ordering. The runner still waits for started downstream when next is
 * not awaited, and reports duplicate/late calls without starting another traversal. Not calling
 * next short-circuits; independent stage/downstream failures use the configured composition
 * policy.
 */
export type IAsyncMiddlewareStage<TValue, TResult = void> = (
  value: TValue,
  next: (value: TValue) => Promise<TResult>,
  context?: IMiddlewarePipelineContext
) => void | Promise<unknown>
/**
 * Synchronous generator stage drained completely before downstream starts. Yields remain local: a
 * normal returned value continues, continue selects the last yield (or input when no yield), halt
 * or an implicit undefined return stops, and the undefined signal explicitly forwards undefined.
 * Use the runner's configured control symbols; cancellation during iteration drains iterator
 * cleanup.
 */
export type IGeneratorMiddlewareStage<
  TValue,
  TSignals extends IGeneratorMiddlewareSignals = typeof MiddlewarePipelineGeneratorSignals
> = (
  value: TValue,
  context?: IMiddlewarePipelineContext
) => Generator<
  TValue | IGeneratorUndefinedSignal<TValue, TSignals>,
  | TValue
  | IGeneratorUndefinedSignal<TValue, TSignals>
  | TSignals['halt']
  | TSignals['continue']
  | undefined,
  void
>
/**
 * Async generator stage whose iterations finish before the next stage begins. Terminal control
 * meanings match the synchronous generator stage; ordinary yields do not publish downstream values.
 * The runner awaits iteration and cancellation cleanup. A payload domain containing undefined is
 * required to forward an explicit undefined signal; failures reject the run with originals
 * retained.
 */
export type IAsyncGeneratorMiddlewareStage<
  TValue,
  TSignals extends IGeneratorMiddlewareSignals = typeof MiddlewarePipelineGeneratorSignals
> = (
  value: TValue,
  context?: IMiddlewarePipelineContext
) => AsyncGenerator<
  TValue | IGeneratorUndefinedSignal<TValue, TSignals>,
  | TValue
  | IGeneratorUndefinedSignal<TValue, TSignals>
  | TSignals['halt']
  | TSignals['continue']
  | undefined,
  void
>

export type IMiddlewarePipelineOptions = {
  /** Fixed construction policy for accepted downstream submissions. */
  readonly next?: MiddlewarePipelineNext
  readonly onViolation: IMiddlewarePipelineViolationHandler
  readonly assertActive?: () => void
  /** Host-owned error construction for the stage+downstream failure case. */
  readonly combineStageAndDownstreamError?: (stage: unknown, downstream: unknown) => unknown
  readonly signal?: IAbortSignal
}

type IGeneratorReduction<TValue> =
  | { readonly halted: true }
  | { readonly halted: false; readonly value: TValue }

/** Resolves one completed generator stage without exposing intermediate yields downstream. */
const reduceGeneratorTerminal = <TValue>(
  terminal: unknown,
  last: TValue,
  signals: IGeneratorMiddlewareSignals
): IGeneratorReduction<TValue> => {
  if (terminal === signals.halt || terminal === undefined) return { halted: true }
  if (terminal === signals.undefined) return { halted: false, value: undefined as TValue }
  if (terminal === signals.continue) return { halted: false, value: last }
  return { halted: false, value: terminal as TValue }
}

/**
 * Adapts a sync stage to async middleware while preserving next() violations.
 *
 * Keeps the sync runner's linear-reduce order: `next()` inside the stage only records the value,
 * and downstream starts after the stage returns, so code after `next()` always runs before
 * downstream. A throwing stage never starts downstream and rejects with its own error; a downstream
 * rejection propagates unchanged, and the runner still owns stage+downstream composition.
 */
export const adaptSyncStageToAsync =
  <TValue>(
    stage: ISyncMiddlewareStage<TValue>,
    onViolation: IMiddlewarePipelineViolationHandler,
    nextPolicy: MiddlewarePipelineNext = MiddlewarePipelineNext.single
  ): IAsyncMiddlewareStage<TValue> =>
  async (value, next, context) => {
    /** Local submissions preserve synchronous stage timing under async lifting. */
    const submissions = new PipelineSubmissions<TValue>(nextPolicy, onViolation)
    try {
      invokeStageWithContext(stage, value, submissions.next, context)
    } finally {
      submissions.close()
    }
    /** A lifted sync stage cannot handle suffix errors, so all its registered values still run. */
    const failures: unknown[] = []
    for (let index = 0; index < submissions.count; index += 1) {
      try {
        await next(submissions.at(index))
      } catch (error) {
        if (nextPolicy === MiddlewarePipelineNext.single) throw error
        failures.push(error)
      }
    }
    throwMiddlewarePipelineDownstreamFailures(failures)
  }

/** Adapts sync submissions through the same generator continuation protocol. */
export const adaptSyncStageToGenerator = <
  TValue,
  TSignals extends IGeneratorMiddlewareSignals = typeof MiddlewarePipelineGeneratorSignals
>(
  stage: ISyncMiddlewareStage<TValue>,
  onViolation: IMiddlewarePipelineViolationHandler,
  signals: TSignals = MiddlewarePipelineGeneratorSignals as TSignals,
  nextPolicy: MiddlewarePipelineNext = MiddlewarePipelineNext.single
): IGeneratorMiddlewareStage<TValue, TSignals> =>
  function* (value, context) {
    /** Sync stage side effects complete before any yielded value reaches downstream. */
    const submissions = new PipelineSubmissions<TValue>(nextPolicy, onViolation)
    try {
      invokeStageWithContext(stage, value, submissions.next, context)
    } finally {
      submissions.close()
    }
    if (submissions.count === 0) return signals.halt
    /** Throw-back belongs to the adapter because the originating sync stage has already returned. */
    const failures: unknown[] = []
    for (let index = 0; index < submissions.count; index += 1) {
      try {
        yield submissions.at(index)
      } catch (error) {
        if (nextPolicy === MiddlewarePipelineNext.single) throw error
        failures.push(error)
      }
    }
    throwMiddlewarePipelineDownstreamFailures(failures)
    return signals.continue
  }

/** Promotes a synchronous generator by delegating its yields and terminal signal. */
export const adaptGeneratorStageToAsyncGenerator = <
  TValue,
  TSignals extends IGeneratorMiddlewareSignals = typeof MiddlewarePipelineGeneratorSignals
>(
  stage: IGeneratorMiddlewareStage<TValue, TSignals>
): IAsyncGeneratorMiddlewareStage<TValue, TSignals> =>
  async function* (value, context) {
    return yield* invokeWithContext(stage, value, context)
  }

/** Promotes a sync next-style stage through the canonical sync-to-generator violation guard. */
export const adaptSyncStageToAsyncGenerator = <
  TValue,
  TSignals extends IGeneratorMiddlewareSignals = typeof MiddlewarePipelineGeneratorSignals
>(
  stage: ISyncMiddlewareStage<TValue>,
  onViolation: IMiddlewarePipelineViolationHandler,
  signals: TSignals = MiddlewarePipelineGeneratorSignals as TSignals,
  nextPolicy: MiddlewarePipelineNext = MiddlewarePipelineNext.single
): IAsyncGeneratorMiddlewareStage<TValue, TSignals> =>
  adaptGeneratorStageToAsyncGenerator(
    adaptSyncStageToGenerator(stage, onViolation, signals, nextPolicy)
  )

/** Runs a synchronous stage sequence with one admitted signal and synchronous failure timing. */
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
export const runAsyncMiddleware = runAsyncPipeline

/** Reduces generator stages while cleaning up an iterator if cancellation interrupts a yield. */
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
