import { MiddlewarePipelineErrorCode } from './error-code.ts'
import { MIDDLEWARE_PIPELINE_SOURCE } from './error-code.ts'
import { attachErrorIdentity } from '@migaia/utils/error'
import { admitPipelineNext } from './option-admission.ts'
/** Admits immutable pipeline options and exposes the public runner and canonical lift matrix. */
import type { IAbortSignal } from '@migaia/utils/promise'
import { tryReadProperty } from '@migaia/utils/error'
import { MiddlewarePipelineErrorText } from './error-text.ts'
import { identifyMiddlewarePipelineFailure } from './errors.ts'
import type {
  IAsyncGeneratorMiddlewareStage,
  IAsyncMiddlewareStage,
  IGeneratorMiddlewareStage,
  IMiddlewarePipelineContext,
  IMiddlewarePipelineOptions,
  IMiddlewarePipelineControlOptions,
  ISyncMiddlewareStage
} from './runtime-types.ts'
import {
  readPipelineMode,
  type IPipelineModeObject,
  type IPipelineModeImplementation
} from './mode-registry.ts'
import {
  MiddlewarePipelineGeneratorSignals,
  MiddlewarePipelineMode,
  MiddlewarePipelineNext,
  type IGeneratorMiddlewareSignals,
  type IMiddlewarePipelineMode,
  type IMiddlewarePipelineViolationHandler,
  type IMiddlewarePipelineViolation
} from './state-constants.ts'

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
  readonly mode: IPipelineModeObject<TMode>
  /** Number of values one active stage may submit; omitted preserves single semantics. */
  readonly next?: MiddlewarePipelineNext
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
export type INormalizedPipelineOptions = Readonly<
  IMiddlewarePipelineOptions & {
    readonly mode: IMiddlewarePipelineMode
    readonly signals: IGeneratorMiddlewareSignals
    readonly implementation: IPipelineModeImplementation
  }
>

/** Stable no-op violation sink used when a host omits reporting. */
const ignoreViolation: IMiddlewarePipelineViolationHandler = () => undefined

/**
 * Admits only ordinary option records at construction and run boundaries. A revoked Proxy makes
 * `Array.isArray` throw; that native TypeError leaves with the package INVALID_OPTION identity.
 */
const isOptionRecord = (value: unknown): value is object => {
  if (value === null || typeof value !== 'object') return false
  try {
    return !Array.isArray(value)
  } catch (error) {
    throw attachErrorIdentity(error as TypeError, {
      source: MIDDLEWARE_PIPELINE_SOURCE,
      code: MiddlewarePipelineErrorCode.invalidOption
    })
  }
}

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
    throw attachErrorIdentity(new TypeError(MiddlewarePipelineErrorText.invalidOption), {
      source: MIDDLEWARE_PIPELINE_SOURCE,
      code: MiddlewarePipelineErrorCode.invalidOption
    })
  return value as TCallback
}

/** Validates generator sentinel identities used by generator reductions. */
const readSignals = (value: unknown): IGeneratorMiddlewareSignals => {
  if (value === undefined) return MiddlewarePipelineGeneratorSignals
  if (value === null || typeof value !== 'object')
    throw attachErrorIdentity(new TypeError(MiddlewarePipelineErrorText.invalidOption), {
      source: MIDDLEWARE_PIPELINE_SOURCE,
      code: MiddlewarePipelineErrorCode.invalidOption
    })
  /** Only the three named properties are admitted from the caller's structural record. */
  const candidate = value as Record<string, unknown>
  /** Read each caller-owned getter exactly once before committing the immutable sentinel set. */
  const reads = ['undefined', 'halt', 'continue'].map((key) => tryReadProperty(candidate, key))
  for (const read of reads) {
    if (read.threw)
      throw attachErrorIdentity(
        new TypeError(MiddlewarePipelineErrorText.invalidOption, {
          cause: read.error
        }),
        { source: MIDDLEWARE_PIPELINE_SOURCE, code: MiddlewarePipelineErrorCode.invalidOption }
      )
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
    throw attachErrorIdentity(new TypeError(MiddlewarePipelineErrorText.invalidOption), {
      source: MIDDLEWARE_PIPELINE_SOURCE,
      code: MiddlewarePipelineErrorCode.invalidOption
    })
  return Object.freeze({ undefined: undefinedSignal, halt, continue: continueSignal })
}

/** Reads one supported public option once and preserves a hostile getter as INVALID_OPTION cause. */
const readOption = (candidate: object, key: string): unknown => {
  /** Structural option reads belong to admission, never to a later runner transition. */
  const read = tryReadProperty(candidate as Record<string, unknown>, key)
  if (read.threw)
    throw attachErrorIdentity(
      new TypeError(MiddlewarePipelineErrorText.invalidOption, {
        cause: read.error
      }),
      { source: MIDDLEWARE_PIPELINE_SOURCE, code: MiddlewarePipelineErrorCode.invalidOption }
    )
  return read.value
}

/** Validates and freezes construction options before any mode-specific work begins. */
const readPipelineOptions = (options: unknown): INormalizedPipelineOptions => {
  if (!isOptionRecord(options))
    throw attachErrorIdentity(new TypeError(MiddlewarePipelineErrorText.invalidOptions), {
      source: MIDDLEWARE_PIPELINE_SOURCE,
      code: MiddlewarePipelineErrorCode.invalidOption
    })
  /** Unknown input narrowed only after object admission. */
  const candidate = options as Record<string, unknown>
  /** Mode is both validated and published from this one captured value. */
  const implementation = readPipelineMode(readOption(candidate, 'mode'))
  if (!implementation)
    throw attachErrorIdentity(new TypeError(MiddlewarePipelineErrorText.invalidMode), {
      source: MIDDLEWARE_PIPELINE_SOURCE,
      code: MiddlewarePipelineErrorCode.invalidOption
    })
  /** Captured next callbacks can report after run returns, so this callback owns its boundary. */
  const onViolation = readCallback<IMiddlewarePipelineViolationHandler>(
    readOption(candidate, 'onViolation')
  )
  /** Capture and validate the policy once before creating any runner state. */
  const next = admitPipelineNext(readOption(candidate, 'next'))
  return Object.freeze({
    mode: implementation.key,
    implementation,
    next,
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
export const selectSignal = (
  options: INormalizedPipelineOptions,
  control: unknown
): IAbortSignal | undefined => {
  if (control === undefined) return options.signal
  if (!isOptionRecord(control))
    throw attachErrorIdentity(new TypeError(MiddlewarePipelineErrorText.invalidOption), {
      source: MIDDLEWARE_PIPELINE_SOURCE,
      code: MiddlewarePipelineErrorCode.invalidOption
    })
  /** Call-time signal wins when supplied; only omission (`undefined`) selects the creation signal. */
  const signal = readOption(control, 'signal')
  return signal === undefined ? options.signal : (signal as IAbortSignal)
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
/** Normalizes options once and returns an immutable, named runner owner. */
export function createPipeline(
  options: ICreatePipelineOptions<IMiddlewarePipelineMode>
): IMiddlewarePipeline<IMiddlewarePipelineMode, unknown, IGeneratorMiddlewareSignals> {
  return Object.freeze(
    new MiddlewarePipelineRuntime(readPipelineOptions(options))
  ) as IMiddlewarePipeline<IMiddlewarePipelineMode, unknown, IGeneratorMiddlewareSignals>
}

/** Holds immutable configuration while every execution owns its own mutable traversal state. */
class MiddlewarePipelineRuntime {
  /** Public mode remains a stable value after construction. */
  readonly mode: IMiddlewarePipelineMode
  /** Admitted immutable options are shared across independent executions. */
  readonly #options: INormalizedPipelineOptions

  /** Captures only admitted construction data; no execution state lives on the runner. */
  constructor(options: INormalizedPipelineOptions) {
    this.#options = options
    this.mode = options.mode
  }

  /** Uses the one canonical lift matrix with this pipeline's next policy. */
  readonly lift = (stage: unknown, from: IMiddlewarePipelineMode): unknown => {
    if (!isPipelineMode(from))
      throw attachErrorIdentity(new TypeError(MiddlewarePipelineErrorText.unsupportedLift), {
        source: MIDDLEWARE_PIPELINE_SOURCE,
        code: MiddlewarePipelineErrorCode.invalidOption
      })
    if (this.mode === from) return stage
    return this.#options.implementation.lift(from, stage, this.#options)
  }

  /** Preserves synchronous/async failure timing while adding package identity only at the boundary. */
  readonly run = (
    stages: readonly unknown[],
    value: unknown,
    done: unknown,
    control?: IMiddlewarePipelineControlOptions
  ): void | Promise<void> => {
    try {
      /** Dispatch selects the canonical mode runner without retaining per-run state here. */
      const pending = this.#options.implementation.run(this.#options, stages, value, done, control)
      if (pending)
        return pending.catch((error: unknown) => {
          throw identifyMiddlewarePipelineFailure(error)
        })
    } catch (error) {
      throw identifyMiddlewarePipelineFailure(error)
    }
  }
}
