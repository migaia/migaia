import type { IBackendRevisionPort } from './backends/revisions.js'
import type { IBackendKeyLockPort } from './backends/key-locks.js'
import type { IStorageHooks, IStorageHookMap } from './hook-types.js'
import type { IStorageHookEmitter } from './hooks.js'
import type {
  IPluginHostCore,
  IPluginRegistrationContext,
  IFeature,
  IFeatureRecord,
  IFeatureDependencyRecord,
  IFeatureOutputs,
  IPlugin,
  IMergePluginExts
} from '@migaia/plugin-host'
import type { IScheduler } from '@migaia/utils/scheduler'
import type { INativeAbortSignal } from '@migaia/utils/promise'
import type {
  IBackendChangeController,
  IBackendChangeControllerOptions,
  IBackendValueCommit
} from './core/change-controller.js'
import type {
  IOperationContext,
  ILockKey,
  IStorageBase,
  IStorageStore,
  ICapabilityImpl,
  ICapabilityStore,
  IStorageCapabilitySet,
  IStorageImplementationsOf,
  IChainMethods,
  IChainMethodsOf,
  IWithTransactionQueryMethods,
  IWithChainMethods,
  IAnyStorageCapability,
  ICapabilityApi,
  ITransactionBuilder,
  IOptimisticTransactionBuilder,
  ICapabilityInstallPort,
  IBackendStageBindings,
  ICodecStageObserver,
  IQueryStageObserver,
  ITransactionStageObserver,
  IConcurrencyStageObserver,
  IBackendStageObserver,
  ISqlStageObserver,
  IStorageOperationStageObserver,
  IMigrationStepObserver
} from '@migaia/storage-contract'
/** Envelope boundaries observe the original migration plan and retain no archive or state. */
export type IStorageEnvelopeStages = {
  beforeEnvelopeCheck(): void
  afterEnvelopeCheck(version: number): void
  onVersionRejected(version?: number, code?: string): void
  afterMigrate(version: number, mode: 'steps' | 'reset', stepCount: number, elapsedMs: number): void
  readonly observe: IMigrationStepObserver
}
/** Requests forward typed inputs to the original pipeline without owning its stages. */
export type IStorageExecutionRequest<TInput> = Readonly<{
  operation: string
  input: TInput
  ctx?: IOperationContext
  scope?: object
  /** Original backend facts, evaluated only when telemetry emits its completed endpoint. */
  keys?: () => readonly ILockKey[]
  /** Private journal work or a child already covered by its original public boundary. */
  internal?: true
}>
/** The storage boundary requires the terminal to run; intercepted operations reject as aborted. */
export type IStorageExecutionPort = {
  /** Observe the original complete retry loop without running or registering another pipeline. */
  observe?<TResult>(
    describe: () => IStorageExecutionRequest<unknown>,
    invoke: (observing: boolean) => Promise<TResult>
  ): Promise<TResult>
  run<TInput, TResult>(
    request: IStorageExecutionRequest<TInput>,
    invoke: (input: TInput) => Promise<TResult>
  ): Promise<TResult>
  runSync<TInput, TResult>(
    request: IStorageExecutionRequest<TInput>,
    invoke: (input: TInput) => TResult
  ): TResult
}
/** Type carrier mirrors private kind identity without granting it. */
declare const storageBackendKindBrand: unique symbol
/** Retain a Feature target while runtime identity remains private. */
declare const storageFeatureTargetBrand: unique symbol
/** Preserve the actual installed backend and selected roots in declarations. */
declare const storageBackendPluginBrand: unique symbol
export type IStorageBackendKind<
  TName extends string = string,
  TStore extends IStorageBase = IStorageBase,
  TClient = unknown,
  TExpose extends object = {}
> = {
  readonly name: TName
  readonly [storageBackendKindBrand]: {
    readonly store: TStore
    readonly client: TClient
    readonly expose: TExpose
  }
}
export type IStorageKindStore<K extends IStorageBackendKind> =
  K[typeof storageBackendKindBrand]['store']
export type IStorageKindClient<K extends IStorageBackendKind> =
  K[typeof storageBackendKindBrand]['client']
export type IStorageKindExpose<K extends IStorageBackendKind> =
  K[typeof storageBackendKindBrand]['expose']
export type IStorageFeatureTarget =
  | IStorageBackendKind
  | readonly [IStorageBackendKind, ...IStorageBackendKind[]]
/** Borrowing retains the admitted store surface without lifecycle ownership. */
export type IStorageBorrowedBackend<S extends IStorageBase = IStorageStore<never>> = Omit<
  S,
  'dispose' | typeof Symbol.asyncDispose | 'use' | 'has'
> & {
  use<TCap extends IAnyStorageCapability>(capability: TCap): ICapabilityApi<TCap>
  has(capability: IAnyStorageCapability): boolean
}

/** Borrow only earlier committed backends during the original installation window. */
export type IStorageBorrowPort = {
  getPublishedBackend(id: string): IStorageBorrowedBackend
  readonly emit: IStorageHookEmitter
}

/** The original registration binds each invocation to its org and captured dependencies. */
export type IStoragePluginCallContext = {
  readonly orgId: string
  backend<S extends IStorageBorrowedBackend>(borrowed: S): S
}
/** Native organization projection remains owned by the exact installed backend registration. */
export type IStorageOrgBinding = {
  backend(orgId: string): IStorageBase
  drop(orgId: string): Promise<void>
}
/** Optional native Feature routing stays with the original backend and exact organization. */
export type IStorageFeatureClientResolver<TClient = unknown, TTransactionClient = unknown> = {
  /** Prepare and return this organization's original client; synchronous clients remain synchronous. */
  getClient(orgId: string): TClient | PromiseLike<TClient>
  /** Return the already-active original transaction synchronously, without opening or awaiting. */
  getTransactionClient?(scope: object, orgId: string): TTransactionClient
}
/** Read-only invocation ports retain one immutable organization without installation authority. */
export type IStorageBackendOrgContext = {
  readonly journal?: import('./journal/types.js').IStorageJournalExecutionPort
  readonly orgId: string
  readonly execution: IStorageExecutionPort
  readonly stageBindings: IBackendStageBindings
  readonly callContext: IStoragePluginCallContext
  createTransactionApi(scope: object): object | undefined
}
/** Installation-captured authority for physical org children, held only by their backend author. */
export type IStorageOrgAuthoringPort = Pick<
  IStoragePluginCore,
  | 'createChangeController'
  | 'createKeyLockPort'
  | 'createRevisionPort'
  | 'registerChangeController'
  | 'registerValueCommit'
>
type ITargetKind<T extends IStorageFeatureTarget> = T extends readonly IStorageBackendKind[]
  ? T[number]
  : T extends IStorageBackendKind
    ? T
    : never
export type IStorageFeatureExpose<K extends IStorageBackendKind> = K extends IStorageBackendKind
  ? Readonly<{
      getKind(): K
      getStore(): IStorageKindStore<K>
      getClient(): IStorageKindClient<K>
      getChangeController(): IBackendChangeController | undefined
      getBackendId(): string
      getLifecycle(): IPluginRegistrationContext
      onDispose: IPluginHostCore['onDispose']
      getScheduler(): IScheduler
      getPublishedBackend: IStorageBorrowPort['getPublishedBackend']
      emit: IStorageHookEmitter
      registerDetect(check: (signal: INativeAbortSignal) => Promise<void>): void
    }> &
      IStorageKindExpose<K>
  : never
type IStorageMethodExpose<E extends object> = {
  [P in keyof E]: P extends string
    ? Exclude<E[P], undefined> extends (...args: never[]) => unknown
      ? E[P]
      : never
    : never
}
export type IStorageDescriptorFeatureExpose<K extends IStorageBackendKind> = Readonly<{
  getClient(): IStorageKindClient<K>
  getChangeController?: never
  getKind?: never
  getStore?: never
  getBackendId?: never
  getLifecycle?: never
  onDispose?: never
  getScheduler?: never
  getPublishedBackend?: never
  emit?: never
  registerDetect?: never
}> &
  IStorageKindExpose<K> &
  IStorageMethodExpose<IStorageKindExpose<K>>
type ITransactionClientGetter<K extends IStorageBackendKind> =
  IStorageKindExpose<K> extends { getTransactionClient: infer G }
    ? Extract<G, (...args: never[]) => unknown>
    : never
export type IStorageKindTransactionClient<K extends IStorageBackendKind> = ReturnType<
  ITransactionClientGetter<K>
>
export type IStorageKindTransactionScope<K extends IStorageBackendKind> = Parameters<
  ITransactionClientGetter<K>
>[0]
type IWithoutTransactionClient<K> = K extends IStorageBackendKind
  ? [ITransactionClientGetter<K>] extends [never]
    ? K
    : never
  : never
export type IStorageFeatureCallContext<TClient, TStore, TScope = undefined> = Readonly<{
  client: TClient
  store: TScope extends undefined ? TStore : TScope
  scope: TScope
}> &
  IStoragePluginCallContext
export type IStorageFeatureApiGroup = {
  readonly [name: string]: ((...args: never[]) => Promise<unknown>) | IStorageFeatureApiGroup
}
type IContextualApiGroup<A, C> = {
  [K in keyof A]: A[K] extends (...args: never[]) => Promise<unknown>
    ? A[K]
    : A[K] extends object
      ? IContextualApiGroup<A[K], C>
      : never
} & ThisType<C>
export type IStorageFeatureApi = {
  readonly store: IStorageFeatureApiGroup
  readonly transaction: IStorageFeatureApiGroup
}
export type IStorageFeatureOutput<
  C extends readonly ICapabilityImpl[] = readonly ICapabilityImpl[],
  M extends IChainMethods = IChainMethods,
  A extends IStorageFeatureApi = IStorageFeatureApi
> = { readonly capabilities: C; readonly chain: M; readonly api: A }
type IInvalidMethods<C> = {
  [G in keyof C]-?: {
    [N in keyof NonNullable<C[G]>]: NonNullable<C[G]>[N] extends (...args: never[]) => unknown
      ? never
      : N
  }[keyof NonNullable<C[G]>]
}[keyof C]
type IExactOutput<O extends IStorageFeatureOutput> = Record<
  Exclude<keyof O, keyof IStorageFeatureOutput>,
  never
> & {
  readonly chain: O['chain'] & Record<Exclude<keyof O['chain'], keyof IChainMethods>, never>
  readonly api: O['api'] & Record<Exclude<keyof O['api'], keyof IStorageFeatureApi>, never>
} & ([IInvalidMethods<O['chain']>] extends [never]
    ? unknown
    : { readonly storageFeatureChainMustBeMethods: never }) &
  (O extends PromiseLike<unknown> ? never : unknown)
type IContextualApi<T extends IStorageFeatureTarget, O extends IStorageFeatureOutput> = {
  readonly store: O['api']['store'] &
    IContextualApiGroup<
      O['api']['store'],
      IStorageFeatureCallContext<
        IStorageKindClient<ITargetKind<T>>,
        IStorageKindStore<ITargetKind<T>>
      >
    >
  readonly transaction: O['api']['transaction'] &
    IContextualApiGroup<
      O['api']['transaction'],
      IStorageFeatureCallContext<
        IStorageKindTransactionClient<ITargetKind<T>>,
        IStorageKindStore<ITargetKind<T>>,
        IStorageKindTransactionScope<ITargetKind<T>>
      >
    >
}
type ITransactionApiCompatibility<
  T extends IStorageFeatureTarget,
  O extends IStorageFeatureOutput
> = keyof O['api']['transaction'] extends never
  ? unknown
  : [IWithoutTransactionClient<ITargetKind<T>>] extends [never]
    ? unknown
    : { readonly storageFeatureTransactionClientMissing: never }
export type IStorageFeature<
  T extends IStorageFeatureTarget = IStorageFeatureTarget,
  O extends IStorageFeatureOutput = IStorageFeatureOutput,
  D extends IFeatureDependencyRecord = IFeatureDependencyRecord
> = IFeature<IStorageFeatureExpose<ITargetKind<T>>, O, D> & {
  readonly [storageFeatureTargetBrand]: ITargetKind<T>
}
export type IStorageFeatureRecord = Readonly<Record<string, IStorageFeature>>
type IDependencyCompatibility<K, D extends IFeatureDependencyRecord> = {
  [N in keyof D]: D[N] extends { readonly [storageFeatureTargetBrand]: infer Target }
    ? [K] extends [Target]
      ? unknown
      : { readonly storageFeatureDependencyBackendKindMismatch: never }
    : { readonly storageFeatureDependencyTargetMissing: never }
}
type IOutput<F> = F extends {
  readonly __feature: { readonly output: infer O extends IStorageFeatureOutput }
}
  ? O
  : never
type IIntersection<U> = (U extends unknown ? (value: U) => void : never) extends (
  value: infer I
) => void
  ? I
  : never
type IFeaturePart<F, K extends keyof IChainMethods> = IOutput<F>['chain'] extends infer C
  ? K extends keyof C
    ? NonNullable<C[K]>
    : {}
  : {}
type IFeatureMethods<F extends IStorageFeatureRecord> = {
  [K in keyof IChainMethods]-?: IIntersection<{ [N in keyof F]: IFeaturePart<F[N], K> }[keyof F]> &
    object
}
type IFeatureApi<
  F extends IStorageFeatureRecord,
  K extends keyof IStorageFeatureApi
> = IIntersection<{ [N in keyof F]: IOutput<F[N]>['api'][K] }[keyof F]> & object
type IFeatureImplementations<F extends IStorageFeatureRecord> = IOutput<
  F[keyof F]
>['capabilities'][number]
export type IStorageFeatureStoreCompatibility<
  K extends IStorageBackendKind,
  F extends IStorageFeatureRecord,
  S extends IStorageBase = IStorageKindStore<K>
> = {
  [N in keyof F]: K extends F[N][typeof storageFeatureTargetBrand]
    ? S extends ReturnType<F[N]['__feature']['expose']['getStore']>
      ? unknown
      : { readonly storageFeatureStoreMustSatisfyRequiredExpose: never }
    : { readonly storageFeatureBackendKindMismatch: never }
}
// Preserve the existing core fields at implementation; this changed-surface projection has no new execution mechanism.
export type IStoragePipelineInput = IStorageExecutionRequest<unknown> &
  Readonly<{ backendId: string; backend: string; orgId: string }>
export type IStoragePluginCore<F extends IStorageFeatureRecord = {}> = Pick<
  IPluginHostCore<IStoragePipelineInput>,
  'operation' | 'lifecycle' | 'onDispose' | 'usePipeline' | 'useAsyncPipeline'
> &
  IStorageBorrowPort & {
    readonly journal?: import('./journal/types.js').IStorageJournalExecutionPort
    readonly defaultOrgId: string
    readonly execution: IStorageExecutionPort
    readonly hooks: IStorageHooks
    readonly stageBindings: IBackendStageBindings
    /** Project selected transaction methods onto the original backend-created view before freeze. */
    createTransactionApi(scope: object): object | undefined
    /** Read installed methods for one actual original fluent creator; omission allocates nothing. */
    getChainMethods(family: keyof IChainMethods): object | undefined
    createKeyLockPort(): IBackendKeyLockPort
    /** Capture the original registration once; lazy org children retain its existing cleanup owner. */
    createOrgAuthoringPort(): IStorageOrgAuthoringPort
    /** Construct revision facts for one physical data universe during this installation window. */
    createRevisionPort(): IBackendRevisionPort
    createChangeController(options: IBackendChangeControllerOptions): IBackendChangeController
    registerChangeController(store: IStorageBase, controller: IBackendChangeController): void
    registerValueCommit(store: IStorageBase, commit: IBackendValueCommit): void
    /** Register immutable physical-org lookup and deletion only for this exact admitted store. */
    registerOrgBinding(store: IStorageBase, binding: IStorageOrgBinding): void
    /** Register optional native Feature routing only during this exact store's installation. */
    registerFeatureClientResolver(
      store: IStorageBase,
      resolver: IStorageFeatureClientResolver
    ): void
    /** Read original execution and observation ports without registration or lifecycle authority. */
    getOrgContext(orgId: string): IStorageBackendOrgContext
    registerDetect(check: (signal: INativeAbortSignal) => Promise<void>): void
    registerStore<S extends IStorageBase>(store: S): void
    getStore(): IStorageBase
    getBackendId(): string
    readonly features: IFeatureOutputs<F>
    readonly featureExpose: IStorageFeatureExpose<IStorageBackendKind>
  }
export type IStorageNativePluginDescriptor<
  K extends IStorageBackendKind = IStorageBackendKind,
  S extends IStorageBase = IStorageBase
> = {
  readonly kind?: K
  /** Opt selected top-level API objects into one-level org binding; ordinary data stays unchanged. */
  readonly contextualExtensions?: readonly string[]
  install?():
    | (object & ThisType<IStoragePluginCallContext>)
    | PromiseLike<object & ThisType<IStoragePluginCallContext>>
  expose?(): Record<string, unknown> & ThisType<IStoragePluginCallContext>
  featureExpose?(): object
  capabilityInstaller?(store: S): ICapabilityInstallPort
  /** Capture original private journal I/O once after this exact store is admitted. */
  journalBinding?(store: S): import('./journal/types.js').IStorageJournalBackendBinding
}
export declare const storageBackendPluginExtensionsBrand: unique symbol
/** Only explicitly selected finite API objects omit the host-supplied method receiver. */
type IStorageContextualExtensions<D, E> = {
  [K in keyof E]: D extends { readonly contextualExtensions: readonly string[] }
    ? K extends D['contextualExtensions'][number]
      ? E[K] extends object
        ? { [M in keyof E[K]]: OmitThisParameter<E[K][M]> }
        : E[K]
      : E[K]
    : E[K]
}
export type IStorageNativePluginExtensions<D extends IStorageNativePluginDescriptor> =
  IStorageContextualExtensions<
    D,
    (D extends {
      readonly install?: () => infer R
    }
      ? Awaited<R> extends object
        ? Awaited<R>
        : {}
      : {}) &
      (D extends { readonly expose?: () => infer R } ? (R extends object ? R : {}) : {})
  >
type IStoragePluginExtensionCarrier<P> = P extends {
  readonly [storageBackendPluginExtensionsBrand]: infer E extends object
}
  ? E extends Record<string, unknown>
    ? IPlugin<object, E>
    : IPlugin<object, {}>
  : never
export type IStoragePluginExtensions<P> = {
  [K in keyof IMergePluginExts<[IStoragePluginExtensionCarrier<P>]>]: OmitThisParameter<
    IMergePluginExts<[IStoragePluginExtensionCarrier<P>]>[K]
  >
} & object
type IDescriptorStore<D extends IStorageNativePluginDescriptor> =
  D['capabilityInstaller'] extends infer P
    ? NonNullable<P> extends (store: infer S extends IStorageBase) => unknown
      ? S
      : IStorageBase
    : IStorageBase
type IDescriptorCompatibility<
  D extends IStorageNativePluginDescriptor & {
    readonly kind: IStorageBackendKind
    featureExpose(): object
  }
> =
  ReturnType<D['featureExpose']> extends IStorageDescriptorFeatureExpose<D['kind']>
    ? unknown
    : { readonly storageFeatureExposeMismatch: never }
export type IStorageBackendPluginHandle<
  E extends object = {},
  S extends IStorageBase = IStorageBase
> = {
  readonly id: string
  readonly [storageBackendPluginBrand]: { readonly store: S }
  readonly [storageBackendPluginExtensionsBrand]: E
}
export type IStorageBackendPlugin<
  K extends IStorageBackendKind = IStorageBackendKind,
  N extends string = string,
  F extends IStorageFeatureRecord = {},
  S extends IStorageBase = IStorageKindStore<K>
> = IStorageBackendPluginHandle<{}, S> & {
  readonly id: N
  readonly [storageBackendPluginBrand]: {
    readonly kind: K
    readonly features: F
    readonly store: S
  }
}
// Only the capability provider owns capability brands. These helpers are public, type-only contract projections.
type IWithFeatureCapabilities<S extends IStorageBase, F extends IStorageFeatureRecord> = [
  IFeatureImplementations<F>
] extends [never]
  ? S
  : ICapabilityStore<
      S,
      IStorageCapabilitySet<S> | IFeatureImplementations<F>['capability'],
      readonly (IStorageImplementationsOf<S>[number] | IFeatureImplementations<F>)[]
    >
type IFeatureChainKeys<F extends IStorageFeatureRecord> = {
  [N in keyof F]: keyof IOutput<F[N]>['chain']
}[keyof F]
type IWithFeatureChains<S extends IStorageBase, F extends IStorageFeatureRecord> = [
  IFeatureChainKeys<F>
] extends [never]
  ? IWithFeatureCapabilities<S, F>
  : IWithFeatureCapabilities<S, F> extends infer T extends IStorageStore<never>
    ? IWithChainMethods<T, IChainMethodsOf<S> & IFeatureMethods<F>>
    : never
/** Read only the existing selected query group carried by the original enhanced store. */
type IScopeQueryMethods<S> = 'query' extends keyof IChainMethodsOf<S>
  ? NonNullable<IChainMethodsOf<S>['query']>
  : Record<never, never>
/** RDF augmentation remains separate from the record query family. */
type IScopeRdfMethods<S> = 'rdf' extends keyof IChainMethodsOf<S>
  ? NonNullable<IChainMethodsOf<S>['rdf']>
  : Record<never, never>
/** Scope query methods retain transaction-only context while native top-level members survive. */
type IScopeApi<S, F extends IStorageFeatureRecord, Q extends object, R extends object> =
  IWithTransactionQueryMethods<S, Q, R> extends infer T
    ? keyof IFeatureApi<F, 'transaction'> extends never
      ? T
      : Omit<T, 'api'> & { readonly api: IFeatureApi<F, 'transaction'> }
    : never
type IApiTransactionMembers<S, F extends IStorageFeatureRecord> = [
  keyof IFeatureApi<F, 'transaction'> | keyof IScopeQueryMethods<S> | keyof IScopeRdfMethods<S>
] extends [never]
  ? Pick<S, Extract<keyof S, 'transaction' | 'tx'>>
  : S extends { transaction(run: (scope: infer T) => unknown, options?: infer O): unknown }
    ? {
        transaction<R>(
          run: (scope: IScopeApi<T, F, IScopeQueryMethods<S>, IScopeRdfMethods<S>>) => R,
          options?: O
        ): Promise<Awaited<R>>
      } & (S extends { tx(): IOptimisticTransactionBuilder<infer T, infer A> }
        ? {
            tx(): IOptimisticTransactionBuilder<
              IScopeApi<T, F, IScopeQueryMethods<S>, IScopeRdfMethods<S>>,
              A
            >
          }
        : S extends { tx(): ITransactionBuilder<infer T, infer A> }
          ? {
              tx(): ITransactionBuilder<
                IScopeApi<T, F, IScopeQueryMethods<S>, IScopeRdfMethods<S>>,
                A
              >
            }
          : {})
    : {}
export type IStorageStoreWithFeatures<
  S extends IStorageBase,
  F extends IStorageFeatureRecord,
  T = IWithFeatureChains<S, F>
> = keyof F extends never
  ? S
  : Omit<T, 'api' | 'transaction' | 'tx'> & {
      readonly api: IFeatureApi<F, 'store'>
    } & IApiTransactionMembers<T, F>
type IPluginStore<P> =
  P extends IStorageBackendPlugin<infer _K, string, infer F, infer S>
    ? IStorageStoreWithFeatures<S, F>
    : never

/**
 * The original tuple is mapped once; stores retain their exact public capability and Feature
 * surface.
 */
export type IPluginStoreMap<P extends readonly IStorageBackendPluginHandle[]> = {
  readonly [V in P[number] as IPluginStore<V> extends never
    ? never
    : IStoragePluginId<V>]: IPluginStore<V>
}
/** Return one literal plugin id, excluding widened names and unions. */
export type IStoragePluginId<P> = P extends { readonly id: infer N extends string }
  ? IIsSingletonString<N> extends true
    ? N
    : never
  : never
/** Detect widened unions without turning plugin data into runtime authority. */
type IIsUnion<T, W = T> = T extends unknown ? ([W] extends [T] ? false : true) : never
/** Only literal names can contribute statically known stores. */
type IIsSingletonString<T extends string> = string extends T
  ? false
  : IIsUnion<T> extends true
    ? false
    : true
/** Static duplicate rejection mirrors the original runtime batch check. */
type IHasDuplicatePluginIds<
  P extends readonly IStorageBackendPluginHandle[],
  Seen extends string = never
> = P extends readonly [infer H, ...infer R]
  ? H extends { readonly id: infer N extends string }
    ? N extends Seen
      ? true
      : R extends readonly IStorageBackendPluginHandle[]
        ? IHasDuplicatePluginIds<R, Seen | N>
        : false
    : false
  : false
/** Reject a new tuple that collides with an installed literal id. */
export type IRejectInstalledOrDuplicateIds<
  Installed extends object,
  P extends readonly IStorageBackendPluginHandle[]
> =
  Extract<IStoragePluginId<P[number]>, keyof Installed & string> extends never
    ? IHasDuplicatePluginIds<P> extends true
      ? never
      : P
    : never
/** Construction captures timing and diagnostic ownership before a plugin runs. */
export type IStorageHostOptions = {
  readonly journal?: import('./journal/types.js').IStorageJournalConfiguration
  readonly org?: string
  readonly autoDetect?: boolean
  readonly installTimeoutMs?: number
  readonly scheduler?: IScheduler
  readonly report?: (error: unknown) => void | PromiseLike<void>
  readonly hooks?: { readonly [K in keyof IStorageHookMap]?: (payload: IStorageHookMap[K]) => void }
}
/** Exact initial tuple participates in duplicate admission and store inference. */
export type IStorageHostCreateOptions<
  P extends readonly IStorageBackendPluginHandle[],
  J extends import('./journal/types.js').IStorageJournalConfiguration | undefined =
    | import('./journal/types.js').IStorageJournalConfiguration
    | undefined
> = Omit<IStorageHostOptions, 'journal'> & {
  readonly journal?: J
  readonly plugins?: IRejectInstalledOrDuplicateIds<{}, P>
}
/** Only an actual statically selected undo extension adds the public undo business method. */
type IStorageJournalUndoSurface<J> = (
  J extends (...args: never[]) => infer R ? Awaited<R> : J
) extends { readonly logger: import('@migaia/logger/plugins/durable').IUndoLogExt }
  ? import('./journal/types.js').IUndoableStore
  : Record<never, never>
/** Neutral host registry and lifetime; backend implementations remain separate from installation. */
export type IStorageHost<
  P extends readonly IStorageBackendPluginHandle[],
  J extends import('./journal/types.js').IStorageJournalConfiguration | undefined = undefined
> = import('@migaia/storage-contract').IStorageResource & {
  readonly hooks: IStorageHooks
  detect(): Promise<void>
  org(orgId: string): IStorageOrgView<P, J>
  dropOrg(orgId: string): Promise<void>
  codecStages(store: IStorageBase | IStorageBorrowedBackend<IStorageBase>): ICodecStageObserver
  queryStages(store: IStorageBase | IStorageBorrowedBackend<IStorageBase>): IQueryStageObserver
  transactionStages(
    store: IStorageBase | IStorageBorrowedBackend<IStorageBase>
  ): ITransactionStageObserver
  concurrencyStages(
    store: IStorageBase | IStorageBorrowedBackend<IStorageBase>
  ): IConcurrencyStageObserver
  backendStages(store: IStorageBase | IStorageBorrowedBackend<IStorageBase>): IBackendStageObserver
  sqlStages(store: IStorageBase | IStorageBorrowedBackend<IStorageBase>): ISqlStageObserver
  operationStages(
    store: IStorageBase | IStorageBorrowedBackend<IStorageBase>
  ): IStorageOperationStageObserver
  envelopeStages(
    store: IStorageBase | IStorageBorrowedBackend<IStorageBase>,
    operation: Readonly<{ operation: string; targetVersion: number }>
  ): IStorageEnvelopeStages
  readonly extensions: Readonly<IStoragePluginExtensions<P[number]>>
  readonly api: {
    readonly [N in keyof IPluginStoreMap<P>]: IPluginStoreMap<P>[N] extends {
      readonly api: infer A
    }
      ? A
      : undefined
  }
  use<const Next extends readonly IStorageBackendPluginHandle[]>(
    ...plugins: IRejectInstalledOrDuplicateIds<{ [N in IStoragePluginId<P[number]>]: true }, Next>
  ): Promise<IStorageHost<readonly [...P, ...Next], J>>
  backend<N extends keyof IPluginStoreMap<P> & string>(
    id: N
  ): IPluginStoreMap<P>[N] & IStorageJournalUndoSurface<J>
  hasBackend(id: string): id is keyof IPluginStoreMap<P> & string
  backends(): ReadonlyMap<
    keyof IPluginStoreMap<P> & string,
    IPluginStoreMap<P>[keyof IPluginStoreMap<P>] & IStorageJournalUndoSurface<J>
  >
}

/** A business view retains inference while lifecycle and installation stay with its root host. */
export type IStorageOrgView<
  P extends readonly IStorageBackendPluginHandle[],
  J extends import('./journal/types.js').IStorageJournalConfiguration | undefined = undefined
> = Omit<
  IStorageHost<P, J>,
  'use' | 'dropOrg' | 'dispose' | typeof Symbol.asyncDispose | 'backend' | 'backends' | 'org'
> & {
  readonly orgId: string
  org(orgId: string): IStorageOrgView<P, J>
  backend<N extends keyof IPluginStoreMap<P> & string>(
    id: N
  ): IStorageBorrowedBackend<IPluginStoreMap<P>[N] & IStorageJournalUndoSurface<J>>
  backends(): ReadonlyMap<
    keyof IPluginStoreMap<P> & string,
    IStorageBorrowedBackend<
      IPluginStoreMap<P>[keyof IPluginStoreMap<P>] & IStorageJournalUndoSurface<J>
    >
  >
}

/** Keeps higher-order factory inference in the defining module. */
export type IStorageDefinePlugin = {
  <
    const N extends string,
    const Factory extends (core: IStoragePluginCore<F>) => IStorageNativePluginDescriptor & {
      readonly kind: IStorageBackendKind
      featureExpose(): object
    },
    const F extends IStorageFeatureRecord = {}
  >(
    name: N,
    descriptorFactory: Factory & IDescriptorCompatibility<ReturnType<NoInfer<Factory>>>,
    features?: F &
      IStorageFeatureStoreCompatibility<
        ReturnType<NoInfer<Factory>>['kind'],
        NoInfer<F>,
        IDescriptorStore<ReturnType<NoInfer<Factory>>>
      >
  ): IStorageBackendPlugin<
    ReturnType<Factory>['kind'],
    N,
    F,
    IDescriptorStore<ReturnType<Factory>>
  > & {
    readonly [storageBackendPluginExtensionsBrand]: IStorageNativePluginExtensions<
      ReturnType<Factory>
    >
  }
  <
    const N extends string,
    const Factory extends (
      core: Pick<
        IStoragePluginCore,
        | 'operation'
        | 'lifecycle'
        | 'onDispose'
        | 'usePipeline'
        | 'useAsyncPipeline'
        | 'execution'
        | 'defaultOrgId'
        | 'hooks'
        | 'emit'
        | 'registerDetect'
        | 'getPublishedBackend'
        | 'createChangeController'
        | 'getOrgContext'
      > & { readonly features: IFeatureOutputs<F> }
    ) => IStorageNativePluginDescriptor & { readonly kind?: never },
    const F extends IFeatureRecord = {}
  >(
    name: N,
    descriptorFactory: Factory,
    features?: F
  ): IStorageBackendPluginHandle<IStorageNativePluginExtensions<ReturnType<Factory>>> & {
    readonly id: N
  }
}
/** Backend Features retain the exact target, dependencies and contextual API receiver. */
export type IStorageDefineFeature = <
  const T extends IStorageFeatureTarget,
  const D extends IFeatureDependencyRecord = {},
  O extends IStorageFeatureOutput = IStorageFeatureOutput
>(
  target: T,
  factory: (
    core: { readonly featureExpose: IStorageFeatureExpose<ITargetKind<T>> },
    dependencies: IFeatureOutputs<D>
  ) => O &
    IExactOutput<NoInfer<O>> &
    ITransactionApiCompatibility<T, O> & { readonly api: IContextualApi<T, O> },
  dependencies?: D & IDependencyCompatibility<ITargetKind<T>, NoInfer<D>>
) => IStorageFeature<T, O, D>
