import type { IAbortSignal } from '@migaia/utils/promise'
import { tryReadProperty } from '@migaia/utils/error'
import { MiddlewarePipelineErrorText } from './error-text.js'
import {
  createMiddlewarePipelineInvalidOptionError,
  identifyMiddlewarePipelineFailure
} from './errors.js'
import {
  adaptGeneratorStageToAsyncGenerator,
  adaptSyncStageToAsync,
  adaptSyncStageToAsyncGenerator,
  adaptSyncStageToGenerator,
  runAsyncGeneratorMiddleware,
  runAsyncMiddleware,
  runGeneratorMiddleware,
  runSyncMiddleware,
  type IAsyncGeneratorMiddlewareStage,
  type IAsyncMiddlewareStage,
  type IGeneratorMiddlewareStage,
  type IMiddlewarePipelineContext,
  type IMiddlewarePipelineOptions,
  type IMiddlewarePipelineControlOptions,
  type ISyncMiddlewareStage
} from './runtime.js'
import {
  MiddlewarePipelineGeneratorSignals,
  MiddlewarePipelineMode,
  type IGeneratorMiddlewareSignals,
  type IMiddlewarePipelineMode,
  type IMiddlewarePipelineViolationHandler,
  type IMiddlewarePipelineViolation
} from './state-constants.js'

/**
 * Stage shape for the selected mode. Sync/async stages receive a next callback; generator stages
 * yield candidates and return a terminal value or control signal. Custom TSignals remain separate
 * from TValue so control symbols do not widen the payload type.
 */
export type IMiddlewarePipelineStage<
  TMode extends IMiddlewarePipelineMode,
  TValue,
  TSignals extends IGeneratorMiddlewareSignals = typeof MiddlewarePipelineGeneratorSignals
> = {
  readonly sync: ISyncMiddlewareStage<TValue>
  readonly async: IAsyncMiddlewareStage<TValue>
  readonly generator: IGeneratorMiddlewareStage<TValue, TSignals>
  readonly 'async-generator': IAsyncGeneratorMiddlewareStage<TValue, TSignals>
}[TMode]

/** Modes whose execution completes before `run` returns. */
export type IMiddlewarePipelineSyncMode =
  | typeof MiddlewarePipelineMode.sync
  | typeof MiddlewarePipelineMode.generator

/**
 * Receives the final value only when every stage continues; an empty stage list also calls done.
 * Sync/generator callbacks finish synchronously. Async modes await the returned promise. The
 * optional context is supplied only when this run has an effective abort signal.
 */
export type IMiddlewarePipelineDone<
  TMode extends IMiddlewarePipelineMode,
  TValue
> = TMode extends IMiddlewarePipelineSyncMode
  ? (value: TValue, context?: IMiddlewarePipelineContext) => void
  : (value: TValue, context?: IMiddlewarePipelineContext) => void | Promise<void>

/**
 * Run returns void for sync/generator and Promise<void> for async/async-generator. Final payloads
 * go to done, not this return value; failure throws or rejects according to mode.
 */
export type IMiddlewarePipelineRunResult<TMode extends IMiddlewarePipelineMode> =
  TMode extends IMiddlewarePipelineSyncMode ? void : Promise<void>

/**
 * Allowed lift sources: sync accepts sync; async accepts sync/async; generator accepts
 * sync/generator; async-generator accepts sync/generator/async-generator. Other directions would
 * lose semantics.
 */
export type IMiddlewarePipelineLiftSource<TMode extends IMiddlewarePipelineMode> = {
  readonly sync: 'sync'
  readonly async: 'sync' | 'async'
  readonly generator: 'sync' | 'generator'
  readonly 'async-generator': 'sync' | 'generator' | 'async-generator'
}[TMode]

/**
 * Construction options captured once for a reusable runner. mode is required; every other field is
 * optional. Malformed modes, callbacks, or generator signals throw INVALID_OPTION at construction.
 * Signal structure is admitted when run starts, within that mode's synchronous or async boundary.
 */
export type ICreatePipelineOptions<TMode extends IMiddlewarePipelineMode> = Readonly<{
  /**
   * Required execution mode: sync, async, generator, or async-generator. Determines stage shape,
   * downstream timing, and whether run throws synchronously or returns a promise.
   */
  readonly mode: TMode
  /**
   * Optional duplicate/late next reporter; defaults to a no-op. A rejected next never starts
   * downstream again.
   */
  readonly onViolation?: IMiddlewarePipelineViolationHandler
  /**
   * Optional host lifetime assertion at entry and after successful stages. Async onion frames also
   * check while returning, even after done ran; a later failure does not undo completed side
   * effects.
   */
  readonly assertActive?: () => void
  /**
   * Optional default cooperative signal. A supplied run-level signal overrides it; none is created
   * by default.
   */
  readonly signal?: IAbortSignal
  /**
   * Optional generator control symbols; defaults to MiddlewarePipelineGeneratorSignals.
   * undefined/halt/continue must be distinct symbols, read once and snapshotted at construction.
   */
  readonly signals?: IGeneratorMiddlewareSignals
  /**
   * Optional async-onion dual-failure policy, called with stage failure first and downstream
   * second. Without it, independent failures become EXECUTION_FAILED with both on
   * AggregateError.errors. A returned custom error must retain both originals through cause/errors;
   * a thrown combiner failure keeps the preexisting failures reachable. The same propagated object
   * is not combined twice.
   */
  readonly combineStageAndDownstreamError?: (stage: unknown, downstream: unknown) => unknown
}>

/**
 * Immutable runner whose mode and configuration are reusable across independent run calls. It owns
 * no host lifecycle, controller, event history, or shared mutable execution state.
 */
export type IMiddlewarePipeline<
  TMode extends IMiddlewarePipelineMode,
  TValue,
  TSignals extends IGeneratorMiddlewareSignals = typeof MiddlewarePipelineGeneratorSignals
> = Readonly<{
  /** Fixed construction mode; changing caller-owned options does not change it. */
  readonly mode: TMode
  /**
   * Adapts an allowed source stage to this runner's mode. Same-mode lifting returns the same
   * function; unsupported directions throw INVALID_OPTION. Lifted sync stages keep next as a local
   * value submission, so code after next still runs before downstream and a throw prevents
   * downstream entry.
   */
  lift<TFrom extends IMiddlewarePipelineLiftSource<TMode>>(
    stage: IMiddlewarePipelineStage<TFrom, TValue, TSignals>,
    from: TFrom
  ): IMiddlewarePipelineStage<TMode, TValue, TSignals>
  /**
   * Runs a snapshot of stages from value, calling done only if the sequence continues to the end.
   * control.signal optionally overrides the construction signal. An effective signal is supplied to
   * callbacks as context; cancellation is cooperative and never detaches already-started work.
   * Sync/generator failures throw; async modes reject after their started work settles. Original
   * failures retain identity where attachable, otherwise remain reachable through the error chain.
   */
  run(
    stages: readonly IMiddlewarePipelineStage<TMode, TValue, TSignals>[],
    value: TValue,
    done: IMiddlewarePipelineDone<TMode, TValue>,
    control?: IMiddlewarePipelineControlOptions
  ): IMiddlewarePipelineRunResult<TMode>
}>

/** Frozen internal options consumed by mode dispatch. */
type INormalizedPipelineOptions = Readonly<
  IMiddlewarePipelineOptions & {
    readonly mode: IMiddlewarePipelineMode
    readonly signals: IGeneratorMiddlewareSignals
  }
>

/** Stable no-op violation sink used when a host omits reporting. */
const ignoreViolation: IMiddlewarePipelineViolationHandler = () => undefined

/** Admits only ordinary option records at construction and run boundaries. */
const isOptionRecord = (value: unknown): value is object =>
  value !== null && !Array.isArray(value) && typeof value === 'object'

/** Returns whether a runtime value belongs to the public mode domain. */
const isPipelineMode = (value: unknown): value is IMiddlewarePipelineMode =>
  value === MiddlewarePipelineMode.sync ||
  value === MiddlewarePipelineMode.async ||
  value === MiddlewarePipelineMode.generator ||
  value === MiddlewarePipelineMode.asyncGenerator

/** Rejects one malformed optional callback before runner construction. */
const readCallback = <TCallback extends Function>(value: unknown): TCallback | undefined => {
  if (value === undefined) return undefined
  if (typeof value !== 'function')
    throw createMiddlewarePipelineInvalidOptionError(MiddlewarePipelineErrorText.invalidOption)
  return value as TCallback
}

/** Validates generator sentinel identities used by generator reductions. */
const readSignals = (value: unknown): IGeneratorMiddlewareSignals => {
  if (value === undefined) return MiddlewarePipelineGeneratorSignals
  if (value === null || typeof value !== 'object')
    throw createMiddlewarePipelineInvalidOptionError(MiddlewarePipelineErrorText.invalidOption)
  /** Only the three named properties are admitted from the caller's structural record. */
  const candidate = value as Record<string, unknown>
  /** Read each caller-owned getter exactly once before committing the immutable sentinel set. */
  const reads = ['undefined', 'halt', 'continue'].map((key) => tryReadProperty(candidate, key))
  for (const read of reads) {
    if (read.threw)
      throw createMiddlewarePipelineInvalidOptionError(MiddlewarePipelineErrorText.invalidOption, {
        cause: read.error
      })
  }
  /** Local values cannot change after construction even if the caller mutates its options. */
  const [undefinedSignal, halt, continueSignal] = reads.map((read) =>
    read.threw ? undefined : read.value
  )
  if (
    typeof undefinedSignal !== 'symbol' ||
    typeof halt !== 'symbol' ||
    typeof continueSignal !== 'symbol' ||
    undefinedSignal === halt ||
    undefinedSignal === continueSignal ||
    halt === continueSignal
  )
    throw createMiddlewarePipelineInvalidOptionError(MiddlewarePipelineErrorText.invalidOption)
  return Object.freeze({ undefined: undefinedSignal, halt, continue: continueSignal })
}

/** Reads one supported public option once and preserves a hostile getter as INVALID_OPTION cause. */
const readOption = (candidate: object, key: string): unknown => {
  /** Structural option reads belong to admission, never to a later runner transition. */
  const read = tryReadProperty(candidate as Record<string, unknown>, key)
  if (read.threw)
    throw createMiddlewarePipelineInvalidOptionError(MiddlewarePipelineErrorText.invalidOption, {
      cause: read.error
    })
  return read.value
}

/** Validates and freezes construction options before any mode-specific work begins. */
const readPipelineOptions = (options: unknown): INormalizedPipelineOptions => {
  if (!isOptionRecord(options))
    throw createMiddlewarePipelineInvalidOptionError(MiddlewarePipelineErrorText.invalidOptions)
  /** Unknown input narrowed only after object admission. */
  const candidate = options as Record<string, unknown>
  /** Mode is both validated and published from this one captured value. */
  const mode = readOption(candidate, 'mode')
  if (!isPipelineMode(mode))
    throw createMiddlewarePipelineInvalidOptionError(MiddlewarePipelineErrorText.invalidMode)
  /** Captured next callbacks can report after run returns, so this callback owns its boundary. */
  const onViolation = readCallback<IMiddlewarePipelineViolationHandler>(
    readOption(candidate, 'onViolation')
  )
  return Object.freeze({
    mode,
    onViolation:
      onViolation === undefined
        ? ignoreViolation
        : (kind: IMiddlewarePipelineViolation): void => {
            try {
              onViolation(kind)
            } catch (error) {
              throw identifyMiddlewarePipelineFailure(error)
            }
          },
    assertActive: readCallback<() => void>(readOption(candidate, 'assertActive')),
    signal: readOption(candidate, 'signal') as IAbortSignal | undefined,
    signals: readSignals(readOption(candidate, 'signals')),
    combineStageAndDownstreamError: readCallback<(stage: unknown, downstream: unknown) => unknown>(
      readOption(candidate, 'combineStageAndDownstreamError')
    )
  })
}

/** Selects a call-time signal before the construction-time default. */
const selectSignal = (
  options: INormalizedPipelineOptions,
  control: unknown
): IAbortSignal | undefined => {
  if (control === undefined) return options.signal
  if (!isOptionRecord(control))
    throw createMiddlewarePipelineInvalidOptionError(MiddlewarePipelineErrorText.invalidOption)
  /** Call-time signal wins when supplied; creation signal remains the fallback. */
  return (readOption(control, 'signal') as IAbortSignal | undefined) ?? options.signal
}

/** Promotes one stage through the canonical existing adapter matrix. */
const liftStage = (
  target: IMiddlewarePipelineMode,
  from: IMiddlewarePipelineMode,
  stage: unknown,
  onViolation: IMiddlewarePipelineViolationHandler,
  signals: IGeneratorMiddlewareSignals
): unknown => {
  if (target === from) return stage
  if (target === MiddlewarePipelineMode.async && from === MiddlewarePipelineMode.sync)
    return adaptSyncStageToAsync(stage as ISyncMiddlewareStage<unknown>, onViolation)
  if (target === MiddlewarePipelineMode.generator && from === MiddlewarePipelineMode.sync)
    return adaptSyncStageToGenerator(stage as ISyncMiddlewareStage<unknown>, onViolation, signals)
  if (target === MiddlewarePipelineMode.asyncGenerator) {
    if (from === MiddlewarePipelineMode.sync)
      return adaptSyncStageToAsyncGenerator(
        stage as ISyncMiddlewareStage<unknown>,
        onViolation,
        signals
      )
    if (from === MiddlewarePipelineMode.generator)
      return adaptGeneratorStageToAsyncGenerator(stage as IGeneratorMiddlewareStage<unknown>)
  }
  throw createMiddlewarePipelineInvalidOptionError(MiddlewarePipelineErrorText.unsupportedLift)
}

/** Dispatches one run while preserving each existing runner's return semantics. */
const runForMode = (
  mode: IMiddlewarePipelineMode,
  options: INormalizedPipelineOptions,
  stages: readonly unknown[],
  value: unknown,
  done: unknown,
  control: IMiddlewarePipelineControlOptions | undefined
): void | Promise<void> => {
  if (mode === MiddlewarePipelineMode.sync) {
    /** Sync mode keeps malformed control failures synchronous. */
    const signal = selectSignal(options, control)
    return runSyncMiddleware(
      stages as readonly ISyncMiddlewareStage<unknown>[],
      value,
      done as (value: unknown, context?: IMiddlewarePipelineContext) => void,
      options.onViolation,
      signal,
      options.assertActive
    )
  }
  if (mode === MiddlewarePipelineMode.async) {
    /** Async mode converts malformed control admission into a rejected Promise. */
    let signal: IAbortSignal | undefined
    try {
      signal = selectSignal(options, control)
    } catch (error) {
      return Promise.reject(error)
    }
    return runAsyncMiddleware(
      stages as readonly IAsyncMiddlewareStage<unknown>[],
      value,
      done as (value: unknown, context?: IMiddlewarePipelineContext) => void | Promise<void>,
      {
        onViolation: options.onViolation,
        assertActive: options.assertActive,
        combineStageAndDownstreamError: options.combineStageAndDownstreamError,
        signal
      }
    )
  }
  if (mode === MiddlewarePipelineMode.generator) {
    /** Generator mode keeps malformed control failures synchronous. */
    const signal = selectSignal(options, control)
    return runGeneratorMiddleware(
      stages as readonly IGeneratorMiddlewareStage<unknown>[],
      value,
      done as (value: unknown, context?: IMiddlewarePipelineContext) => void,
      options.signals,
      signal,
      options.assertActive
    )
  }
  try {
    /** Async-generator mode converts malformed control admission into a rejected Promise. */
    const signal = selectSignal(options, control)
    return runAsyncGeneratorMiddleware(
      stages as readonly IAsyncGeneratorMiddlewareStage<unknown>[],
      value,
      done as (value: unknown, context?: IMiddlewarePipelineContext) => void | Promise<void>,
      options.signals,
      signal,
      options.assertActive
    )
  } catch (error) {
    return Promise.reject(error)
  }
}

/**
 * Creates an immutable, reusable middleware runner with an explicitly selected execution mode. Use
 * sync for linear value submission, async for awaitable onion-style before/after work, and
 * generator modes when a stage chooses continuation from its final return or last yielded value.
 * Each run snapshots its stage sequence and owns its own execution state.
 *
 * Mode is required. Violation reporting defaults to a no-op; assertions, a default signal, and an
 * error combiner are absent unless supplied. Generator controls default to the exported symbol set.
 * Options and custom signals are read once. Invalid options throw TypeError/INVALID_OPTION during
 * construction. run later throws synchronously in sync/generator modes or rejects in async modes.
 * Final values are delivered through done, not as the return value of run.
 */
export function createPipeline<TValue>(
  options: ICreatePipelineOptions<typeof MiddlewarePipelineMode.sync>
): IMiddlewarePipeline<typeof MiddlewarePipelineMode.sync, TValue>
/** Creates a stateless async pipeline with a value type chosen by its caller. */
export function createPipeline<TValue>(
  options: ICreatePipelineOptions<typeof MiddlewarePipelineMode.async>
): IMiddlewarePipeline<typeof MiddlewarePipelineMode.async, TValue>
/** Creates a generator runner whose control symbols belong to the explicitly supplied set. */
export function createPipeline<TValue>(
  options: ICreatePipelineOptions<typeof MiddlewarePipelineMode.generator> & {
    readonly signals: IGeneratorMiddlewareSignals
  }
): IMiddlewarePipeline<typeof MiddlewarePipelineMode.generator, TValue, IGeneratorMiddlewareSignals>
/** Creates an async-generator runner whose control symbols belong to the explicitly supplied set. */
export function createPipeline<TValue>(
  options: ICreatePipelineOptions<typeof MiddlewarePipelineMode.asyncGenerator> & {
    readonly signals: IGeneratorMiddlewareSignals
  }
): IMiddlewarePipeline<
  typeof MiddlewarePipelineMode.asyncGenerator,
  TValue,
  IGeneratorMiddlewareSignals
>
/** Creates a stateless generator pipeline with a value type chosen by its caller. */
export function createPipeline<TValue>(
  options: ICreatePipelineOptions<typeof MiddlewarePipelineMode.generator> & {
    readonly signals?: undefined
  }
): IMiddlewarePipeline<typeof MiddlewarePipelineMode.generator, TValue>
/** Creates a stateless async-generator pipeline with a value type chosen by its caller. */
export function createPipeline<TValue>(
  options: ICreatePipelineOptions<typeof MiddlewarePipelineMode.asyncGenerator> & {
    readonly signals?: undefined
  }
): IMiddlewarePipeline<typeof MiddlewarePipelineMode.asyncGenerator, TValue>
/** Keeps a generic mode's explicitly supplied sentinel set separate from its payload type. */
export function createPipeline<TValue, const TMode extends IMiddlewarePipelineMode>(
  options: ICreatePipelineOptions<TMode> & { readonly signals: IGeneratorMiddlewareSignals }
): IMiddlewarePipeline<TMode, TValue, IGeneratorMiddlewareSignals>
/** Creates a stateless runner whose mode controls stage, terminal, lift, and result types. */
export function createPipeline<TValue, const TMode extends IMiddlewarePipelineMode>(
  options: ICreatePipelineOptions<TMode> & { readonly signals?: undefined }
): IMiddlewarePipeline<TMode, TValue>
/** Admits annotated generator options whose optional sentinel presence is known only at runtime. */
export function createPipeline<TValue>(
  options: ICreatePipelineOptions<typeof MiddlewarePipelineMode.generator>
): IMiddlewarePipeline<typeof MiddlewarePipelineMode.generator, TValue, IGeneratorMiddlewareSignals>
/** Admits annotated async-generator options without widening their payload type. */
export function createPipeline<TValue>(
  options: ICreatePipelineOptions<typeof MiddlewarePipelineMode.asyncGenerator>
): IMiddlewarePipeline<
  typeof MiddlewarePipelineMode.asyncGenerator,
  TValue,
  IGeneratorMiddlewareSignals
>
/** Admits a generic annotated mode whose optional sentinel set cannot be statically narrowed. */
export function createPipeline<TValue, const TMode extends IMiddlewarePipelineMode>(
  options: ICreatePipelineOptions<TMode>
): IMiddlewarePipeline<TMode, TValue, IGeneratorMiddlewareSignals>
/** Normalizes options once and exposes immutable mode dispatch. */
export function createPipeline(
  options: ICreatePipelineOptions<IMiddlewarePipelineMode>
): IMiddlewarePipeline<IMiddlewarePipelineMode, unknown, IGeneratorMiddlewareSignals> {
  /** Frozen construction state shared by each independent run. */
  const normalized = readPipelineOptions(options)
  return Object.freeze({
    mode: normalized.mode,
    lift: (stage: unknown, from: IMiddlewarePipelineMode): unknown => {
      if (!isPipelineMode(from))
        throw createMiddlewarePipelineInvalidOptionError(
          MiddlewarePipelineErrorText.unsupportedLift
        )
      return liftStage(normalized.mode, from, stage, normalized.onViolation, normalized.signals)
    },
    run: (
      stages: readonly unknown[],
      value: unknown,
      done: unknown,
      control?: IMiddlewarePipelineControlOptions
    ): void | Promise<void> => {
      try {
        /**
         * Existing mode runners own timing and execution; only their final failure crosses this
         * boundary.
         */
        const pending = runForMode(normalized.mode, normalized, stages, value, done, control)
        if (pending)
          return pending.catch((error: unknown) => {
            throw identifyMiddlewarePipelineFailure(error)
          })
      } catch (error) {
        throw identifyMiddlewarePipelineFailure(error)
      }
    }
  }) as IMiddlewarePipeline<IMiddlewarePipelineMode, unknown, IGeneratorMiddlewareSignals>
}
