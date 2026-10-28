/**
 * Defines plugin declarations, captured hook shapes and trusted definition provenance. Runtime
 * admission remains in define-plugin and admission-runtime.
 */
import type {
  IPluginAwaitable,
  IPluginConfig,
  IReadonlyConfig,
  IPluginRegistrationContext,
  IPluginDisposalContext,
  IPluginBeforeReleaseContext,
  IPluginLifecycleCore,
  IPluginSetupContext,
  IPluginSetup
} from './plugin-lifecycle-types.js'
import type { asyncDisposeKey } from './symbols.js'
import type {
  IFeatureOutput,
  IFeatureReference,
  IFeatureOutputs,
  IFeatureRecord
} from './feature-types.js'
import type { IPipelineDefinitions } from './pipeline-spec.js'

/** Interface semantics are required only for adapter-owned module augmentation of Host outlets. */
export interface IPluginHostRuntimeExtensions<
  TInstalled extends readonly IPluginConstraint<any>[] = readonly [],
  _TCandidate = unknown
> {
  /** Type-only installed inventory; the canonical runtime state remains the authority. */
  readonly __installedPlugins?: TInstalled
}

/** Common plugin contract. Applications expose their domain capabilities through `TCore`. */
export type IPluginCommon<
  TCore,
  TConfig extends IPluginConfig,
  TFeatures extends IFeatureRecord,
  TExpose extends object
> = {
  /** Nonempty dot-free registration key, unique within one Host. */
  readonly name: string
  /** Own pipeline declarations are frozen with the trusted plugin definition. */
  readonly pipelines?: IPipelineDefinitions
  /** Optional initial configuration; omission supplies an empty owned snapshot. */
  readonly config?: TConfig
  /** Selected Feature roots; omission selects none, and local dependencies are constructed once. */
  readonly features?: TFeatures
  /** Defaults to eager installation; lazy reserves the registration until explicit activation. */
  readonly activation?: 'eager' | 'lazy'
  /** Validates the next owned config before commit; rejection keeps the previous snapshot. */
  update?: (
    next: IReadonlyConfig<TConfig>,
    core: IPluginHookCore<TCore, TConfig, TFeatures, TExpose>
  ) => IPluginAwaitable<void>
  /** Notification fired after installation and each later transition into the enabled state. */
  onEnable?: (context: IPluginRegistrationContext) => IPluginAwaitable<void>
  /** Notification fired after a transition into the disabled state; it owns no cleanup. */
  onDisable?: (context: IPluginRegistrationContext) => IPluginAwaitable<void>
  /**
   * Rebind notification for a replaced provider; absence or failure falls back to dependent
   * restart.
   */
  onDependencyReplaced?: (
    name: string,
    outputs: Readonly<Record<string, object>>
  ) => IPluginAwaitable<void>
  /** Plugin-first physical cleanup hook, followed by owned resources even if this hook fails. */
  dispose?: (context?: IPluginDisposalContext) => IPluginAwaitable<void>
  /** Runs while an installed registration still owns its leases and lifecycle signal. */
  beforeRelease?: (context: IPluginBeforeReleaseContext) => IPluginAwaitable<void>
  /** Async disposer fallback when no explicit dispose hook was declared; preferred over sync. */
  [asyncDisposeKey]?: () => IPluginAwaitable<void>
  /** Sync disposer fallback when neither explicit dispose nor async disposal is available. */
  [Symbol.dispose]?: () => void
}

/** Feature-ready core passed to install and update. */
export type IPluginHookCore<
  TCore,
  TConfig extends IPluginConfig,
  TFeatures extends IFeatureRecord,
  TExpose extends object
> = TCore &
  IPluginLifecycleCore<TConfig> &
  Readonly<{
    /** Named outputs built for the registration's selected root Features. */
    features: IFeatureOutputs<TFeatures>
    /** Explicit expose facade supplied to those factories. */
    featureExpose: TExpose
  }>

/** A definition without setup keeps exactly the original one-argument hook signatures. */
export type IPluginPlainHooks<
  TCore,
  TExt extends Record<string, unknown>,
  TConfig extends IPluginConfig,
  TFeatures extends IFeatureRecord,
  TExpose extends object
> = {
  /** Omission preserves the one-argument install/featureExpose signatures. */
  readonly setup?: undefined
  /** Explicit Feature method capabilities, captured per registration before factories run. */
  readonly featureExpose?: TExpose | ((core: TCore & IPluginLifecycleCore<TConfig>) => TExpose)
  /** Publishes enumerable own-data extensions after Feature construction; resources belong to core. */
  install: (core: IPluginHookCore<TCore, TConfig, TFeatures, TExpose>) => IPluginAwaitable<TExt>
}

/** A declared setup supplies its output only as the second argument to these hooks. */
export type IPluginSetupHooks<
  TCore,
  TExt extends Record<string, unknown>,
  TConfig extends IPluginConfig,
  TFeatures extends IFeatureRecord,
  TExpose extends object,
  TSetup
> = {
  /** Async-capable setup, completed before Feature construction and installation. */
  readonly setup: IPluginSetup<TConfig, TSetup>
  /** Expose object or factory receiving this attempt's exact setup output as its second argument. */
  readonly featureExpose?:
    | TExpose
    | ((core: TCore & IPluginLifecycleCore<TConfig>, setupOutput: NoInfer<TSetup>) => TExpose)
  /** Receives the same setup output by identity; failed installation rolls back setup resources. */
  install: (
    core: IPluginHookCore<TCore, TConfig, TFeatures, TExpose>,
    setupOutput: NoInfer<TSetup>
  ) => IPluginAwaitable<TExt>
}

/** Wildcard shape used only when extracting properties from either plugin variant. */
export type IPluginAnyHooks<
  TCore,
  TExt extends Record<string, unknown>,
  TConfig extends IPluginConfig,
  TFeatures extends IFeatureRecord,
  TExpose extends object
> = {
  /** Optional setup retained when a caller intentionally erases the concrete setup-output axis. */
  readonly setup?: IPluginSetup<TConfig, any>
  /** Registration-local Feature capability surface, optionally using the setup output. */
  readonly featureExpose?:
    | TExpose
    | ((core: TCore & IPluginLifecycleCore<TConfig>, setupOutput?: any) => TExpose)
  /** Async-capable installer; the second argument exists only for a declared setup. */
  install: (
    core: IPluginHookCore<TCore, TConfig, TFeatures, TExpose>,
    setupOutput?: any
  ) => IPluginAwaitable<TExt>
}

/** Selects plain, declared-setup, or wildcard hook shape from the setup axis. */
export type IPluginHooks<
  TCore,
  TExt extends Record<string, unknown>,
  TConfig extends IPluginConfig,
  TFeatures extends IFeatureRecord,
  TExpose extends object,
  TSetup
> = 0 extends 1 & TSetup
  ? IPluginAnyHooks<TCore, TExt, TConfig, TFeatures, TExpose>
  : [TSetup] extends [never]
    ? IPluginPlainHooks<TCore, TExt, TConfig, TFeatures, TExpose>
    : IPluginSetupHooks<TCore, TExt, TConfig, TFeatures, TExpose, TSetup>

/** Plugin contract; the seventh axis exists only for a declared setup output. */
export type IPlugin<
  TCore,
  TExt extends Record<string, unknown> = Record<string, never>,
  TConfig extends IPluginConfig = IPluginConfig,
  TShared extends object = Record<string, never>,
  TFeatures extends IFeatureRecord = Record<never, never>,
  TExpose extends object = Record<never, never>,
  TSetup = never
> = IPluginCommon<TCore, TConfig, TFeatures, TExpose> &
  IPluginHooks<TCore, TExt, TConfig, TFeatures, TExpose, TSetup> &
  (TShared extends object ? unknown : never)

/** Constrains a plugin tuple while preserving each plugin's precise generic arguments. */
export type IPluginConstraint<
  TCore,
  TFeatures extends IFeatureRecord = Record<never, never>,
  TExpose extends object = Record<never, never>
> = {
  /** Nonempty dot-free registration name used for routing and configuration paths. */
  readonly name: string
  /** Configuration input captured by canonical admission; omission means an empty config. */
  readonly config?: unknown
  /** Optional trusted Feature roots retained with their definition identities. */
  readonly features?: TFeatures
  /** Eager by default; lazy defers setup, Features and install until activation. */
  readonly activation?: 'eager' | 'lazy'
  /** Async-capable config validation hook; failed updates never commit their patch. */
  update?: (
    next: never,
    core: TCore &
      IPluginLifecycleCore<any> &
      Readonly<{ features: IFeatureOutputs<TFeatures>; featureExpose: TExpose }>
  ) => IPluginAwaitable<void>
  /** Notification after installation or reenablement; its failure is diagnostic, not rollback. */
  onEnable?: (context: IPluginRegistrationContext) => IPluginAwaitable<void>
  /** Notification after disabling; it does not own or release registration resources. */
  onDisable?: (context: IPluginRegistrationContext) => IPluginAwaitable<void>
  /** Optional provider rebind hook; absent or failed hooks select dependent restart. */
  onDependencyReplaced?: (
    name: string,
    outputs: Readonly<Record<string, object>>
  ) => IPluginAwaitable<void>
  /** Physical plugin cleanup before resources; errors are retained while remaining cleanup proceeds. */
  dispose?: (context?: IPluginDisposalContext) => IPluginAwaitable<void>
  /** Captured before the registration enters its bounded release step. */
  beforeRelease?: (context: IPluginBeforeReleaseContext) => IPluginAwaitable<void>
  /** Captured async fallback when no explicit dispose hook exists. */
  [asyncDisposeKey]?: () => IPluginAwaitable<void>
  /** Captured sync fallback after the explicit and async disposer choices. */
  [Symbol.dispose]?: () => void
} & (
  | IPluginPlainHooks<TCore, Record<string, unknown>, any, TFeatures, TExpose>
  | {
      /** Declared setup requires the asynchronous installation path unless registration stays lazy. */
      readonly setup: (context: IPluginSetupContext<any>) => unknown
      /** Expose input optionally derives from the exact setup output. */
      readonly featureExpose?:
        | TExpose
        | ((core: TCore & IPluginLifecycleCore<any>, setupOutput?: any) => TExpose)
      /** Install runs only after successful setup and Feature construction. */
      install: (
        core: IPluginHookCore<TCore, any, TFeatures, TExpose>,
        setupOutput?: any
      ) => IPluginAwaitable<Record<string, unknown>>
    }
)

/** Opaque compile-time provenance carried by definitions made through `definePlugin`. */
export declare const definedPluginBrand: unique symbol

/**
 * Preserves trusted definition provenance, exact names, Feature outputs and named pipeline
 * inference.
 */
export type IDefinedPluginConstraint<
  TCore extends object = object,
  TValue = never,
  TExtension extends Record<string, unknown> = Record<string, unknown>,
  TConfig extends IPluginConfig = IPluginConfig,
  TShared extends object = Record<string, never>,
  TName extends string = string,
  TFeatures extends IFeatureRecord = Record<never, never>,
  TExpose extends object = Record<never, never>,
  TSetup = never,
  TPipelines extends IPipelineDefinitions = Record<never, never>
> = IPlugin<any, TExtension, TConfig, TShared, TFeatures, TExpose, TSetup> &
  Readonly<{
    /** Definition's literal registration name, preserved for reference typing. */
    readonly name: TName
    /** Exact own declaration map remains tied to its trusted definition. */
    readonly pipelines?: TPipelines
    /** Creates a required cross-plugin reference without running the provider's Feature factory. */
    getFeature<TKey extends Extract<keyof TFeatures, string>>(
      name: TKey
    ): IFeatureReference<IFeatureOutput<TFeatures[TKey]>, false, TName, TPipelines>
    /**
     * Optional:true tolerates an absent provider; unknown declared names still throw
     * FEATURE_NOT_DECLARED.
     */
    getFeature<TKey extends Extract<keyof TFeatures, string>>(
      name: TKey,
      options: Readonly<{
        /** Opts into an optional reference; the dependency value can be undefined when absent. */
        readonly optional: true
      }>
    ): IFeatureReference<IFeatureOutput<TFeatures[TKey]>, true, TName, TPipelines>
    /** Required only in declarations; runtime authority remains the private WeakMap. */
    readonly [definedPluginBrand]: {
      readonly core: TCore
      readonly value: TValue
      readonly pipelines: TPipelines
    }
  }>

/** Extracts captured own pipeline declarations from trusted-definition provenance. */
export type IPluginDeclaredPipelines<TPlugin> = TPlugin extends {
  readonly [definedPluginBrand]: {
    readonly pipelines: infer TPipelines extends IPipelineDefinitions
  }
}
  ? TPipelines
  : Record<never, never>
