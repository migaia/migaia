import type {
  IPipelineDefinitions,
  IPipelineRegistration,
  IPipelineScope
} from './pipeline-spec.js'
import type { INativeAbortSignal } from '@migaia/utils/promise'
import { asyncDisposeKey } from './symbols.js'
import type { IScheduler } from '@migaia/utils/scheduler'
import type { ICleanupResult } from '@migaia/lifecycle'
import type {
  IFeatureOutput,
  IFeatureReference,
  IFeatureOutputs,
  IFeatureRecord,
  IFeatureRecordRequiredExpose
} from './feature-types.js'

/** Values accepted at every asynchronous plugin lifecycle boundary. */
export type IPluginAwaitable<T> = T | PromiseLike<T>
/** Plugin resource cleanup callback; a thenable is assimilated by the owning lifecycle scope. */
export type IPluginDisposer = () => IPluginAwaitable<void>
/** One owned release capability; callbacks or supported disposal symbols are captured at admission. */
export type IPluginResource =
  | IPluginDisposer
  | { [asyncDisposeKey](): IPluginAwaitable<void> }
  | { [Symbol.dispose](): void }

/** Generic structured detail carried by a PluginHost boundary error. */
export type IPluginHostErrorDetail = Readonly<Record<string, unknown>>

/** Interface semantics are required only for adapter-owned module augmentation of Host outlets. */
export interface IPluginHostRuntimeExtensions<
  TInstalled extends readonly IPluginConstraint<any>[] = readonly [],
  _TCandidate = unknown
> {
  /** Type-only installed inventory; the canonical runtime state remains the authority. */
  readonly __installedPlugins?: TInstalled
}

/**
 * Structured install-failure detail. Synchronous installation publishes an immutable snapshot; its
 * completion resolves to the final immutable rollback detail without mutating the published error,
 * so a translator can await cleanup deterministically.
 */
export type IPluginInstallFailureDetail = {
  /** Plugin whose construction or publication failed, even when earlier batch members roll back. */
  readonly failedName: string
  /** Original secondary rollback failures in release order; they do not replace the primary cause. */
  readonly rollbackErrors: readonly unknown[]
  /** Present on synchronous failure snapshots when rollback must finish asynchronously. */
  readonly completion?: Promise<IPluginInstallFailureDetail>
}

/** String-keyed plugin configuration; runtime admission owns and freezes supported data containers. */
export type IPluginConfig = Record<string, unknown>

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

/** Recursive readonly view exposed by the lazy configuration proxy. */
export type IReadonlyConfig<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends object
    ? { readonly [K in keyof T]: IReadonlyConfig<T[K]> }
    : T

/** Registration-local read capability, without the Host's configuration mutation authority. */
export type IPluginLifecycleConfig<TConfig extends IPluginConfig = IPluginConfig> = {
  /** Reads the current immutable configuration snapshot; retained older snapshots do not change. */
  get(): IReadonlyConfig<TConfig>
}

/** Operation-scoped cancellation and deadline exposed to one plugin hook invocation. */
export type IPluginOperationContext = {
  /** Cooperative cancellation for this hook attempt; expiry also removes commit authority. */
  readonly signal: INativeAbortSignal
  /** Absolute scheduler-clock deadline, or undefined for an explicitly unbounded mutation. */
  readonly deadlineAt: number | undefined
}

/** Registration-scoped lifetime signal that remains valid until logical revocation. */
export type IPluginRegistrationContext = {
  /** Lifetime of the registration rather than one operation; logical revocation aborts it. */
  readonly signal: INativeAbortSignal
}

/** Disposal context passed to a V2 plugin dispose hook. */
export type IPluginDisposalContext = Readonly<{
  /** Registration lifetime signal, which may already be aborted when physical cleanup runs. */
  readonly signal: INativeAbortSignal
  /** Shared cleanup deadline when one was selected, otherwise undefined. */
  readonly deadlineAt: number | undefined
}>

/** Gives a pre-release hook the Host clock's remaining relative cleanup budget. */
export type IPluginBeforeReleaseContext = Readonly<
  IPluginDisposalContext & {
    /** Nonnegative budget remaining on the Host clock, or undefined for unbounded release. */
    remainingMs(): number | undefined
  }
>

/** Plugin-facing config capability; TConfig is fixed by the plugin declaration. */
export type IPluginLifecycleCore<TConfig extends IPluginConfig = IPluginConfig> = {
  /** Reads this registration's immutable configuration, without a mutation method. */
  readonly config: IPluginLifecycleConfig<TConfig>
  /** Current hook attempt's cancellation and deadline; capture it for that invocation only. */
  readonly operation: IPluginOperationContext
  /** Registration lifetime, distinct from an individual timed operation. */
  readonly lifecycle: IPluginRegistrationContext
}

/** Attempt-scoped cancellation and deadline for setup, independent of later Host mutations. */
export type IPluginSetupOperation = Readonly<{
  /** Setup-attempt cancellation; late settlement cannot regain publication authority. */
  readonly signal: INativeAbortSignal
  /** Absolute deadline in the Host scheduler clock, or undefined without a mutation timeout. */
  readonly deadlineAt: number | undefined
  /** Reads the Host scheduler clock used for the deadline. */
  now(): number
}>

/** Setup sees lifecycle capabilities but no Feature or pipeline output. */
export type IPluginSetupContext<TConfig extends IPluginConfig = IPluginConfig> = Readonly<{
  /** Read-only configuration for this registration's setup attempt. */
  readonly config: IPluginLifecycleConfig<TConfig>
  /** Setup-owned signal, deadline and clock, independent of subsequent mutations. */
  readonly operation: IPluginSetupOperation
  /** Registration lifetime signal retained after successful setup. */
  readonly lifecycle: IPluginRegistrationContext
  /** Owns a setup resource; late registration releases it before reporting RESOURCE_OUTSIDE_INSTALL. */
  onDispose(resource: IPluginResource): void
}>

/** Produces one registration's setup output before Feature construction. */
export type IPluginSetup<TConfig extends IPluginConfig, TSetup> = (
  context: IPluginSetupContext<TConfig>
) => TSetup | PromiseLike<TSetup>

/** Reexports the package's canonical error vocabulary without creating another declaration site. */
export { PluginHostErrorCode, type IPluginHostErrorCode } from './error-code.js'

// 本文件自身也引用该类型（见 IPluginHostOptions.diagnostic）；re-export 不会把名字带进本地作用域。
import type { IPluginHostErrorCode } from './error-code.js'
import {
  GENERATOR_CONTINUE,
  GENERATOR_HALT,
  GENERATOR_UNDEFINED,
  type IAsyncGeneratorMiddlewareStage,
  type IAsyncMiddlewareStage,
  type IGeneratorMiddlewareStage,
  type IMiddlewarePipelineMode,
  type ISyncMiddlewareStage
} from '@migaia/middleware-pipeline'

/** Selects the Host runner once at construction; each registered stage must be liftable to it. */
export type IPipelineConfig = {
  /** Defaults to sync; accepts sync, async, generator or async-generator. */
  mode?: IMiddlewarePipelineMode
}
/** Explicit generator return value for a final `undefined` payload. */
/**
 * Generator signals are re-exported from middleware-pipeline so adapters and runners share
 * identity.
 */
export { GENERATOR_CONTINUE, GENERATOR_HALT, GENERATOR_UNDEFINED }
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

/** Plugin-scoped config surface exposed by a name-addressed handle. */
export type IPluginHandleConfig<TPlugin> = Readonly<{
  /** Current name-addressed owned snapshot; access checks Host and registration availability. */
  get(): IReadonlyConfig<IExtractPluginConfig<TPlugin>>
  /** Queued synchronous recipe returning a shallow patch; hook success is required before commit. */
  update(
    recipe: (
      previous: IReadonlyConfig<IExtractPluginConfig<TPlugin>>
    ) => Partial<IExtractPluginConfig<TPlugin>>
  ): Promise<void>
}>

/** Public name-addressed plugin handle. */
export type IPluginHandle<TPlugin extends IPluginConstraint<any>> = Readonly<{
  /** Stable name; other members resolve the current registration with this name on every read. */
  readonly name: TPlugin['name']
  /** Frozen facade for the current generation; retained callable members reject after revocation. */
  readonly extensions: Readonly<IExtractPluginExt<TPlugin>>
  /**
   * Reads a declared ready Feature; missing, disabled, suspended or cold registrations fail
   * explicitly.
   */
  getFeature<TKey extends IPluginFeatureName<TPlugin>>(
    name: TKey
  ): IPluginFeatureOutput<TPlugin, TKey>
  /** Name-scoped config reader/updater, subject to the same registration availability checks. */
  readonly config: IPluginHandleConfig<TPlugin>
}>

/** Input-order-preserving handles returned from one install batch. */
export type IPluginHandleTuple<TPlugins extends readonly IPluginConstraint<any>[]> = {
  readonly [K in keyof TPlugins]: TPlugins[K] extends IPluginConstraint<any>
    ? IPluginHandle<TPlugins[K]>
    : never
}

/** Structured logical removal result; cleanup failures remain observable. */
export type IPluginRemoval =
  | Readonly<{
      /** Logical mutation completed without reported cleanup failures. */
      readonly ok: true
      /** Actual applied changes, which can include suspended dependents. */
      readonly affected: IPluginDependencyPlan
    }>
  | Readonly<{
      /** Logical mutation committed, but cleanup or drain failures were collected. */
      readonly ok: false
      /** Original failures in observed order; this result does not restore removed registrations. */
      readonly errors: readonly unknown[]
      /** Actual applied changes even when some cleanup failed. */
      readonly affected: IPluginDependencyPlan
    }>

/**
 * Host diagnostic outlet. `message` stays the human-readable line; `error`, when present, is the
 * exact contained error object so reporters can walk its `cause`/`errors` chain instead of parsing
 * text. Reporter failures are contained by the Host and never replace the reported primary.
 */
export type IPluginHostDiagnostic = (
  message: string,
  code?: IPluginHostErrorCode,
  error?: unknown
) => void

/** Dependency-aware removal/disable behavior. */
export type IPluginDependencyMutationOptions = Readonly<{
  /**
   * Defaults to reject; cascade removes/disables required dependents, suspend retains them
   * inactive.
   */
  readonly policy?: import('@migaia/capability/graph/dependency').DependencyPolicy
  /** Defaults to false; true returns a plan without revocation, cleanup or revision change. */
  readonly dryRun?: boolean
}>

/** One capability planner action projected onto a PluginHost registration name. */
export type IPluginDependencyPlanStep = Readonly<{
  /** Registration selected by the dependency planner. */
  readonly name: string
  /** Planned capability action such as release, disable or suspend; not an already applied result. */
  readonly action: import('@migaia/capability/graph/dependency').DependencyAction
}>

/** Immutable dependency mutation plan returned by dry-run operations. */
export type IPluginDependencyPlan = Readonly<{
  /** Admitted reject, cascade or suspend policy used to construct this plan. */
  readonly policy: import('@migaia/capability/graph/dependency').DependencyPolicy
  /** Dependency-safe action order projected to registration names. */
  readonly order: readonly string[]
  /** Explicit planned actions; an actual removal's affected result includes only applied changes. */
  readonly steps: readonly IPluginDependencyPlanStep[]
  /** Provider-to-consumer edges relevant to the mutation, including absent optional providers. */
  readonly edges: readonly Readonly<{
    /** Name of the supplying plugin. */
    readonly provider: string
    /** Name of the plugin that declares this dependency. */
    readonly consumer: string
    /** Whether the declared reference tolerates an absent provider. */
    readonly optional: boolean
    /** Present only to identify an optional edge whose provider is absent. */
    readonly status?: 'optional-absent'
  }>[]
}>

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

/** Opaque compile-time provenance carried by definitions made through `definePlugin`. */
declare const definedPluginBrand: unique symbol
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

type IPluginByName<TPlugins extends readonly unknown[], TName extends string> = Extract<
  TPlugins[number],
  { readonly name: TName }
>

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

/** Restore capability for the exact registration set changed by one disable operation. */
export type IPluginDisableToken<
  _THost,
  TPlugin extends IPluginConstraint<any>,
  _TInstalled extends readonly IPluginConstraint<any>[],
  _TDomainCore extends object,
  _TValue
> = Readonly<{
  /** Name retained by this exact registration's restore token. */
  readonly name: TPlugin['name']
  /** Reenables the captured registration; replacement/removal cannot be restored by a stale token. */
  enable(): Promise<void>
}>

/** Host-side enablement surface; string enablement keeps a dynamic view type. */
export type IPluginEnablement<
  THost,
  TInstalled extends readonly IPluginConstraint<any>[],
  TDomainCore extends object,
  TValue
> = Readonly<{
  /** Plans dependency-aware disablement without changing availability when dryRun is true. */
  disable(
    name: string,
    options: IPluginDependencyMutationOptions & Readonly<{ readonly dryRun: true }>
  ): Promise<IPluginDependencyPlan>
  /** Disables access while retaining resources, returning a token for this exact registration. */
  disable(
    name: string,
    options?: IPluginDependencyMutationOptions & Readonly<{ readonly dryRun?: false }>
  ): Promise<
    Readonly<{
      /** Restores the exact changed disable set in dependency-safe order, not a later generation. */
      readonly token: IPluginDisableToken<THost, any, TInstalled, TDomainCore, TValue>
    }>
  >
  /** Reenables a name and resumes eligible required dependents; registration resources are retained. */
  enable(name: string): Promise<void>
  /** Frozen snapshot of explicitly disabled names; suspended dependents are a distinct state. */
  disabled(): readonly string[]
}>

/** Stable Host config facade; dot paths resolve plugin name first, updates are serialized patches. */
export type IPluginHostConfigFor<TPlugins extends readonly unknown[]> = {
  /** Reads an owned snapshot/path, returning undefined for an absent plugin or child path. */
  get(path: string): unknown | undefined
  /** Typed name overload; the recipe sees latest committed config and returns a synchronous patch. */
  update<TName extends Extract<TPlugins[number], { readonly name: string }>['name']>(
    name: TName,
    recipe: (
      previous: IReadonlyConfig<IExtractPluginConfig<IPluginByName<TPlugins, TName>>>
    ) => Partial<IExtractPluginConfig<IPluginByName<TPlugins, TName>>>
  ): Promise<void>
  /** Dynamic-name overload with the same transactional commit and callback-failure semantics. */
  update(
    name: string,
    recipe: (previous: IReadonlyConfig<IPluginConfig>) => Partial<IPluginConfig>
  ): Promise<void>
}

type IUnionToIntersection<T> = (T extends unknown ? (value: T) => void : never) extends (
  value: infer I
) => void
  ? I
  : never

/** Combines the instance extensions supplied by a plugin group into an intersection. */
export type IMergePluginExts<TPlugins extends readonly unknown[]> = IUnionToIntersection<
  IExtractPluginExt<TPlugins[number]>
>

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

/** Host execution, scheduling and diagnostics admitted once by the canonical runtime constructor. */
export type IPluginHostOptions<TPipelines extends IPipelineDefinitions = Record<never, never>> = {
  /** Optional human-readable Host identity label; uniqueness is supplied by the runtime id. */
  readonly identity?: Readonly<{
    /** Defaults to DEFAULT; a supplied label must be a nonempty string and need not be unique. */
    readonly name?: string
  }>
  /** Explicit operation and pipeline drain budgets; `false` opts into unbounded waiting. */
  readonly execution: {
    /**
     * Maximum time for one admitted install, update, or removal hook; `false` waits without a
     * deadline. Required numeric values must be finite and nonnegative; there is no implicit
     * default.
     */
    readonly mutationTimeoutMs: number | false
    /**
     * Maximum time to drain active pipeline leases before logical removal continues; `false` waits
     * until zero. Required numeric values must be finite and nonnegative; there is no implicit
     * default.
     */
    readonly pipelineDrainTimeoutMs: number | false
  }
  /** Optional runner configuration; omission selects mode sync. */
  pipeline?: IPipelineConfig
  /** Optional immutable named declarations; absence creates no additional execution resources. */
  readonly pipelines?: TPipelines
  /** Defaults to a no-op; contains cleanup, late rejection and queue-wait observations. */
  diagnostic?: IPluginHostDiagnostic
  /**
   * Terminal sink for failures of `diagnostic` itself (it threw or rejected). Receives the exact
   * failure object; when absent, or when it throws too, the failure goes to the runtime's
   * `globalThis.reportError` if one exists. Never affects Host control flow.
   */
  onDiagnosticFailure?: (error: unknown) => void
  /**
   * Clock and scheduling source shared by the queue watchdog and disposal timeouts. Defaults to
   * systemScheduler from the shared scheduler package.
   */
  scheduler?: IScheduler
  /**
   * Admission wait limit. `undefined` reports without rejecting; `false` disables timers, reports,
   * and rejection; a number rejects and removes timed-out work.
   */
  queueAdmissionTimeoutMs?: number | false
  /**
   * Diagnostic wait threshold when `queueAdmissionTimeoutMs` is omitted. `false` disables its
   * timer. Defaults to 1000 milliseconds; an explicit admission timeout takes precedence.
   */
  queueAdmissionDiagnosticMs?: number | false
  /**
   * Maximum wait for one disposal step. `false` waits indefinitely without triggering forced
   * release. Defaults to 5000 milliseconds and never forcibly interrupts running JavaScript.
   */
  disposeStepTimeoutMs?: number | false
}

/** Physical completion detail for work that outlives bounded logical disposal. */
export type IPluginHostPhysicalCleanupResult = ICleanupResult

/** Default runtime's logical terminal outcome; collected cleanup failures never reopen the Host. */
export type IPluginHostDisposalResult = ICleanupResult &
  Readonly<{
    /** True once the default runtime has closed admission and committed its terminal state. */
    readonly logicalTerminal: true
    /** Whether tracked cleanup/leases physically settled; cleanupErrors may still be nonempty. */
    readonly cleanupComplete: boolean
  }>

/** Opaque Host-owned ordering slot; callers may retain it but cannot inspect its ordinal. */
export type IPluginDataOrderSlot = Readonly<{ readonly __pluginDataOrderSlot: unique symbol }>

/** Opaque immutable admission snapshot produced by the PluginHost canonical factory. */
declare const pluginAdmissionBrand: unique symbol
export type IPluginAdmission<TPlugin extends IPluginConstraint<any>> = Readonly<{
  readonly [pluginAdmissionBrand]?: TPlugin
}>

/** One admission request for the composition integration boundary. */
export type IPluginAdmissionRequest = Readonly<{
  /** Opaque definition snapshot produced by the canonical admission factory. */
  readonly admission: IPluginAdmission<IPluginConstraint<any>>
  /** Live ordering lane issued by the receiving Host for this same definition name. */
  readonly slot: IPluginDataOrderSlot
}>

/** Opaque prepared candidate admission owned by one concrete PluginHost. */
export type IPluginPreparedAdmissions = object

/** Canonical name for the opaque token accepted by composition publication. */
export type IRegistrationToken<TPlugin extends IPluginConstraint<any> = IPluginConstraint<any>> =
  object & Readonly<{ readonly __plugin?: TPlugin }>

/** Narrow extension-only view for one live registration token. */
export type IRegistrationView<TPlugin extends IPluginConstraint<any> = IPluginConstraint<any>> =
  Readonly<{
    /** Exact-generation guarded extensions; they never follow a same-name replacement. */
    readonly extensions: Readonly<IExtractPluginExt<TPlugin>>
  }>

/** Opaque exact registration batch prepared for logical removal. */
export type IPluginPreparedRemovalBatch = object

/** Canonical fence supplied by Graph before Host physical cleanup begins. */
export type IPluginBatchRemovalOptions = Readonly<{
  /**
   * Optional external lease fence; logical revocation precedes waiting, physical cleanup follows
   * it.
   */
  readonly beforeCleanup?: PromiseLike<void>
}>

/** Result of one prepared batch removal, preserving the Host dynamic-view contract. */
export type IPluginBatchRemovalLeaf = ICleanupResult &
  Readonly<{
    /** Exact registration generation revoked by this leaf. */
    readonly receipt: IRegistrationToken
    /** Registration name retained for correlating cleanup observations. */
    readonly name: string
    /** True only when this leaf has no cleanup errors or unsettled physical continuation. */
    readonly cleanupComplete: boolean
  }>

/** Aggregate result for one all-or-nothing prepared removal commit. */
export type IPluginBatchRemovalResult<TSnapshot> = ICleanupResult &
  Readonly<{
    /** True when the committed batch has no cleanup errors or physical continuation. */
    readonly ok: boolean
    /** Logical removal already committed even if cleanup is incomplete or failed. */
    readonly committed: true
    /** Remaining Host publication captured immediately after logical revocation. */
    readonly snapshot: TSnapshot
    /** Per-registration cleanup observations in dependency-safe cleanup order. */
    readonly leaves: readonly IPluginBatchRemovalLeaf[]
    /** True only when the batch reports no cleanup errors or unsettled continuation. */
    readonly cleanupComplete: boolean
  }>

/** Internal composition snapshot; ordinary Host consumers receive name-addressed handles. */
export type IPluginHostCompositionSnapshot = Readonly<{
  /** Frozen extension publication with exact-registration liveness guards. */
  readonly extensions: Readonly<Record<PropertyKey, unknown>>
  /** Host config capability; reading a path still resolves current committed configuration. */
  readonly config: IPluginHostConfigFor<readonly IPluginConstraint<any>[]>
}>

/** Host-owned integration used by a composition owner to perform total batch publication. */
export type IPluginHostCompositionIntegration<_THost> = Readonly<{
  /** Live committed revision, used to reject publication of a drifted prepared candidate. */
  readonly revision: number
  /** Captures current enabled publication; throws when the Host no longer accepts access. */
  getCurrentSnapshot(): IPluginHostCompositionSnapshot
  /** Captures a definition without running hooks and returns its immutable opaque admission. */
  createPluginAdmission<TPlugin extends IPluginConstraint<any>>(
    plugin: TPlugin
  ): IPluginAdmission<TPlugin>
  /** Allocates a stable name-matched stage lane; a second live slot for the same name is invalid. */
  createDataOrderSlot(name: string): IPluginDataOrderSlot
  /** Queues construction without publication; the owner must later commit or discard the capsule. */
  prepareAdmissions(
    requestsInPublicationOrder: readonly IPluginAdmissionRequest[]
  ): Promise<IPluginPreparedAdmissions>
  /**
   * Synchronously publishes one unused candidate if revision/lanes remain current; returns
   * receipts.
   */
  commitPreparedAdmissions(prepared: IPluginPreparedAdmissions): readonly IRegistrationToken[]
  /** Rolls back an unpublished candidate; repeated or foreign discard returns empty cleanup detail. */
  discardPreparedAdmissions(
    prepared: IPluginPreparedAdmissions
  ): Promise<IPluginHostPhysicalCleanupResult>
  /** Permanently retires this Host's lane; repeated retirement is harmless, foreign slots fail. */
  retireDataOrderSlot(slot: IPluginDataOrderSlot): void
  /** Captures exact live receipts, rejecting duplicates or an omitted required dependent. */
  prepareUnUseBatch(
    receiptsInCleanupOrder: readonly IRegistrationToken[]
  ): IPluginPreparedRemovalBatch
  /** Rechecks generations/dependencies, revokes all leaves, then waits for the fence and cleanup. */
  commitPreparedUnUseBatch<TView>(
    prepared: IPluginPreparedRemovalBatch,
    options: IPluginBatchRemovalOptions
  ): Promise<IPluginBatchRemovalResult<TView>>
}>

/** Public named-pipeline declaration and authority types share one canonical owner. */
export type {
  IPipelineDefinitions,
  IPipelineSpecOptions,
  IPipelineSpec,
  IPipelinePayload,
  IPipelineMode,
  IPipelineStage,
  IPipelineRegistration,
  IPipelineScope,
  IPipelineStageHandle,
  IPipelineOwner,
  IPipelineRunResult
} from './pipeline-spec.js'

/** A plugin's own map and actual Feature references define its extra registration names. */
export type IPluginPipelineCore<
  TPipelines extends IPipelineDefinitions,
  TFeatures extends IFeatureRecord
> = IPipelineScope<TPipelines & import('./feature-types.js').IFeatureRecordPipelines<TFeatures>>

/** Extracts captured own pipeline declarations from trusted-definition provenance. */
export type IPluginDeclaredPipelines<TPlugin> = TPlugin extends {
  readonly [definedPluginBrand]: {
    readonly pipelines: infer TPipelines extends IPipelineDefinitions
  }
}
  ? TPipelines
  : Record<never, never>
