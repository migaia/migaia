import type { IAbortSignal, ILifecycleScheduler } from '@migaia/lifecycle'
import type { IComputedValue, IRuntime } from '@migaia/reactive/runtime'
import type { IKeyValueStore, IStorageChange } from '@migaia/storage-contract'

/** Module-private brand authority for exact backend-kind tokens. */
const storageBackendKindBrand: unique symbol = Symbol('storage-web/backend-kind')
/** Module-private brand authority for backend plugin handles. */
const storageBackendPluginBrand: unique symbol = Symbol('storage-web/backend-plugin')
/** Module-private brand authority for plugin-to-kind identity. */
const storageBackendPluginKindBrand: unique symbol = Symbol('storage-web/backend-plugin-kind')
/** Module-private brand authority for reactive capability presence. */
const storageBackendReactiveBrand: unique symbol = Symbol('storage-web/backend-reactive')
/** Module-private brand authority for exact feature descriptors. */
const storageBackendFeatureBrand: unique symbol = Symbol('storage-web/backend-feature')

/** Opaque backend identity whose store binding cannot be forged by object literals. */
export type IStorageBackendKind<TName extends string, TStore extends IKeyValueStore> = {
  readonly name: TName
  readonly [storageBackendKindBrand]: TStore
}

/** Derives the exact store type bound to a backend kind token. */
export type IStorageBackendKindStore<
  TBackendKind extends IStorageBackendKind<string, IKeyValueStore>
> = TBackendKind extends IStorageBackendKind<string, infer TStore> ? TStore : never

/** Feature descriptor with a private exact-kind and capability binding. */
export type IStorageBackendFeature<
  TStore extends IKeyValueStore,
  TBackendKind extends IStorageBackendKind<string, IKeyValueStore>,
  TCapability extends string
> = {
  readonly [storageBackendFeatureBrand]: {
    readonly store: TStore
    readonly backendKind: TBackendKind
    readonly capability: TCapability
  }
}

/** Reactive source metadata consumed only by the Host adapter materializer. */
export type IStorageReactiveSourceDisposer = () => void | Promise<void>

/** Exact store/context passed to an advanced adapter source at synchronous admission. */
export type IStorageReactiveSubscribeContext<TStore extends IKeyValueStore = IKeyValueStore> = {
  readonly store: TStore
  readonly signal: IAbortSignal
  readonly report: (error: unknown) => void
  /** Invalidates Resource-owned query generations after an admitted backend change. */
  readonly onChange: (change: IStorageChange) => void
}

/** Reactive consistency and optional D79 source hook retained in private feature metadata. */
export type IStorageReactiveVisibility =
  | 'instance'
  | 'document-eventual'
  | 'top-level-context-eventual'
  | 'origin-js-visible-eventual'
  | 'origin-eventual'

/** Reactive consistency and optional D79 source hook retained in private feature metadata. */
export type IStorageReactiveFeatureMetadata<TStore extends IKeyValueStore = IKeyValueStore> = {
  readonly mode: 'push' | 'hybrid' | 'polling'
  readonly visibility: IStorageReactiveVisibility
  readonly pollIntervalMs?: number
  readonly subscribe?: (
    context: IStorageReactiveSubscribeContext<TStore>
  ) => IStorageReactiveSourceDisposer | PromiseLike<unknown>
}

/** Publicly consumable backend plugin identity shell; runtime metadata stays in WeakMaps. */
export type IStorageBackendPluginHandle = {
  readonly id: string
  readonly [storageBackendPluginBrand]: IKeyValueStore
  readonly [storageBackendPluginKindBrand]: unknown
  readonly [storageBackendReactiveBrand]: boolean
}

/** Exact backend plugin handle returned by a definition factory. */
export type IStorageBackendPlugin<
  TStore extends IKeyValueStore,
  TBackendKind extends IStorageBackendKind<string, IKeyValueStore>,
  TId extends string,
  TReactive extends boolean = false
> = IStorageBackendPluginHandle & {
  readonly id: TId
  readonly [storageBackendPluginBrand]: TStore
  readonly [storageBackendPluginKindBrand]: TBackendKind
  readonly [storageBackendReactiveBrand]: TReactive
}

/** Store creation context reserved for the later materialization slice. */
export type IStorageBackendPluginContext = {
  readonly signal: IAbortSignal
  readonly report: (error: unknown) => void
}

/** Optional preparation hook that runs after the synchronous store is lifecycle-registered. */
export type IStorageBackendPluginPrepare<TStore extends IKeyValueStore> = (
  store: TStore,
  context: IStorageBackendPluginContext
) => void | PromiseLike<void>

/** Immutable backend definition captured before topology admission. */
export type IStorageBackendPluginDefinition<
  TStore extends IKeyValueStore,
  TBackendKind extends IStorageBackendKind<string, IKeyValueStore>,
  TId extends string,
  TFeatures extends readonly IStorageBackendFeature<TStore, TBackendKind, string>[]
> = {
  readonly backendKind: TBackendKind
  readonly id: TId
  readonly timeoutMs?: number
  readonly features?: TFeatures
  readonly create: (context: IStorageBackendPluginContext) => TStore | PromiseLike<TStore>
  readonly prepare?: IStorageBackendPluginPrepare<TStore>
}

/** Capability name extracted from one exact feature descriptor. */
export type IFeatureCapability<TFeature> = TFeature extends {
  readonly [storageBackendFeatureBrand]: { readonly capability: infer TCapability extends string }
}
  ? TCapability
  : never

/** Exact reactive capability result for a feature tuple. */
export type IFeaturesEnableReactive<TFeatures extends readonly unknown[]> =
  string extends IFeatureCapability<TFeatures[number]>
    ? false
    : 'reactive' extends IFeatureCapability<TFeatures[number]>
      ? true
      : false

/** Plugin ID extracted from an admitted plugin tuple. */
export type IStoragePluginId<TPlugin> = TPlugin extends {
  readonly id: infer TId extends string
}
  ? IIsSingletonString<TId> extends true
    ? TId
    : never
  : never

/** Store type extracted from an admitted plugin tuple. */
export type IStoragePluginStore<TPlugin> = TPlugin extends {
  readonly [storageBackendPluginBrand]: infer TStore extends IKeyValueStore
}
  ? TStore
  : never

/** Reactive backend IDs extracted without widening unknown feature tuples. */
export type IStoragePluginReactiveId<TPlugin> = TPlugin extends {
  readonly id: infer TId extends string
  readonly [storageBackendReactiveBrand]: true
}
  ? IIsSingletonString<TId> extends true
    ? TId
    : never
  : never

/** Returns true only for one literal string, excluding unions and the widened string type. */
type IIsSingletonString<TValue extends string> = string extends TValue
  ? false
  : IIsUnion<TValue> extends true
    ? false
    : true

/** Detects a union while preserving distributive conditional behavior for plugin tuples. */
type IIsUnion<TValue, TWhole = TValue> = TValue extends unknown
  ? [TWhole] extends [TValue]
    ? false
    : true
  : never

/** Maps a plugin tuple into its exact ID-to-store registry. */
export type IPluginStoreMap<TPlugins extends readonly IStorageBackendPluginHandle[]> = {
  readonly [TPlugin in TPlugins[number] as IStoragePluginId<TPlugin>]: IStoragePluginStore<TPlugin>
}

/** Rejects duplicate IDs in a literal plugin tuple and IDs already installed in the host. */
export type IRejectInstalledOrDuplicateIds<
  TStores extends Record<string, IKeyValueStore>,
  TPlugins extends readonly IStorageBackendPluginHandle[]
> =
  Extract<IStoragePluginId<TPlugins[number]>, keyof TStores & string> extends never
    ? IHasDuplicatePluginIds<TPlugins> extends true
      ? never
      : TPlugins
    : never

/** Recursive duplicate-ID detector used only by the Host type shell. */
type IHasDuplicatePluginIds<
  TPlugins extends readonly IStorageBackendPluginHandle[],
  TSeen extends string = never
> = TPlugins extends readonly [infer THead, ...infer TTail]
  ? THead extends { readonly id: infer TId extends string }
    ? TId extends TSeen
      ? true
      : TTail extends readonly IStorageBackendPluginHandle[]
        ? IHasDuplicatePluginIds<TTail, TSeen | TId>
        : false
    : false
  : false

/** Host options captured at construction; scheduler ownership remains lifecycle-owned. */
export type IStorageHostOptions = {
  /** Bounds one complete plugin installation batch; defaults to 30 seconds. */
  readonly installTimeoutMs?: number
  /** Supplies deterministic lifecycle time for installation, rollback, and cleanup. */
  readonly scheduler?: ILifecycleScheduler
  /**
   * Receives contained late rejection and cleanup diagnostics without replacing the primary
   * failure.
   */
  readonly report?: (error: unknown) => void | PromiseLike<void>
}

/** Constructor options preserving literal plugin tuples for exact Host capabilities. */
export type IStorageHostCreateOptions<TPlugins extends readonly IStorageBackendPluginHandle[]> =
  IStorageHostOptions & {
    /** Initial plugin tuple installed atomically before the host is returned. */
    readonly plugins?: IRejectInstalledOrDuplicateIds<Record<never, never>, TPlugins>
  }

/** Stable handle shape reserved for the reactive vertical slice. */
export type IReactiveBackendHandle<TStore extends IKeyValueStore, TId extends string> = {
  readonly id: TId
  readonly store: TStore
  liveQuery<T>(
    options: Omit<ILiveQueryOptions<{ readonly [TKey in TId]: TStore }, TId, T>, 'backendId'>
  ): ILiveQuery<T>
}

/** Public live-query state; Resource settlement remains the sole state authority. */
export type ILiveQueryState<T> =
  | { readonly status: 'loading'; readonly value?: T }
  | { readonly status: 'ready'; readonly value: T }
  | { readonly status: 'refreshing'; readonly value: T }
  | { readonly status: 'error'; readonly value?: T; readonly error: unknown }
  | { readonly status: 'disposed'; readonly value?: T; readonly error?: unknown }

/** Non-disposable read-only projection of the same-runtime computed state node. */
export type ILiveQueryStateView<T> = Pick<
  IComputedValue<ILiveQueryState<T>>,
  'runtime' | 'debugName' | 'observed' | 'value' | 'peek'
>

/** Frozen consistency admitted by the installed reactive adapter. */
export type IReactiveConsistency = Readonly<{
  readonly mode: 'push' | 'hybrid' | 'polling'
  readonly pollIntervalMs?: number
  readonly visibility: IStorageReactiveVisibility
}>

/** Non-reactive Host operations shared by every conditional Host view. */
export type IStorageHostBase<
  TStores extends Record<string, IKeyValueStore>,
  TReactiveIds extends keyof TStores & string = never
> = {
  use<const TPlugins extends readonly IStorageBackendPluginHandle[]>(
    ...plugins: IRejectInstalledOrDuplicateIds<TStores, TPlugins>
  ): Promise<
    IStorageHost<
      TStores & IPluginStoreMap<TPlugins>,
      TReactiveIds | IStoragePluginReactiveId<TPlugins[number]>
    >
  >
  backend<TId extends keyof TStores & string>(id: TId): TStores[TId]
  hasBackend(id: string): id is keyof TStores & string
  backends(): ReadonlyMap<keyof TStores & string, TStores[keyof TStores]>
  hasReactiveBackend(id: string): id is TReactiveIds
  reactiveBackend<TId extends keyof TStores & string>(
    id: TId
  ): IReactiveBackendHandle<TStores[TId], TId> | undefined
  reactiveBackend(id: string): IReactiveBackendHandle<IKeyValueStore, string> | undefined
  dispose(): Promise<void>
}

/** Minimal live-query handle shell reserved for the reactive vertical slice. */
export type ILiveQuery<T> = {
  readonly state: ILiveQueryStateView<T>
  readonly consistency: IReactiveConsistency
  readonly ready: Promise<void>
  refresh(): Promise<void>
  dispose(): Promise<void>
}

/** Query input shell retaining the exact backend ID and store type. */
export type ILiveQueryOptions<
  TStores extends Record<string, IKeyValueStore>,
  TBackendId extends keyof TStores & string,
  T
> = {
  readonly backendId: TBackendId
  readonly runtime: IRuntime
  readonly query: (context: {
    readonly store: TStores[TBackendId]
    readonly signal: IAbortSignal
    readonly scope?: string
  }) => T | PromiseLike<T>
  /** Optional entity scope used only to prove that an invalidation cannot be unrelated. */
  readonly scope?: string
  /** Optional change predicate; failures are reported and conservatively refresh the query. */
  readonly matches?: (change: IStorageChange) => boolean
  /** Preserve the last visible value while Resource refreshes in the background. */
  readonly keepPreviousData?: boolean
  /** Compare settled values before replacing the visible value projection. */
  readonly equals?: (previous: T, next: T) => boolean
  /** Per-generation deadline, driven by the Host scheduler. */
  readonly timeoutMs?: number
  /** External cancellation for the whole query instance. */
  readonly signal?: IAbortSignal
  /** Report-only sink for stale settlement and cleanup failures. */
  readonly report?: (error: unknown) => void | PromiseLike<void>
}

/** Reactive API is conditionally intersected only when a reactive ID is known. */
export type IStorageHostReactiveApi<
  TStores extends Record<string, IKeyValueStore>,
  TReactiveIds extends keyof TStores & string
> = {
  liveQuery<TBackendId extends TReactiveIds, _T>(
    options: ILiveQueryOptions<TStores, TBackendId, _T>
  ): ILiveQuery<_T>
}

/** Conditional Host type shell preserving exact backend IDs and reactive capability honesty. */
export type IStorageHost<
  TStores extends Record<string, IKeyValueStore>,
  TReactiveIds extends keyof TStores & string = never
> = IStorageHostBase<TStores, TReactiveIds> &
  ([TReactiveIds] extends [never]
    ? Record<never, never>
    : IStorageHostReactiveApi<TStores, TReactiveIds>)

/** Internal metadata retained by the feature compiler without exposing brands to callers. */
export type IStorageFeatureMetadata = {
  readonly backendKind: IStorageBackendKind<string, IKeyValueStore>
  readonly capability: string
  readonly reactive?: IStorageReactiveFeatureMetadata
}

/** Runtime descriptor envelope consumed by the pure topology adapter. */
export type IStorageFeatureNode = {
  readonly id: string
  readonly dependencies: readonly { readonly provider: string; readonly required: true }[]
  readonly ordinal: number
  readonly materialize: boolean
  readonly feature?: IStorageFeatureMetadata
}

/** Pure compiler result; synthetic providers never appear in materialized output. */
export type IStorageFeatureCompilation = {
  readonly ordered: readonly IStorageFeatureNode[]
  readonly materialized: readonly IStorageFeatureNode[]
}
