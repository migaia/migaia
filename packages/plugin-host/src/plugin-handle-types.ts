/**
 * Defines name-addressed handles, configuration and dependency mutation results. Runtime
 * availability remains owned by the Host.
 */
import type { IPluginConfig, IReadonlyConfig } from './plugin-lifecycle-types.ts'
import type { IPluginConstraint } from './plugin-definition-types.ts'
import type {
  IPluginFeatureName,
  IPluginFeatureOutput,
  IExtractPluginExt,
  IExtractPluginConfig
} from './plugin-inference-types.ts'

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

/** Selects one literal-name inventory member for precise configuration recipe inference. */
type IPluginByName<TPlugins extends readonly unknown[], TName extends string> = Extract<
  TPlugins[number],
  { readonly name: TName }
>

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
