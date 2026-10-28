/**
 * Defines plugin-facing core and pipeline type axes. It grants no Host mutation authority and
 * creates no runtime state.
 */
import type {
  IPluginAwaitable,
  IPluginResource,
  IPluginConfig,
  IPluginLifecycleConfig,
  IPluginOperationContext,
  IPluginRegistrationContext
} from './plugin-lifecycle-types.js'
import type { IFeatureRecord } from './feature-types.js'
import type {
  IPipelineDefinitions,
  IPipelineRegistration,
  IPipelineScope
} from './pipeline-spec.js'
import type {
  IAsyncGeneratorMiddlewareStage,
  IAsyncMiddlewareStage,
  IGeneratorMiddlewareStage,
  ISyncMiddlewareStage
} from '@migaia/middleware-pipeline'

/** Compile-time Host core identity; no property or capability is installed at runtime. */
export declare const pluginHostCoreTypes: unique symbol

/** Keeps the domain and pipeline axes explicit for both class and functional Host entries. */
export type IPluginHostCoreTypeInfo<
  TCore extends object,
  TValue,
  TPipelines extends IPipelineDefinitions = Record<never, never>
> = Readonly<{
  /** Declaration-only domain/pipeline axes; no corresponding runtime property is installed. */
  readonly [pluginHostCoreTypes]: Readonly<{
    /** Domain capabilities required by a plugin installed on this Host. */
    readonly core: TCore
    /** Payload accepted by this Host's middleware pipeline. */
    readonly value: TValue
    /** Named payload and mode axes are inferred from construction-time declarations. */
    readonly pipelines: TPipelines
  }>
}>

/** Canonical plugin-facing capability contract supplied by one concrete Host. */
export type IPluginHostCoreFor<THost extends IPluginHostCoreTypeInfo<any, any, any>> =
  THost[typeof pluginHostCoreTypes]['core'] &
    IPluginHostCore<
      THost[typeof pluginHostCoreTypes]['value'],
      Record<PropertyKey, unknown>,
      IPluginConfig,
      THost[typeof pluginHostCoreTypes]['pipelines']
    >

/** Functional installer signature carrying the Host pipeline payload axis. */
export type IPluginInstaller<
  TCore extends object,
  TExtension extends Record<string, unknown>,
  TValue = never,
  TConfig extends IPluginConfig = IPluginConfig,
  TPipelines extends IPipelineDefinitions = Record<never, never>
> = (
  core: TCore & IPluginHostCore<TValue, Record<PropertyKey, unknown>, TConfig, TPipelines>
) => IPluginAwaitable<TExtension>

/**
 * Interface semantics allow fluent capabilities to return polymorphic `this`.
 *
 * Common capabilities that PluginHost supplies to plugins and domain hosts. Intersect domain fields
 * with this interface to reuse resource cleanup, configuration, and pipeline contracts.
 */
export interface IPluginHostCore<
  TValue = never,
  _TLegacyShared extends object = Record<PropertyKey, unknown>,
  TConfig extends IPluginConfig = IPluginConfig,
  TPipelines extends IPipelineDefinitions = Record<never, never>
> {
  /** Registration-only authority for a name declared by this Host. */
  pipeline<TName extends keyof TPipelines & string>(
    name: TName
  ): IPipelineRegistration<TPipelines[TName], TPipelines>
  /** Reads this registration's current immutable config; no mutation capability is exposed here. */
  readonly config: IPluginLifecycleConfig<TConfig>
  /** Current operation signal/deadline, separate from the registration lifetime. */
  readonly operation: IPluginOperationContext
  /** Registration lifetime signal, revoked when this generation is logically removed. */
  readonly lifecycle: IPluginRegistrationContext
  /** Owns a resource during install only; late calls reject without taking ownership of the input. */
  onDispose(resource: IPluginResource): void
  /** Adds an install-owned sync stage, lifted only when compatible with the Host runner. */
  usePipeline(stage: ISyncMiddlewareStage<TValue>): this
  /**
   * Adds an install-owned async stage; unsupported runner combinations throw
   * PIPELINE_MODE_MISMATCH.
   */
  useAsyncPipeline(stage: IAsyncMiddlewareStage<TValue>): this
  /** Adds an install-owned generator stage under the canonical middleware signal protocol. */
  useGeneratorPipeline(stage: IGeneratorMiddlewareStage<TValue>): this
  /** Adds an install-owned async-generator stage; later revocation removes it from new runs. */
  useAsyncGeneratorPipeline(stage: IAsyncGeneratorMiddlewareStage<TValue>): this
}

/** A plugin's own map and actual Feature references define its extra registration names. */
export type IPluginPipelineCore<
  TPipelines extends IPipelineDefinitions,
  TFeatures extends IFeatureRecord
> = IPipelineScope<TPipelines & import('./feature-types.js').IFeatureRecordPipelines<TFeatures>>
