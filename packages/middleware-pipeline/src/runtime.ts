import { createMiddlewarePipelineExecutionError } from './errors.js'
import { MAX_NATIVE_RECURSION_DEPTH } from '@migaia/utils/function'
import { admitAbortSignal } from '@migaia/utils/promise'
import type { IAbortSignal } from '@migaia/utils/promise'
import {
  createMiddlewarePipelineAbortCleanupError,
  createMiddlewarePipelineAbortError,
  createMiddlewarePipelineInvalidOptionError
} from './signal-errors.js'

/** Invokes a one-argument optional-context callback. */
function invokeWithContext<TFirst, TResult>(
  callback: (first: TFirst, context?: IMiddlewarePipelineContext) => TResult,
  args: readonly [TFirst],
  context: IMiddlewarePipelineContext | undefined
): TResult
/** Invokes a two-argument optional-context callback. */
function invokeWithContext<TFirst, TSecond, TResult>(
  callback: (first: TFirst, second: TSecond, context?: IMiddlewarePipelineContext) => TResult,
  args: readonly [TFirst, TSecond],
  context: IMiddlewarePipelineContext | undefined
): TResult
/** Implements both supported callback arities without reflective invocation. */
function invokeWithContext(
  callback: Function,
  args: readonly [unknown] | readonly [unknown, unknown],
  context: IMiddlewarePipelineContext | undefined
): unknown {
  if (args.length === 1) return context ? callback(args[0], context) : callback(args[0])
  return context ? callback(args[0], args[1], context) : callback(args[0], args[1])
}
import {
  GENERATOR_CONTINUE,
  GENERATOR_HALT,
  GENERATOR_UNDEFINED,
  MiddlewarePipelineGeneratorSignals,
  MiddlewarePipelineViolation,
  type IGeneratorMiddlewareSignals,
  type IMiddlewarePipelineViolationHandler
} from './state-constants.js'

export {
  GENERATOR_CONTINUE,
  GENERATOR_HALT,
  GENERATOR_UNDEFINED,
  MiddlewarePipelineGeneratorSignals,
  MiddlewarePipelineMode,
  MiddlewarePipelineViolation
} from './state-constants.js'
export type {
  IGeneratorMiddlewareSignals,
  IMiddlewarePipelineMode,
  IMiddlewarePipelineViolation,
  IMiddlewarePipelineViolationHandler
} from './state-constants.js'

/** Explicit generator result used when the payload itself may be undefined. */
export { MIDDLEWARE_PIPELINE_SOURCE, MiddlewarePipelineErrorCode } from './error-code.js'
export type { IMiddlewarePipelineErrorCode } from './error-code.js'

type IGeneratorUndefinedSignal<TValue> = undefined extends TValue
  ? typeof GENERATOR_UNDEFINED
  : never

/** Public compatibility name for utils-owned structural abort-signal admission. */
export type IMiddlewarePipelineAbortSignal = IAbortSignal
export type IMiddlewarePipelineContext = { readonly signal: IMiddlewarePipelineAbortSignal }
export type IMiddlewarePipelineControlOptions = {
  readonly signal?: IMiddlewarePipelineAbortSignal
}
export type ISyncMiddlewareStage<TValue> = (
  value: TValue,
  next: (value: TValue) => void,
  context?: IMiddlewarePipelineContext
) => void
export type IAsyncMiddlewareStage<TValue> = (
  value: TValue,
  next: (value: TValue) => Promise<void>,
  context?: IMiddlewarePipelineContext
) => void | Promise<void>
export type IGeneratorMiddlewareStage<TValue> = (
  value: TValue,
  context?: IMiddlewarePipelineContext
) => Generator<
  TValue,
  | TValue
  | IGeneratorUndefinedSignal<TValue>
  | typeof GENERATOR_HALT
  | typeof GENERATOR_CONTINUE
  | undefined,
  void
>
export type IAsyncGeneratorMiddlewareStage<TValue> = (
  value: TValue,
  context?: IMiddlewarePipelineContext
) => AsyncGenerator<
  TValue,
  | TValue
  | IGeneratorUndefinedSignal<TValue>
  | typeof GENERATOR_HALT
  | typeof GENERATOR_CONTINUE
  | undefined,
  void
>

export type IMiddlewarePipelineOptions = {
  readonly onViolation: IMiddlewarePipelineViolationHandler
  readonly assertActive?: () => void
  /** Host-owned error construction for the stage+downstream failure case. */
  readonly combineStageAndDownstreamError?: (stage: unknown, downstream: unknown) => unknown
  readonly signal?: IMiddlewarePipelineAbortSignal
}

/** One reusable next-call protocol shared by adapters and runners. */
const createNextGuard = <TValue, TResult>(
  onViolation: IMiddlewarePipelineViolationHandler,
  reject: () => TResult,
  accept: (value: TValue) => TResult
): Readonly<{
  readonly next: (value: TValue) => TResult
  readonly called: () => boolean
  readonly returned: () => void
}> => {
  let called = false
  let returned = false
  return Object.freeze({
    next: (value: TValue): TResult => {
      if (returned) {
        onViolation(MiddlewarePipelineViolation.late)
        return reject()
      }
      if (called) {
        onViolation(MiddlewarePipelineViolation.duplicate)
        return reject()
      }
      called = true
      return accept(value)
    },
    called: () => called,
    returned: () => {
      returned = true
    }
  })
}

const invalidSignal = (cause?: unknown): TypeError =>
  createMiddlewarePipelineInvalidOptionError(cause)
const makeAbortError = (reason: unknown): Error => createMiddlewarePipelineAbortError(reason)
const readControlSignal = (
  control: IMiddlewarePipelineControlOptions | null | undefined
): IMiddlewarePipelineAbortSignal | undefined => {
  if (control === undefined) return undefined
  if (
    control === null ||
    (typeof control !== 'object' && typeof control !== 'function') ||
    Array.isArray(control)
  )
    throw invalidSignal()
  return control.signal
}
const readAsyncSignal = (
  options: IMiddlewarePipelineOptions | null | undefined
): IMiddlewarePipelineAbortSignal | undefined => {
  if (options === null || options === undefined) throw invalidSignal()
  if ((typeof options !== 'object' && typeof options !== 'function') || Array.isArray(options))
    throw invalidSignal()
  return options.signal
}
const admit = (
  signal: IMiddlewarePipelineAbortSignal | undefined
): IMiddlewarePipelineContext | undefined => {
  if (signal === undefined) return undefined
  const admission = admitAbortSignal(signal)
  if (admission.kind === 'invalid') throw invalidSignal(admission.cause)
  if (admission.aborted) throw makeAbortError(signal.reason)
  return Object.freeze({ signal })
}
const check = (context: IMiddlewarePipelineContext | undefined): void => {
  if (context?.signal.aborted) throw makeAbortError(context.signal.reason)
}

type IAsyncControlPath = {
  /** Marks an entry or post-stage active guard as runner control flow rather than a stage failure. */
  hasActiveError: boolean
  /** Retains exact active guard value for control-path propagation. */
  activeError: unknown
}

type IGeneratorReduction<TValue> =
  | { readonly halted: true }
  | { readonly halted: false; readonly value: TValue }

type ISyncCleanupIterator = Generator<unknown, unknown, void>
type IAsyncCleanupIterator = AsyncGenerator<unknown, unknown, void>

/** Runs one abort cleanup protocol and preserves abort as primary failure. */
const cleanupSyncIterator = (iterator: ISyncCleanupIterator, abortFailure: unknown): never => {
  try {
    const returned = iterator.return(undefined)
    let step = returned
    while (!step.done) step = iterator.next()
  } catch (cleanupFailure) {
    throw createMiddlewarePipelineAbortCleanupError(abortFailure, cleanupFailure)
  }
  throw abortFailure
}

/** Runs one async abort cleanup protocol and preserves abort as primary failure. */
const cleanupAsyncIterator = async (
  iterator: IAsyncCleanupIterator,
  abortFailure: unknown
): Promise<never> => {
  try {
    let step = await iterator.return(undefined)
    while (!step.done) step = await iterator.next()
  } catch (cleanupFailure) {
    throw createMiddlewarePipelineAbortCleanupError(abortFailure, cleanupFailure)
  }
  throw abortFailure
}

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

/** Adapts a sync stage to async middleware while preserving next() violations. */
export const adaptSyncStageToAsync =
  <TValue>(
    stage: ISyncMiddlewareStage<TValue>,
    onViolation: IMiddlewarePipelineViolationHandler = () => {}
  ): IAsyncMiddlewareStage<TValue> =>
  async (value, next, context) => {
    let downstream: Promise<void> | undefined
    const guard = createNextGuard<TValue, void>(
      onViolation,
      () => undefined,
      (nextValue) => {
        downstream = next(nextValue)
      }
    )
    let stageError: unknown
    let hasStageError = false
    try {
      invokeWithContext(stage, [value, guard.next], context)
    } catch (error) {
      stageError = error
      hasStageError = true
    }
    guard.returned()
    let downstreamError: unknown
    let hasDownstreamError = false
    if (downstream) {
      try {
        await downstream
      } catch (error) {
        downstreamError = error
        hasDownstreamError = true
      }
    }
    // The runner owns stage+downstream composition. Standalone adapter calls preserve the
    // stage's identity while still observing downstream, preventing a second AggregateError from
    // entering the host combiner when this adapter is nested inside runAsyncMiddleware.
    if (hasStageError) throw stageError
    if (hasDownstreamError) throw downstreamError
  }

/** Adapts a sync stage to generator middleware while preserving next() violations. */
export const adaptSyncStageToGenerator = <TValue>(
  stage: ISyncMiddlewareStage<TValue>,
  onViolation: IMiddlewarePipelineViolationHandler
): IGeneratorMiddlewareStage<TValue> =>
  function* (value, context) {
    let nextValue = value
    const guard = createNextGuard<TValue, void>(
      onViolation,
      () => undefined,
      (candidate) => {
        nextValue = candidate
      }
    )
    invokeWithContext(stage, [value, guard.next], context)
    guard.returned()
    if (!guard.called()) return GENERATOR_HALT
    yield nextValue
    return GENERATOR_CONTINUE
  }

/** Promotes a synchronous generator by delegating its yields and terminal signal. */
export const adaptGeneratorStageToAsyncGenerator = <TValue>(
  stage: IGeneratorMiddlewareStage<TValue>
): IAsyncGeneratorMiddlewareStage<TValue> =>
  async function* (value, context) {
    return yield* invokeWithContext(stage, [value], context)
  }

/** Promotes a sync next-style stage through the canonical sync-to-generator violation guard. */
export const adaptSyncStageToAsyncGenerator = <TValue>(
  stage: ISyncMiddlewareStage<TValue>,
  onViolation: IMiddlewarePipelineViolationHandler
): IAsyncGeneratorMiddlewareStage<TValue> =>
  adaptGeneratorStageToAsyncGenerator(adaptSyncStageToGenerator(stage, onViolation))

export const runSyncMiddleware = <TValue>(
  stages: readonly ISyncMiddlewareStage<TValue>[],
  value: TValue,
  done: (value: TValue, context?: IMiddlewarePipelineContext) => void,
  onViolation: IMiddlewarePipelineViolationHandler,
  control?: IMiddlewarePipelineControlOptions,
  assertActive?: () => void
): void => {
  const context = admit(readControlSignal(control))
  assertActive?.()
  /** Caller-stage identity snapshot; dispatch never observes later list mutation. */
  const stageSnapshot = stages.slice()
  let current = value
  for (let index = 0; index < stageSnapshot.length; index += 1) {
    const stage = stageSnapshot[index]
    let nextValue = current
    const guard = createNextGuard<TValue, void>(
      onViolation,
      () => undefined,
      (valueAfter) => {
        nextValue = valueAfter
      }
    )
    check(context)
    invokeWithContext(stage, [current, guard.next], context)
    guard.returned()
    check(context)
    assertActive?.()
    if (!guard.called()) return
    current = nextValue
  }
  check(context)
  invokeWithContext(done, [current], context)
}

export const runAsyncMiddleware = async <TValue>(
  stages: readonly IAsyncMiddlewareStage<TValue>[],
  value: TValue,
  done: (value: TValue, context?: IMiddlewarePipelineContext) => void | Promise<void>,
  options: IMiddlewarePipelineOptions
): Promise<void> => {
  const context = admit(readAsyncSignal(options))
  /** Caller-stage identity snapshot; async dispatch never re-reads the mutable input list. */
  const stageSnapshot = stages.slice()
  let index = -1
  let completed = false
  /** Synchronous spill records used only after the native depth guard trips. */
  const spill: Array<{
    readonly value: TValue
    readonly parentControlPath: IAsyncControlPath
    readonly resolve: () => void
    readonly reject: (error: unknown) => void
  }> = []
  let nativeDepth = 0
  let drainingSpill = false
  let invokeStep!: (current: TValue, parentControlPath?: IAsyncControlPath) => Promise<void>
  /** Executes one stage and reports runner-owned active control to its parent. */
  const step = async (current: TValue, parentControlPath?: IAsyncControlPath): Promise<void> => {
    /** Records an exact entry or post-stage active guard failure on this frame's parent slot. */
    const markParentActiveError = (error: unknown): void => {
      if (!parentControlPath) return
      parentControlPath.hasActiveError = true
      parentControlPath.activeError = error
    }
    try {
      check(context)
      options.assertActive?.()
    } catch (error) {
      markParentActiveError(error)
      throw error
    }
    index += 1
    const stage = stageSnapshot[index]
    if (index >= stageSnapshot.length) {
      completed = true
      check(context)
      return invokeWithContext(done, [current], context)
    }
    let pending: Promise<void> | undefined
    /** Control metadata owned by this frame for its directly started downstream step. */
    const downstreamControlPath: IAsyncControlPath = {
      hasActiveError: false,
      activeError: undefined
    }
    /** Captured downstream rejection; observation starts before the stage settles. */
    let downstreamError: unknown
    let hasDownstreamError = false
    const guard = createNextGuard<TValue, Promise<void>>(
      options.onViolation,
      () => Promise.resolve(),
      (nextValue) => {
        /** Internal downstream Promise retained for independent failure observation. */
        const downstreamPromise = invokeStep(nextValue, downstreamControlPath)
        pending = downstreamPromise
        void downstreamPromise.then(undefined, (error) => {
          downstreamError = error
          hasDownstreamError = true
        })
        return downstreamPromise
      }
    )
    let stageError: unknown
    let hasStageError = false
    try {
      await invokeWithContext(stage, [current, guard.next], context)
    } catch (error) {
      stageError = error
      hasStageError = true
    }
    guard.returned()
    if (pending) {
      try {
        await pending
      } catch (error) {
        downstreamError = error
        hasDownstreamError = true
      }
    }
    if (downstreamControlPath.hasActiveError) {
      /** Exact runner-owned active guard value, kept separate from ordinary failures. */
      const activeError = downstreamControlPath.activeError
      if (hasStageError) {
        // A child control error is metadata only while it remains this frame's final error.
        // An independently thrown stage error must not taint the parent frame's control slot.
        if (stageError === activeError) markParentActiveError(activeError)
        throw stageError
      }
      markParentActiveError(activeError)
      throw activeError
    }
    if (hasStageError && hasDownstreamError) {
      if (context?.signal.aborted && stageError === downstreamError) throw downstreamError
      if (options.combineStageAndDownstreamError) {
        throw options.combineStageAndDownstreamError(stageError, downstreamError)
      }
      throw createMiddlewarePipelineExecutionError(stageError, downstreamError)
    }
    if (hasStageError) throw stageError
    if (hasDownstreamError) throw downstreamError
    if (!completed) {
      try {
        check(context)
        options.assertActive?.()
      } catch (error) {
        markParentActiveError(error)
        throw error
      }
    }
  }
  /** Drains deep requests without adding a microtask boundary to their stage entry. */
  const drainSpill = (): void => {
    if (drainingSpill) return
    drainingSpill = true
    while (spill.length > 0) {
      const request = spill.shift()!
      const result = step(request.value, request.parentControlPath)
      void result.then(request.resolve, request.reject)
    }
    drainingSpill = false
  }
  invokeStep = (current, parentControlPath) => {
    if (drainingSpill || nativeDepth >= MAX_NATIVE_RECURSION_DEPTH) {
      return new Promise<void>((resolve, reject) => {
        spill.push({
          value: current,
          parentControlPath: parentControlPath as IAsyncControlPath,
          resolve,
          reject
        })
        drainSpill()
      })
    }
    nativeDepth += 1
    try {
      return step(current, parentControlPath)
    } finally {
      nativeDepth -= 1
    }
  }
  await step(value)
}

export const runGeneratorMiddleware = <TValue>(
  stages: readonly IGeneratorMiddlewareStage<TValue>[],
  value: TValue,
  done: (value: TValue, context?: IMiddlewarePipelineContext) => void,
  signals: IGeneratorMiddlewareSignals = MiddlewarePipelineGeneratorSignals,
  control?: IMiddlewarePipelineControlOptions,
  assertActive?: () => void
): void => {
  const context = admit(readControlSignal(control))
  assertActive?.()
  /** Caller-stage identity snapshot; generator dispatch uses one fixed stage sequence. */
  const stageSnapshot = stages.slice()
  let current = value
  for (const stage of stageSnapshot) {
    check(context)
    const iterator = invokeWithContext(stage, [current], context)
    let last = current
    let step = iterator.next()
    while (!step.done) {
      try {
        check(context)
      } catch (abortFailure) {
        cleanupSyncIterator(iterator, abortFailure)
      }
      last = step.value
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
  invokeWithContext(done, [current], context)
}

/** Serially drains asynchronous generator stages and commits only each terminal transition. */
export const runAsyncGeneratorMiddleware = async <TValue>(
  stages: readonly IAsyncGeneratorMiddlewareStage<TValue>[],
  value: TValue,
  done: (value: TValue, context?: IMiddlewarePipelineContext) => void | Promise<void>,
  signals: IGeneratorMiddlewareSignals = MiddlewarePipelineGeneratorSignals,
  control?: IMiddlewarePipelineControlOptions,
  assertActive?: () => void
): Promise<void> => {
  const context = admit(readControlSignal(control))
  assertActive?.()
  /** Caller-stage identity snapshot; async iteration never re-reads the mutable input list. */
  const stageSnapshot = stages.slice()
  let current = value
  for (const stage of stageSnapshot) {
    /** Iterator is driven with its native receiver through direct method syntax. */
    check(context)
    const iterator = invokeWithContext(stage, [current], context)
    let last = current
    let step = await iterator.next()
    while (!step.done) {
      try {
        check(context)
      } catch (abortFailure) {
        await cleanupAsyncIterator(iterator, abortFailure)
      }
      last = step.value
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
  await invokeWithContext(done, [current], context)
}
