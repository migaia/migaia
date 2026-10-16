import type { TrayShutdownMode } from '../state-constants.js'
import type {
  IExtractPluginConfig,
  IExtractPluginExt,
  IFeature,
  IFeatureReference,
  IPluginConstraint,
  IPluginConstraintTuple,
  IHostHandle,
  IPluginHostCoreFor,
  IPluginHostConfigFor,
  IPluginHostDisposalResult,
  IPluginHostInstalledPlugins,
  IMergePluginExts,
  PluginHost
} from '@migaia/plugin-host'
import { asyncDisposeKey } from '@migaia/plugin-host'
import type { IEventContext } from '@migaia/event-subscriber'
import type { ICleanupResult } from '@migaia/lifecycle'

/** Both canonical PluginHost entries expose the same managed composition capability. */
export type ITrayHostSource = PluginHost<any, any, any> | IHostHandle<any, any, any>

/** Plugin hooks receive the declared domain core and lifecycle core, rather than the Host handle. */
export type ITrayPluginCore<THost extends ITrayHostSource> = IPluginHostCoreFor<THost>

/** Type-only provenance keeps concrete Host capabilities out of recursive facade inference. */
declare const trayHostTypes: unique symbol

/** Minimal type carrier shared by consumers of an exact or dynamic managed Host. */
export type ITrayHostTypeInfo = Readonly<{
  readonly [trayHostTypes]: Readonly<{
    readonly host: ITrayHostSource
    readonly definitions: readonly IPluginConstraint<any>[]
    readonly ready: readonly IPluginConstraint<any>[]
  }>
}>

/** Concrete source Host retained by one managed facade. */
export type ITrayHostSourceOf<THost extends ITrayHostTypeInfo> = THost[typeof trayHostTypes]['host']

/** Admitted definitions retained by one managed facade, including blocked definitions. */
export type ITrayHostDefinitions<THost extends ITrayHostTypeInfo> =
  THost[typeof trayHostTypes]['definitions']

/** Only ready managed plugins may provide exact Runtime callback extensions. */
export type ITrayHostReadyPlugins<THost extends ITrayHostTypeInfo> =
  THost[typeof trayHostTypes]['ready']

/** Constructor-installed plugins remain part of every exact and dynamic Tray view. */
export type IHostBaselinePlugins<THost extends ITrayHostSource> =
  THost extends PluginHost<any, any, any>
    ? IPluginHostInstalledPlugins<THost>
    : THost extends { readonly __installedPlugins?: infer TInstalled }
      ? Extract<TInstalled, readonly IPluginConstraint<any>[]>
      : readonly []

/** Avoids the PluginHost empty-merge sentinel from poisoning dynamic unknown-key fallbacks. */
type IHostBaselineExtensions<THost extends ITrayHostSource> =
  IHostBaselinePlugins<THost> extends readonly []
    ? object
    : Extract<IMergePluginExts<IHostBaselinePlugins<THost>>, object>

/** Plugin descriptor accepted by the managed Tray Host. */
export type ITrayPluginConstraint<THost extends ITrayHostSource> = IPluginConstraint<
  ITrayPluginCore<THost>
>

/** Reuses PluginHost admission, including defined-plugin core provenance and adapter constraints. */
export type ITrayPluginAdmission<
  THost extends ITrayHostSource,
  TPlugins extends readonly IPluginConstraint<any>[],
  TReady extends readonly IPluginConstraint<any>[] = readonly []
> = IPluginConstraintTuple<
  ITrayPluginCore<THost>,
  TPlugins,
  readonly [...IHostBaselinePlugins<THost>, ...TReady]
>

/** Extracts literal plugin names for the bounded ready-closure solver. */
type ITrayDefinitionNames<TDefinitions extends readonly unknown[]> = [
  TDefinitions[number]
] extends [never]
  ? never
  : TDefinitions[number] extends { readonly name: infer TName extends string }
    ? TName
    : never

/**
 * Follows local Feature metadata to provider references without evaluating any factory. Erased
 * metadata and closures beyond the existing 128-definition budget yield a widened provider guard.
 */
type ITrayFeatureProviders<
  TFeature,
  TRequiredOnly extends boolean,
  TDepth extends readonly unknown[] = readonly []
> = 0 extends 1 & TFeature
  ? string
  : TFeature extends IFeatureReference<object, infer TOptional, infer TProvider>
    ? TRequiredOnly extends true
      ? TOptional extends true
        ? never
        : TProvider
      : TProvider
    : TFeature extends IFeature<any, any, infer TDependencies>
      ? TDepth['length'] extends 128
        ? string
        : ITrayFeatureProviders<
            TDependencies[keyof TDependencies],
            TRequiredOnly,
            readonly [...TDepth, unknown]
          >
      : never

/** Projects provider names from every declared root and its local Feature closure. */
type ITrayProviders<TPlugin, TRequiredOnly extends boolean = false> = TPlugin extends {
  readonly features?: infer TFeatures
}
  ? ITrayFeatureProviders<NonNullable<TFeatures>[keyof NonNullable<TFeatures>], TRequiredOnly>
  : never

/** Required providers alone constrain whether an admitted plugin can enter the ready closure. */
type ITrayRequires<TPlugin> = ITrayProviders<TPlugin, true>

/** Replaces one literal definition while retaining tuple order for exact mutation views. */
type IReplaceTrayDefinition<
  TDefinitions extends readonly unknown[],
  TPlugin
> = TDefinitions extends readonly [infer THead, ...infer TTail]
  ? THead extends { readonly name: infer TName extends string }
    ? TPlugin extends { readonly name: TName }
      ? readonly [TPlugin, ...IReplaceTrayDefinition<TTail, TPlugin>]
      : readonly [THead, ...IReplaceTrayDefinition<TTail, TPlugin>]
    : readonly [THead, ...IReplaceTrayDefinition<TTail, TPlugin>]
  : readonly []

/** Removes one literal definition so provider deletion recomputes the exact ready closure. */
type IRemoveTrayDefinition<
  TDefinitions extends readonly unknown[],
  TName extends string
> = TDefinitions extends readonly [infer THead, ...infer TTail]
  ? THead extends { readonly name: infer THeadName extends string }
    ? THeadName extends TName
      ? TTail
      : readonly [THead, ...IRemoveTrayDefinition<TTail, TName>]
    : readonly [THead, ...IRemoveTrayDefinition<TTail, TName>]
  : readonly []

/** Resolves a literal mutation result, falling back to a baseline-preserving dynamic view. */
export type ITrayMutationView<
  THost extends ITrayHostSource,
  TDefinitions extends readonly ITrayPluginConstraint<THost>[],
  TReady extends readonly ITrayPluginConstraint<THost>[],
  TPlugin extends ITrayPluginConstraint<THost>
> = string extends TPlugin['name']
  ? ITrayHostDynamic<THost, Extract<IMergePluginExts<TReady>, object>>
  : IReplaceTrayDefinition<TDefinitions, TPlugin> extends readonly ITrayPluginConstraint<THost>[]
    ? ITrayResolvedHost<THost, IReplaceTrayDefinition<TDefinitions, TPlugin>>
    : ITrayHostDynamic<THost, Extract<IMergePluginExts<TReady>, object>>

/** Adds one complete deterministic readiness pass to the current fixed-point approximation. */
type IAddReadyDefinitionsPass<
  TDefinitions extends readonly unknown[],
  TReady extends readonly unknown[]
> = TDefinitions extends readonly [
  infer THead extends object,
  ...infer TTail extends readonly unknown[]
]
  ? THead extends { readonly name: infer TName extends string }
    ? TName extends ITrayDefinitionNames<TReady>
      ? IAddReadyDefinitionsPass<TTail, TReady>
      : Exclude<ITrayRequires<THead>, ITrayDefinitionNames<TReady>> extends never
        ? IAddReadyDefinitionsPass<TTail, readonly [...TReady, THead]>
        : IAddReadyDefinitionsPass<TTail, TReady>
    : IAddReadyDefinitionsPass<TTail, TReady>
  : TReady

/** Repeats readiness passes with tuple-length fuel so recursive inference is bounded. */
type IResolveReadyWithFuel<
  TDefinitions extends readonly unknown[],
  TReady extends readonly unknown[] = readonly [],
  TFuel extends readonly unknown[] = TDefinitions
> = TFuel extends readonly [unknown, ...infer TTail]
  ? IResolveReadyWithFuel<TDefinitions, IAddReadyDefinitionsPass<TDefinitions, TReady>, TTail>
  : TReady

/** Optional and required references both need literal providers before exact inference is safe. */
type IHasWidenedProviders<TDefinitions extends readonly unknown[]> = TDefinitions extends readonly [
  infer THead extends object,
  ...infer TTail extends readonly unknown[]
]
  ? string extends ITrayProviders<THead>
    ? true
    : IHasWidenedProviders<TTail>
  : false

type IReadyInferenceExceeded<
  TDefinitions extends readonly unknown[],
  TCount extends readonly unknown[] = readonly []
> = TCount['length'] extends 128
  ? TDefinitions extends readonly []
    ? false
    : true
  : TDefinitions extends readonly [unknown, ...infer TTail]
    ? IReadyInferenceExceeded<TTail, readonly [...TCount, unknown]>
    : false

/** Whether the public resolver may safely retain an exact finite readiness tuple. */
export type ICanResolveReadyDefinitions<TDefinitions extends readonly unknown[]> =
  number extends TDefinitions['length']
    ? false
    : string extends ITrayDefinitionNames<TDefinitions>
      ? false
      : IReadyInferenceExceeded<TDefinitions> extends true
        ? false
        : IHasWidenedProviders<TDefinitions> extends true
          ? false
          : true

/**
 * Detects the common independent-definition shape so large exact tuples avoid redundant fixed-point
 * passes.
 */
type IAllDefinitionsIndependent<TDefinitions extends readonly unknown[]> =
  TDefinitions extends readonly [
    infer THead extends object,
    ...infer TTail extends readonly unknown[]
  ]
    ? [ITrayProviders<THead>] extends [never]
      ? IAllDefinitionsIndependent<TTail>
      : false
    : true

/** Exact readiness is selected only for finite, literal, at-most-128 definition tuples. */
export type IResolveReadyTrayPlugins<TDefinitions extends readonly unknown[]> =
  number extends TDefinitions['length']
    ? readonly []
    : string extends ITrayDefinitionNames<TDefinitions>
      ? readonly []
      : IReadyInferenceExceeded<TDefinitions> extends true
        ? readonly []
        : IAllDefinitionsIndependent<TDefinitions> extends true
          ? TDefinitions
          : IHasWidenedProviders<TDefinitions> extends true
            ? readonly []
            : IResolveReadyWithFuel<TDefinitions>

/** Awaitable values accepted at lifecycle boundaries. */
export type IPluginWithSynchronousShared<TPlugin> = TPlugin & {
  readonly shared?: (core: unknown) => Record<PropertyKey, unknown>
}

/** Public lifecycle states for a managed Host. */
export const TrayHostState = {
  active: 'active',
  closing: 'closing',
  terminal: 'terminal',
  failed: 'failed'
} as const
export type ITrayHostState = (typeof TrayHostState)[keyof typeof TrayHostState]

/** Event payloads published after settled managed mutations. */
export type ITrayHostEventMap = {
  readonly use: Readonly<Record<string, unknown>>
  readonly unUse: Readonly<Record<string, unknown>>
  readonly replace: Readonly<Record<string, unknown>>
  /** Settled lifecycle aliases describe the logical operation without exposing Graph authority. */
  readonly registered: Readonly<Record<string, unknown>>
  readonly removed: Readonly<Record<string, unknown>>
  readonly replaced: Readonly<Record<string, unknown>>
  readonly mutationFailed: Readonly<{
    readonly operation: 'use' | 'unUse' | 'replace'
    readonly name: string
    readonly error: Error
  }>
  readonly disposing: Readonly<{ readonly state: 'closing' }>
  readonly disposed: Readonly<{ readonly state: 'terminal'; readonly cleanupComplete: boolean }>
}

/** Minimal unsubscribe contract shared with event-subscriber without a runtime dependency. */
export type IUnsubscribe = () => void

/** Cleanup observation returned by managed mutations. */
export type ITrayPluginPhysicalCleanupResult = ICleanupResult
export type ITrayPluginMutationObservation<TView> = ICleanupResult &
  Readonly<{
    readonly operation: 'use' | 'replace'
    readonly name: string
    readonly affected: readonly string[]
    readonly topologyChanged: boolean
    readonly view: TView
    readonly cleanupComplete: boolean
  }>
export type ITrayPluginMutationResult<TPreviousView, TSuccessView, TCommittedFailureView> =
  | (ITrayPluginMutationObservation<TSuccessView> &
      Readonly<{ readonly ok: true; readonly committed: true }>)
  | (ITrayPluginMutationObservation<TPreviousView> &
      Readonly<{ readonly ok: false; readonly committed: false; readonly error: Error }>)
  | (ITrayPluginMutationObservation<TCommittedFailureView> &
      Readonly<{ readonly ok: false; readonly committed: true; readonly error: Error }>)

/** Shared mutation projection keeps Loader and direct Host installation on one capability contract. */
export type ITrayHostMutationResult<
  THost extends ITrayHostSource,
  TDefinitions extends readonly ITrayPluginConstraint<THost>[],
  TReady extends readonly ITrayPluginConstraint<THost>[],
  TPlugin extends ITrayPluginConstraint<THost>,
  TMutation extends 'use' | 'replace'
> = ITrayPluginMutationResult<
  ITrayHost<THost, TDefinitions, TReady>,
  TMutation extends 'replace'
    ? ITrayMutationView<THost, TDefinitions, TReady, TPlugin>
    : ITrayResolvedHost<THost, readonly [...TDefinitions, TPlugin]>,
  TMutation extends 'replace'
    ? ITrayHostDynamic<THost, Extract<IMergePluginExts<TReady>, object>>
    : ITrayHostDynamic<THost>
>

export type ITrayPluginRemovalObservation<TView> = ICleanupResult &
  Readonly<{
    readonly name: string
    readonly affected: readonly string[]
    readonly view: TView
    readonly cleanupComplete: boolean
  }>
export type ITrayPluginRemovalResult<TPreviousView, TCommittedView> =
  | (ITrayPluginRemovalObservation<TPreviousView> &
      Readonly<{ readonly ok: true; readonly committed: false; readonly removed: false }>)
  | (ITrayPluginRemovalObservation<TCommittedView> &
      Readonly<{ readonly ok: true; readonly committed: true; readonly removed: true }>)
  | (ITrayPluginRemovalObservation<TPreviousView> &
      Readonly<{
        readonly ok: false
        readonly committed: false
        readonly removed: false
        readonly error: Error
      }>)
  | (ITrayPluginRemovalObservation<TCommittedView> &
      Readonly<{
        readonly ok: false
        readonly committed: true
        readonly removed: true
        readonly error: Error
      }>)

/** Public managed Host surface. */
export type ITrayHost<
  THost extends ITrayHostSource,
  TDefinitions extends readonly ITrayPluginConstraint<THost>[],
  TReady extends readonly ITrayPluginConstraint<THost>[] = Extract<
    IResolveReadyTrayPlugins<TDefinitions>,
    readonly ITrayPluginConstraint<THost>[]
  >
> = Readonly<{
  /** No runtime property is emitted; each facade keeps its source and plugin tuples in declarations. */
  readonly [trayHostTypes]: Readonly<{
    readonly host: THost
    readonly definitions: TDefinitions
    readonly ready: TReady
  }>
  readonly plugins: readonly string[]
  readonly readyPlugins: readonly string[]
  readonly state: ITrayHostState
  readonly isActive: boolean
  readonly error: unknown | undefined
  readonly extensions: Readonly<
    IMergePluginExts<readonly [...IHostBaselinePlugins<THost>, ...TReady]>
  >
  readonly config: IPluginHostConfigFor<readonly [...IHostBaselinePlugins<THost>, ...TReady]>
  pluginState(name: string): string
  on<TKey extends keyof ITrayHostEventMap>(
    type: TKey,
    listener: (event: IEventContext<ITrayHostEventMap[TKey]>) => void | PromiseLike<void>
  ): IUnsubscribe
  use<const TPlugin extends ITrayPluginConstraint<THost>>(
    plugin: TPlugin & ITrayPluginAdmission<THost, readonly [TPlugin], TReady>[0]
  ): Promise<ITrayHostMutationResult<THost, TDefinitions, TReady, TPlugin, 'use'>>
  unUse<const TName extends string>(
    name: TName
  ): Promise<
    TName extends ITrayDefinitionNames<TDefinitions>
      ? ITrayPluginRemovalResult<
          ITrayHost<THost, TDefinitions, TReady>,
          IRemoveTrayDefinition<TDefinitions, TName> extends readonly ITrayPluginConstraint<THost>[]
            ? ITrayResolvedHost<THost, IRemoveTrayDefinition<TDefinitions, TName>>
            : ITrayHostDynamic<THost>
        >
      : ITrayPluginRemovalResult<
          ITrayHost<THost, TDefinitions, TReady>,
          ITrayHostDynamic<THost, Extract<IMergePluginExts<TReady>, object>>
        >
  >
  replace<const TPlugin extends ITrayPluginConstraint<THost>>(
    plugin: TPlugin & ITrayPluginAdmission<THost, readonly [TPlugin], TReady>[0]
  ): Promise<ITrayHostMutationResult<THost, TDefinitions, TReady, TPlugin, 'replace'>>
  dispose(): Promise<ITrayHostDisposalResult>
  [asyncDisposeKey](): Promise<void>
}>

/** Conservative dynamic view returned after widened or committed-failure mutations. */
export type ITrayHostDynamic<
  THost extends ITrayHostSource,
  TManagedBaseline extends object = object
> = Omit<
  ITrayHost<
    THost,
    readonly ITrayPluginConstraint<THost>[],
    readonly ITrayPluginConstraint<THost>[]
  >,
  'extensions'
> &
  Readonly<{
    readonly extensions: Readonly<
      IHostBaselineExtensions<THost> & TManagedBaseline & Record<PropertyKey, unknown>
    >
  }>

/** Host creation options. */
export type ICreateHostOptions<
  THost extends ITrayHostSource,
  TPlugins extends readonly ITrayPluginConstraint<THost>[]
> = Readonly<{
  /** Constructs the one PluginHost instance owned by the resulting Tray host. */
  readonly create: () => THost
  /** Initial plugin definitions admitted and installed in tuple order. */
  readonly plugins: TPlugins & ITrayPluginAdmission<NoInfer<THost>, TPlugins>
  /** Maximum wait for a serialized graph mutation to enter execution. */
  readonly mutationAdmissionMs: number
  /** Maximum bounded-shutdown wait for physical plugin quiescence. */
  readonly quiescenceMs: number
  /** Selects bounded shutdown or a strict drain that waits for physical completion. */
  readonly shutdown: Readonly<{
    /** Uses a bounded wait or waits strictly until every physical plugin release completes. */
    readonly mode: TrayShutdownMode
  }>
  /** Receives contained lifecycle and cleanup diagnostics without replacing the primary failure. */
  readonly report?: (error: unknown) => void
}>

export type ITrayResolvedHost<
  THost extends ITrayHostSource,
  TDefinitions extends readonly ITrayPluginConstraint<THost>[]
> =
  ICanResolveReadyDefinitions<TDefinitions> extends true
    ? ITrayHost<THost, TDefinitions>
    : ITrayHostDynamic<THost>

export type ITrayHostDisposalResult = ICleanupResult &
  Readonly<{
    readonly state: 'terminal'
    readonly termination: 'managed' | 'external-host'
    readonly cleanupComplete: boolean
    readonly error?: Error
  }>

export type ITrayHostCreationFailureDetail = ICleanupResult &
  Readonly<{
    readonly phase: 'factory' | 'admission' | 'graph' | 'setup' | 'commit'
    readonly cleanupComplete: boolean
  }>
export type ITrayHostCreationError = Error &
  Readonly<{ readonly detail: ITrayHostCreationFailureDetail }>

export type IExtractTrayPluginConfig<T> = IExtractPluginConfig<T>
export type IExtractTrayPluginExt<T> = IExtractPluginExt<T>
export type IMergeTrayPluginExts<T extends readonly unknown[]> = IMergePluginExts<T>
export type IPluginHostDisposal = IPluginHostDisposalResult
