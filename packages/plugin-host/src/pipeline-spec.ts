/** Owns immutable named-pipeline declarations and their payload/mode inference, not execution. */
import type {
  IMiddlewarePipelineMode,
  IMiddlewarePipelineStage,
  IAsyncMiddlewareStage,
  MiddlewarePipelineNext
} from '@migaia/middleware-pipeline'
import ERROR_TEXT, { tagPluginHostError } from './error-text.ts'
import { PluginHostErrorCode } from './error-code.ts'
import type { PipelineOrder } from './pipeline-constants.ts'

/** Declaration-only payload axis; no phantom property is created at runtime. */
declare const pipelinePayload: unique symbol

/** Optional construction settings read by the canonical Host runtime. */
export type IPipelineSpecOptions = Readonly<{
  /** Omission selects the synchronous runner. */
  mode?: IMiddlewarePipelineMode
  /** Omission preserves single-submission middleware semantics. */
  next?: MiddlewarePipelineNext
  /** Stage allocation order is used unless reverse is explicitly requested. */
  order?: PipelineOrder
}>

/** Frozen configuration carrying only a declaration-time payload and mode axis. */
export type IPipelineSpec<
  TPayload = unknown,
  TMode extends IMiddlewarePipelineMode = IMiddlewarePipelineMode
> = Readonly<
  Omit<IPipelineSpecOptions, 'mode'> & {
    /** Selected runner mode; absent configuration means sync. */
    mode?: TMode
    /** Type-only marker used to infer the payload without a parallel type table. */
    readonly [pipelinePayload]?: TPayload
  }
>

/** Construction-time named declarations; names become the public pipeline key union. */
export type IPipelineDefinitions = Readonly<
  Record<string, IPipelineSpec<any, IMiddlewarePipelineMode>>
>

/** Extracts the explicitly supplied payload while keeping runtime configuration minimal. */
export type IPipelinePayload<TSpec> =
  TSpec extends IPipelineSpec<infer TPayload, any> ? TPayload : never

/** A spec with omitted mode selects sync rather than widening to all runner modes. */
export type IPipelineMode<TSpec> = TSpec extends {
  readonly mode: infer TMode extends IMiddlewarePipelineMode
}
  ? TMode
  : TSpec extends IPipelineSpec<any, infer TMode>
    ? TMode
    : 'sync'

/** The canonical middleware package determines each named pipeline's accepted stage shape. */
export type IPipelineStage<TSpec> =
  IPipelineMode<TSpec> extends 'async'
    ? IAsyncMiddlewareStage<IPipelinePayload<TSpec>, unknown>
    : IMiddlewarePipelineStage<IPipelineMode<TSpec>, IPipelinePayload<TSpec>>

/** One exact stage occurrence; native cleanup and explicit removal share its disposer. */
export type IPipelineStageHandle = Readonly<{
  /** Removes this occurrence once; repeated calls have no effect. */
  remove(): void
}>

/** Exact payload equality prevents through from hiding a conversion stage. */
type IPipelineEqual<TLeft, TRight> =
  (<T>() => T extends TLeft ? 1 : 2) extends <T>() => T extends TRight ? 1 : 2
    ? (<T>() => T extends TRight ? 1 : 2) extends <T>() => T extends TLeft ? 1 : 2
      ? true
      : false
    : false

/** Through selects only compatible payloads; runtime owns mode and next-policy admission. */
type IPipelineThroughName<TSpec, TVisible extends IPipelineDefinitions> = {
  [K in keyof TVisible & string]: IPipelineEqual<
    IPipelinePayload<TSpec>,
    IPipelinePayload<TVisible[K]>
  > extends true
    ? K
    : never
}[keyof TVisible & string]

/** Registration authority supplied to an installing plugin; deliberately omits execution. */
export type IPipelineRegistration<
  TSpec,
  TVisible extends IPipelineDefinitions = Record<never, never>
> = Readonly<{
  /** Registers one stage owned by this exact install generation. */
  use(stage: IPipelineStage<TSpec>): IPipelineStageHandle
  /** Splices a visible pipeline at this occurrence using the same native stage lifetime. */
  through<TName extends IPipelineThroughName<TSpec, TVisible>>(name: TName): IPipelineStageHandle
}>

/** One inferred lookup surface is shared by plugin and Feature registration cores. */
export type IPipelineScope<TVisible extends IPipelineDefinitions> = Readonly<{
  /** Resolves only declared host, own short and dependency-qualified names. */
  pipeline<TName extends keyof TVisible & string>(
    name: TName
  ): IPipelineRegistration<TVisible[TName], TVisible>
}>

/** Mode-specific terminal result, including a possible halted traversal. */
export type IPipelineRunResult<TSpec, TResult> =
  IPipelineMode<TSpec> extends 'sync' | 'generator'
    ? TResult | undefined
    : Promise<Awaited<TResult> | undefined>

/** Owner authority executes or registers stages on one declared pipeline. */
export type IPipelineOwner<TSpec> = Pick<IPipelineRegistration<TSpec>, 'use'> &
  Readonly<{
    /** Delivers terminal values and returns the result appropriate to this pipeline's mode. */
    run<TResult>(
      value: IPipelinePayload<TSpec>,
      done: (value: IPipelinePayload<TSpec>) => TResult
    ): IPipelineRunResult<TSpec, TResult>
  }>

/** Authenticity is held weakly so discarded construction descriptions remain collectible. */
const pipelineSpecs = new WeakSet<object>()

/** Reads authentic declarations only; the Host owns value validation and coded errors. */
export const readPipelineSpec = (value: unknown): IPipelineSpecOptions | undefined =>
  value !== null && typeof value === 'object' && pipelineSpecs.has(value)
    ? (value as IPipelineSpecOptions)
    : undefined

/** Captures explicit payload first, then infers literal configuration without extra author typing. */
export const pipelineSpec =
  <TPayload>() =>
  <const TConfig extends IPipelineSpecOptions>(
    config: TConfig
  ): IPipelineSpec<
    TPayload,
    TConfig extends { readonly mode: infer TMode extends IMiddlewarePipelineMode } ? TMode : 'sync'
  > &
    TConfig => {
    if (config === null || typeof config !== 'object' || Array.isArray(config))
      throw tagPluginHostError(
        new TypeError(ERROR_TEXT.INVALID_PIPELINE_OPTION),
        PluginHostErrorCode.invalidPipelineOption
      )
    /** Copy configuration once; a caller getter failure keeps its exact original on cause. */
    let spec: Readonly<TConfig>
    try {
      spec = Object.freeze({ ...config })
    } catch (cause) {
      throw tagPluginHostError(
        new TypeError(ERROR_TEXT.INVALID_PIPELINE_OPTION, { cause }),
        PluginHostErrorCode.invalidPipelineOption
      )
    }
    pipelineSpecs.add(spec)
    return spec as IPipelineSpec<
      TPayload,
      TConfig extends { readonly mode: infer TMode extends IMiddlewarePipelineMode }
        ? TMode
        : 'sync'
    > &
      TConfig
  }
