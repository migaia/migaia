import { attachErrorIdentity } from '@migaia/utils/error'
import { MIDDLEWARE_PIPELINE_SOURCE, MiddlewarePipelineErrorCode } from './error-code.js'
import { MiddlewarePipelineErrorText } from './error-text.js'
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
  type IMiddlewarePipelineAbortSignal,
  type IMiddlewarePipelineContext,
  type IMiddlewarePipelineControlOptions,
  type ISyncMiddlewareStage
} from './runtime.js'
import { MiddlewarePipelineSignalText } from './signal-text.js'
import {
  MiddlewarePipelineGeneratorSignals,
  MiddlewarePipelineMode,
  type IGeneratorMiddlewareSignals,
  type IMiddlewarePipelineMode,
  type IMiddlewarePipelineViolationHandler
} from './state-constants.js'

/** Stage selected by one concrete middleware mode. */
export type IMiddlewarePipelineStage<TMode extends IMiddlewarePipelineMode, TValue> = {
  readonly sync: ISyncMiddlewareStage<TValue>
  readonly async: IAsyncMiddlewareStage<TValue>
  readonly generator: IGeneratorMiddlewareStage<TValue>
  readonly 'async-generator': IAsyncGeneratorMiddlewareStage<TValue>
}[TMode]

/** Modes whose execution completes before `run` returns. */
export type IMiddlewarePipelineSyncMode =
  | typeof MiddlewarePipelineMode.sync
  | typeof MiddlewarePipelineMode.generator

/** Terminal callback selected by one concrete middleware mode. */
export type IMiddlewarePipelineDone<
  TMode extends IMiddlewarePipelineMode,
  TValue
> = TMode extends IMiddlewarePipelineSyncMode
  ? (value: TValue, context?: IMiddlewarePipelineContext) => void
  : (value: TValue, context?: IMiddlewarePipelineContext) => void | Promise<void>

/** Execution result selected by one concrete middleware mode. */
export type IMiddlewarePipelineRunResult<TMode extends IMiddlewarePipelineMode> =
  TMode extends IMiddlewarePipelineSyncMode ? void : Promise<void>

/** Source modes that can be lifted into one target middleware mode. */
export type IMiddlewarePipelineLiftSource<TMode extends IMiddlewarePipelineMode> = {
  readonly sync: 'sync'
  readonly async: 'sync' | 'async'
  readonly generator: 'sync' | 'generator'
  readonly 'async-generator': 'sync' | 'generator' | 'async-generator'
}[TMode]

/** Shared construction options for every middleware mode. */
export type ICreatePipelineOptions<TMode extends IMiddlewarePipelineMode> = Readonly<{
  readonly mode: TMode
  readonly onViolation?: IMiddlewarePipelineViolationHandler
  readonly assertActive?: () => void
  readonly signal?: IMiddlewarePipelineAbortSignal
  readonly signals?: IGeneratorMiddlewareSignals
  readonly combineStageAndDownstreamError?: (stage: unknown, downstream: unknown) => unknown
}>

/** Stateless runner returned by `createPipeline`. */
export type IMiddlewarePipeline<
  TMode extends IMiddlewarePipelineMode,
  TValue
> = Readonly<{
  readonly mode: TMode
  lift<TFrom extends IMiddlewarePipelineLiftSource<TMode>>(
    stage: IMiddlewarePipelineStage<TFrom, TValue>,
    from: TFrom
  ): IMiddlewarePipelineStage<TMode, TValue>
  run(
    stages: readonly IMiddlewarePipelineStage<TMode, TValue>[],
    value: TValue,
    done: IMiddlewarePipelineDone<TMode, TValue>,
    control?: IMiddlewarePipelineControlOptions
  ): IMiddlewarePipelineRunResult<TMode>
}>

/** Frozen internal options consumed by mode dispatch. */
type INormalizedPipelineOptions = Readonly<{
  readonly mode: IMiddlewarePipelineMode
  readonly onViolation: IMiddlewarePipelineViolationHandler
  readonly assertActive?: () => void
  readonly signal?: IMiddlewarePipelineAbortSignal
  readonly signals: IGeneratorMiddlewareSignals
  readonly combineStageAndDownstreamError?: (stage: unknown, downstream: unknown) => unknown
}>

/** Stable no-op violation sink used when a host omits reporting. */
const ignoreViolation: IMiddlewarePipelineViolationHandler = () => undefined

/** Creates a package-tagged invalid-option error without replacing native `TypeError`. */
const invalidOption = (message: string): TypeError =>
  attachErrorIdentity(new TypeError(message), {
    source: MIDDLEWARE_PIPELINE_SOURCE,
    code: MiddlewarePipelineErrorCode.invalidOption
  }) as TypeError

/** Returns whether a runtime value belongs to the public mode domain. */
const isPipelineMode = (value: unknown): value is IMiddlewarePipelineMode =>
  value === MiddlewarePipelineMode.sync ||
  value === MiddlewarePipelineMode.async ||
  value === MiddlewarePipelineMode.generator ||
  value === MiddlewarePipelineMode.asyncGenerator

/** Rejects one malformed optional callback before runner construction. */
const readCallback = <TCallback extends Function>(value: unknown): TCallback | undefined => {
  if (value === undefined) return undefined
  if (typeof value !== 'function') throw invalidOption(MiddlewarePipelineSignalText.invalidOption)
  return value as TCallback
}

/** Validates generator sentinel identities used by generator reductions. */
const readSignals = (value: unknown): IGeneratorMiddlewareSignals => {
  if (value === undefined) return MiddlewarePipelineGeneratorSignals
  if (
    value === null ||
    typeof value !== 'object' ||
    typeof (value as { readonly undefined?: unknown }).undefined !== 'symbol' ||
    typeof (value as { readonly halt?: unknown }).halt !== 'symbol' ||
    typeof (value as { readonly continue?: unknown }).continue !== 'symbol'
  )
    throw invalidOption(MiddlewarePipelineSignalText.invalidOption)
  return value as IGeneratorMiddlewareSignals
}

/** Validates and freezes construction options before any mode-specific work begins. */
const readPipelineOptions = (options: unknown): INormalizedPipelineOptions => {
  if (options === null || typeof options !== 'object' || Array.isArray(options))
    throw invalidOption(MiddlewarePipelineErrorText.invalidMode)
  /** Unknown input narrowed only after object admission. */
  const candidate = options as Record<string, unknown>
  if (!isPipelineMode(candidate.mode)) throw invalidOption(MiddlewarePipelineErrorText.invalidMode)
  return Object.freeze({
    mode: candidate.mode,
    onViolation:
      readCallback<IMiddlewarePipelineViolationHandler>(candidate.onViolation) ?? ignoreViolation,
    assertActive: readCallback<() => void>(candidate.assertActive),
    signal: candidate.signal as IMiddlewarePipelineAbortSignal | undefined,
    signals: readSignals(candidate.signals),
    combineStageAndDownstreamError: readCallback<
      (stage: unknown, downstream: unknown) => unknown
    >(candidate.combineStageAndDownstreamError)
  })
}

/** Selects a call-time signal before the construction-time default. */
const selectControl = (
  options: INormalizedPipelineOptions,
  control: IMiddlewarePipelineControlOptions | null | undefined
): IMiddlewarePipelineControlOptions | undefined => {
  if (control === null || typeof control !== 'object' || Array.isArray(control)) {
    if (control !== undefined) throw invalidOption(MiddlewarePipelineSignalText.invalidOption)
  }
  /** Call-time signal wins when supplied; creation signal remains the fallback. */
  const signal = control?.signal ?? options.signal
  return signal === undefined ? undefined : { signal }
}

/** Promotes one stage through the canonical existing adapter matrix. */
const liftStage = (
  target: IMiddlewarePipelineMode,
  from: IMiddlewarePipelineMode,
  stage: unknown,
  onViolation: IMiddlewarePipelineViolationHandler
): unknown => {
  if (target === from) return stage
  if (target === MiddlewarePipelineMode.async && from === MiddlewarePipelineMode.sync)
    return adaptSyncStageToAsync(stage as ISyncMiddlewareStage<unknown>, onViolation)
  if (target === MiddlewarePipelineMode.generator && from === MiddlewarePipelineMode.sync)
    return adaptSyncStageToGenerator(stage as ISyncMiddlewareStage<unknown>, onViolation)
  if (target === MiddlewarePipelineMode.asyncGenerator) {
    if (from === MiddlewarePipelineMode.sync)
      return adaptSyncStageToAsyncGenerator(stage as ISyncMiddlewareStage<unknown>, onViolation)
    if (from === MiddlewarePipelineMode.generator)
      return adaptGeneratorStageToAsyncGenerator(stage as IGeneratorMiddlewareStage<unknown>)
  }
  throw invalidOption(MiddlewarePipelineErrorText.unsupportedLift)
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
    const effectiveControl = selectControl(options, control)
    return runSyncMiddleware(
      stages as readonly ISyncMiddlewareStage<unknown>[],
      value,
      done as (value: unknown, context?: IMiddlewarePipelineContext) => void,
      options.onViolation,
      effectiveControl,
      options.assertActive
    )
  }
  if (mode === MiddlewarePipelineMode.async) {
    /** Async mode converts malformed control admission into a rejected Promise. */
    let effectiveControl: IMiddlewarePipelineControlOptions | undefined
    try {
      effectiveControl = selectControl(options, control)
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
        signal: effectiveControl?.signal
      }
    )
  }
  if (mode === MiddlewarePipelineMode.generator) {
    /** Generator mode keeps malformed control failures synchronous. */
    const effectiveControl = selectControl(options, control)
    return runGeneratorMiddleware(
      stages as readonly IGeneratorMiddlewareStage<unknown>[],
      value,
      done as (value: unknown, context?: IMiddlewarePipelineContext) => void,
      options.signals,
      effectiveControl,
      options.assertActive
    )
  }
  try {
    /** Async-generator mode converts malformed control admission into a rejected Promise. */
    const effectiveControl = selectControl(options, control)
    return runAsyncGeneratorMiddleware(
      stages as readonly IAsyncGeneratorMiddlewareStage<unknown>[],
      value,
      done as (value: unknown, context?: IMiddlewarePipelineContext) => void | Promise<void>,
      options.signals,
      effectiveControl,
      options.assertActive
    )
  } catch (error) {
    return Promise.reject(error)
  }
}

/** Creates a stateless sync pipeline with a value type chosen by its caller. */
export function createPipeline<TValue>(
  options: ICreatePipelineOptions<typeof MiddlewarePipelineMode.sync>
): IMiddlewarePipeline<typeof MiddlewarePipelineMode.sync, TValue>
/** Creates a stateless async pipeline with a value type chosen by its caller. */
export function createPipeline<TValue>(
  options: ICreatePipelineOptions<typeof MiddlewarePipelineMode.async>
): IMiddlewarePipeline<typeof MiddlewarePipelineMode.async, TValue>
/** Creates a stateless generator pipeline with a value type chosen by its caller. */
export function createPipeline<TValue>(
  options: ICreatePipelineOptions<typeof MiddlewarePipelineMode.generator>
): IMiddlewarePipeline<typeof MiddlewarePipelineMode.generator, TValue>
/** Creates a stateless async-generator pipeline with a value type chosen by its caller. */
export function createPipeline<TValue>(
  options: ICreatePipelineOptions<typeof MiddlewarePipelineMode.asyncGenerator>
): IMiddlewarePipeline<typeof MiddlewarePipelineMode.asyncGenerator, TValue>
/** Creates a stateless runner whose mode controls stage, terminal, lift, and result types. */
export function createPipeline<TValue, const TMode extends IMiddlewarePipelineMode>(
  options: ICreatePipelineOptions<TMode>
): IMiddlewarePipeline<TMode, TValue>
/** Normalizes options once and exposes immutable mode dispatch. */
export function createPipeline(
  options: ICreatePipelineOptions<IMiddlewarePipelineMode>
): IMiddlewarePipeline<IMiddlewarePipelineMode, unknown> {
  /** Frozen construction state shared by each independent run. */
  const normalized = readPipelineOptions(options)
  return Object.freeze({
    mode: normalized.mode,
    lift: (stage: unknown, from: IMiddlewarePipelineMode): unknown => {
      if (!isPipelineMode(from)) throw invalidOption(MiddlewarePipelineErrorText.unsupportedLift)
      return liftStage(normalized.mode, from, stage, normalized.onViolation)
    },
    run: (
      stages: readonly unknown[],
      value: unknown,
      done: unknown,
      control?: IMiddlewarePipelineControlOptions
    ): void | Promise<void> =>
      runForMode(normalized.mode, normalized, stages, value, done, control)
  }) as IMiddlewarePipeline<IMiddlewarePipelineMode, unknown>
}
