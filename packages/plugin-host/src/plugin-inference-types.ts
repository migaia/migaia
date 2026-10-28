/**
 * Derives precise plugin, Feature and installed-tuple contracts from canonical definition types. It
 * contains no runtime policy.
 */
import type { IPluginConfig, IPluginLifecycleCore } from './plugin-lifecycle-types.js'
import type {
  IPluginHostRuntimeExtensions,
  IPlugin,
  IPluginConstraint,
  definedPluginBrand,
  IDefinedPluginConstraint
} from './plugin-definition-types.js'
import type {
  IFeatureOutput,
  IFeatureOutputs,
  IFeatureRecord,
  IFeatureRecordRequiredExpose
} from './feature-types.js'

/** Extracts one candidate's native Feature roots without widening a tuple element. */
type IPluginConstraintFeatures<TPlugin> =
  TPlugin extends IDefinedPluginConstraint<any, any, any, any, any, any, infer TFeatures, any, any>
    ? TFeatures
    : TPlugin extends { readonly features?: infer TFeatures extends IFeatureRecord }
      ? TFeatures
      : Record<never, never>

/** Extracts a candidate's expose value while preserving its concrete method surface. */
type IPluginConstraintExpose<TPlugin> = TPlugin extends {
  readonly featureExpose: infer TExpose
}
  ? TExpose extends (...args: never[]) => infer TFactoryExpose
    ? TFactoryExpose extends object
      ? TFactoryExpose
      : never
    : TExpose extends object
      ? TExpose
      : never
  : Record<never, never>

/** Declared feature names for one concrete plugin definition. */
export type IPluginFeatureName<TPlugin> = Extract<keyof IPluginConstraintFeatures<TPlugin>, string>

/** Output produced by one named feature in a concrete plugin definition. */
export type IPluginFeatureOutput<
  TPlugin,
  TName extends IPluginFeatureName<TPlugin>
> = IFeatureOutput<IPluginConstraintFeatures<TPlugin>[TName]>

/** Runtime adapters may narrow a candidate using only the already declared installed inventory. */
type IPluginRuntimeConstraint<TAvailable extends readonly IPluginConstraint<any>[], _TCandidate> =
  IPluginHostRuntimeExtensions<TAvailable, _TCandidate> extends {
    readonly __pluginConstraint?: infer C
  }
    ? C
    : unknown

/** Validate the original core/Feature contract and adapter type-only exposure at installation. */
export type IPluginConstraintTuple<
  TCore,
  TPlugins extends readonly IPluginConstraint<any>[],
  TInstalled extends readonly IPluginConstraint<any>[] = readonly []
> = {
  readonly [K in keyof TPlugins]: [TPlugins[K]] extends [never]
    ? IPluginConstraint<TCore>
    : IPluginConstraint<
        TCore,
        IPluginConstraintFeatures<TPlugins[K]>,
        IPluginConstraintExpose<TPlugins[K]>
      > &
        IPluginRuntimeConstraint<readonly [...TInstalled, ...TPlugins], TPlugins[K]> &
        (TPlugins[K] extends { readonly [definedPluginBrand]: { readonly core: infer TRequired } }
          ? TRequired extends Record<string, never>
            ? unknown
            : TCore extends TRequired
              ? unknown
              : never
          : unknown)
}

/** Rejects one install tuple when any literal plugin name appears more than once. */
export type IUniquePluginNames<
  TPlugins extends readonly unknown[],
  TSeen extends string = never
> = number extends TPlugins['length']
  ? TPlugins
  : TPlugins extends readonly [infer THead, ...infer TTail]
    ? [THead] extends [never]
      ? readonly [THead, ...IUniquePluginNames<TTail, TSeen>]
      : [THead] extends [{ readonly name: infer TName extends string }]
        ? string extends TName
          ? readonly [THead, ...IUniquePluginNames<TTail, TSeen>]
          : TName extends TSeen
            ? never
            : readonly [THead, ...IUniquePluginNames<TTail, TSeen | TName>]
        : never
    : readonly []

/** Feature fields injected into Plugin hooks from selected roots and one registration expose. */
export type IPluginFeatureCore<
  TFeatures extends IFeatureRecord,
  TExpose extends object & IFeatureRecordRequiredExpose<TFeatures>
> = Readonly<{
  /** Exact selected root outputs injected after Feature construction. */
  readonly features: IFeatureOutputs<TFeatures>
  /** Registration-owned guarded method facade available to Feature factories. */
  readonly featureExpose: TExpose
}>

/** Definition-time Feature options shared by functional and object Plugin declarations. */
export type IPluginFeatureOptions<
  TCore extends object,
  TConfig extends IPluginConfig,
  TFeatures extends IFeatureRecord,
  TExpose extends object & IFeatureRecordRequiredExpose<TFeatures>
> = Readonly<{
  /** Optional trusted roots; omitted means no selected Features. */
  readonly features?: TFeatures
  /** Explicit expose methods or a synchronous factory; omitted means an empty method surface. */
  readonly featureExpose?: TExpose | ((core: TCore & IPluginLifecycleCore<TConfig>) => TExpose)
}>

/** Extracts one plugin's declared extension surface; it does not instantiate or read a registration. */
export type IExtractPluginExt<TPlugin> =
  TPlugin extends IPlugin<
    infer _TCore,
    infer TExt,
    infer _TConfig,
    infer _TShared,
    infer _TFeatures extends IFeatureRecord,
    infer _TExpose extends object,
    any
  >
    ? TExt
    : Record<string, never>

/** Extracts declared configuration, falling back to the general config record when unspecified. */
export type IExtractPluginConfig<TPlugin> = TPlugin extends { readonly config?: infer TConfig }
  ? TConfig extends IPluginConfig
    ? TConfig
    : IPluginConfig
  : IPluginConfig

/** Removes every plugin with one name from a compile-time installed tuple. */
export type IExcludePluginByName<
  TPlugins extends readonly IPluginConstraint<any>[],
  TName extends string
> = TPlugins extends readonly [infer THead, ...infer TTail]
  ? TTail extends readonly IPluginConstraint<any>[]
    ? THead extends { readonly name: TName }
      ? IExcludePluginByName<TTail, TName>
      : THead extends IPluginConstraint<any>
        ? readonly [THead, ...IExcludePluginByName<TTail, TName>]
        : IExcludePluginByName<TTail, TName>
    : readonly []
  : readonly []

/**
 * Intersects supplied extension surfaces without reconstructing their generic or overloaded
 * methods.
 */
type IUnionToIntersection<T> = (T extends unknown ? (value: T) => void : never) extends (
  value: infer I
) => void
  ? I
  : never

/** Combines the instance extensions supplied by a plugin group into an intersection. */
export type IMergePluginExts<TPlugins extends readonly unknown[]> = IUnionToIntersection<
  IExtractPluginExt<TPlugins[number]>
>
