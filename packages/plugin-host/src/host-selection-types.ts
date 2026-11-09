import type { IHostModule } from './module-runtime.ts'
import type {
  ICompleteHostHandle as IBaselineHostHandle,
  ICompleteDefineHostOptions as IBaselineDefineHostOptions
} from './define-host.ts'
import type {
  IAsyncGeneratorMiddlewareStage,
  IAsyncMiddlewareStage,
  IGeneratorMiddlewareStage,
  IMiddlewarePipelineLiftSource,
  IMiddlewarePipelineMode,
  ISyncMiddlewareStage
} from '@migaia/middleware-pipeline'
import type { IPluginConstraint } from './plugin-definition-types.ts'
import type { IPluginEnablement } from './plugin-handle-types.ts'
import type { IPluginHostOptions } from './host-options-types.ts'
import type { IPipelineDefinitions } from './pipeline-spec.ts'
/** Literal module values determine the public handle's optional capabilities. */
type IBuiltinHostModuleKey =
  (typeof import('./module-constants.ts').HostModuleKey)[keyof typeof import('./module-constants.ts').HostModuleKey]
/** Each installed identity contributes exactly its captured literal key. */
export type IHostModuleKeys<TModules extends readonly IHostModule[]> = TModules[number]['key']
/** Only genuinely installed pipeline module keys may select a default runner. */
export type IInstalledPipelineMode<TModules extends readonly IHostModule[]> =
  IHostModuleKeys<TModules> extends infer K
    ? K extends `pipeline:${infer M extends IMiddlewarePipelineMode}`
      ? M
      : never
    : never
/** Intersection preserves each independently installed built-in surface. */
type IUnionToIntersection<U> = (U extends unknown ? (value: U) => void : never) extends (
  value: infer I
) => void
  ? I
  : never

/** Baseline handle members that move to modules; everything else stays on the core handle. */
export type IModuleOwnedHandleKey =
  | 'plugin'
  | 'activate'
  | 'replace'
  | 'pipeline'
  | 'pipelineMode'
  | 'usePipeline'
  | 'useAsyncPipeline'
  | 'useGeneratorPipeline'
  | 'useAsyncGeneratorPipeline'
  | 'runPipeline'
  | 'runPipelineSync'
  | 'runPipelineAsync'

/**
 * Baseline handle with the same generics as today. Module members are picked from it with an empty
 * public surface, because the baseline Omit over TPublicSurface keys keeps its key set generic.
 */
type IBaseline<
  TDomainCore extends object,
  TValue,
  TInstalled extends readonly IPluginConstraint<any>[],
  TPublicSurface extends object,
  TPipelines extends IPipelineDefinitions
> = IBaselineHostHandle<TDomainCore, TValue, TInstalled, TPublicSurface, TPipelines>

/*
 * The pieces below are interfaces only because fluent members return the polymorphic `this`
 * (the whole intersected handle); TypeScript allows `this` types only in interfaces and classes.
 */

/** Enablement: baseline `plugin` object; its host type is the new handle via `this`. */
export interface IEnablementSurface<
  TDomainCore extends object,
  TValue,
  TInstalled extends readonly IPluginConstraint<any>[]
> {
  readonly plugin: IPluginEnablement<this, TInstalled, TDomainCore, TValue>
}
/** Default-pipeline members present once the host selected an installed mode. */
export interface IPipelineBaseSurface<TValue, TMode extends IMiddlewarePipelineMode> {
  readonly pipelineMode: TMode
  usePipeline(stage: ISyncMiddlewareStage<TValue>): this
}
/** Present when the selected mode accepts async stages. */
export interface IAsyncStageSurface<TValue> {
  useAsyncPipeline(stage: IAsyncMiddlewareStage<TValue>): this
}
/** Present when the selected mode accepts generator stages. */
export interface IGeneratorStageSurface<TValue> {
  useGeneratorPipeline(stage: IGeneratorMiddlewareStage<TValue>): this
}
/** Present when the selected mode accepts async-generator stages. */
export interface IAsyncGeneratorStageSurface<TValue> {
  useAsyncGeneratorPipeline(stage: IAsyncGeneratorMiddlewareStage<TValue>): this
}

/** Members each built-in module adds; non-fluent members are picked from the baseline handle. */
export type IBuiltinModuleSurfaces<
  TDomainCore extends object,
  TValue,
  TInstalled extends readonly IPluginConstraint<any>[],
  TPipelines extends IPipelineDefinitions,
  TMode extends IMiddlewarePipelineMode
> = {
  features: Readonly<Record<never, never>>
  'feature-dependencies': Pick<
    IBaseline<TDomainCore, TValue, TInstalled, Record<never, never>, TPipelines>,
    'replace'
  >
  enablement: IEnablementSurface<TDomainCore, TValue, TInstalled>
  activation: Pick<
    IBaseline<TDomainCore, TValue, TInstalled, Record<never, never>, TPipelines>,
    'activate'
  >
  'named-pipelines': Pick<
    IBaseline<TDomainCore, TValue, TInstalled, Record<never, never>, TPipelines>,
    'pipeline'
  >
  'pipeline:sync': [TMode] extends [never]
    ? Readonly<Record<never, never>>
    : Pick<
        IBaseline<TDomainCore, TValue, TInstalled, Record<never, never>, TPipelines>,
        'runPipelineSync'
      >
  'pipeline:async': [TMode] extends [never]
    ? Readonly<Record<never, never>>
    : Pick<
        IBaseline<TDomainCore, TValue, TInstalled, Record<never, never>, TPipelines>,
        'runPipelineAsync'
      >
  'pipeline:generator': Readonly<Record<never, never>>
  'pipeline:async-generator': Readonly<Record<never, never>>
}

/** Stage registration follows IMiddlewarePipelineLiftSource of the selected mode (root U10). */
export type IHostPipelineSurface<
  TDomainCore extends object,
  TValue,
  TMode extends IMiddlewarePipelineMode,
  TInstalled extends readonly IPluginConstraint<any>[],
  TPipelines extends IPipelineDefinitions
> = [TMode] extends [never]
  ? Readonly<Record<never, never>>
  : IPipelineBaseSurface<TValue, TMode> &
      Pick<
        IBaseline<TDomainCore, TValue, TInstalled, Record<never, never>, TPipelines>,
        'runPipeline'
      > &
      ('async' extends IMiddlewarePipelineLiftSource<TMode>
        ? IAsyncStageSurface<TValue>
        : Readonly<Record<never, never>>) &
      ('generator' extends IMiddlewarePipelineLiftSource<TMode>
        ? IGeneratorStageSurface<TValue>
        : Readonly<Record<never, never>>) &
      ('async-generator' extends IMiddlewarePipelineLiftSource<TMode>
        ? IAsyncGeneratorStageSurface<TValue>
        : Readonly<Record<never, never>>)

/*
 * No type-level module check on use/useSync: definePlugin's output type widens activation and the
 * lifecycle hooks, so field presence is not visible to the type system (probe-define-plugin.ts).
 * Missing modules are rejected at admission with HOST_MODULE_MISSING.
 * use and useSync therefore stay exactly the baseline members.
 */

/** Frozen handle: baseline minus moved keys, plus installed module and selected-mode members. */
export type IHostHandle<
  TDomainCore extends object,
  TValue,
  TModules extends readonly IHostModule[] = readonly [],
  TMode extends IInstalledPipelineMode<TModules> = never,
  TInstalled extends readonly IPluginConstraint<any>[] = readonly [],
  TPublicSurface extends object = Record<never, never>,
  TPipelines extends IPipelineDefinitions = Record<never, never>
> = Omit<
  IBaseline<TDomainCore, TValue, TInstalled, TPublicSurface, TPipelines>,
  IModuleOwnedHandleKey
> &
  IUnionToIntersection<
    | IBuiltinModuleSurfaces<TDomainCore, TValue, TInstalled, TPipelines, TMode>[Extract<
        IHostModuleKeys<TModules>,
        IBuiltinHostModuleKey
      >]
    | Readonly<Record<never, never>>
  > &
  IHostPipelineSurface<TDomainCore, TValue, TMode, TInstalled, TPipelines>

/**
 * Options: baseline options with `modules` added and `host.pipeline.mode` limited to installed
 * modes.
 */
export type IDefineHostOptions<
  TDomainCore extends object,
  TModules extends readonly IHostModule[],
  TMode extends IInstalledPipelineMode<TModules>,
  TPublicSurface extends object = Record<never, never>,
  TPipelines extends IPipelineDefinitions = Record<never, never>,
  TValue = never
> = Omit<IBaselineDefineHostOptions<TDomainCore, TPublicSurface, TPipelines, TValue>, 'host'> &
  Readonly<{
    /** Installed modules; omitted means none. */
    readonly modules?: TModules
    /** Baseline host options; only `pipeline.mode` is narrowed. */
    readonly host?: Omit<IPluginHostOptions<TPipelines>, 'pipeline'> & {
      pipeline?: Readonly<{
        /** Omitted: no default pipeline, and usePipeline throws PIPELINE_MODE_NOT_INSTALLED. */
        mode?: TMode
      }>
    }
  }>
