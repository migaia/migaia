import type { IAbortSignal, ILifecycleScheduler } from '@migaia/lifecycle'
import type { IComputedValue, IRuntime } from '@migaia/reactive/runtime'
import type { IKeyValueStore, IStorageChange } from '@migaia/storage-contract'
import type { IPlugin, IMergePluginExts } from '@migaia/plugin-host'

/** Module-private brand authority for exact backend-kind tokens. */
const storageBackendKindBrand: unique symbol = Symbol('storage-web/backend-kind')
/** Module-private brand authority for backend plugin handles. */
const storageBackendPluginBrand: unique symbol = Symbol('storage-web/backend-plugin')
/** Module-private brand authority for plugin-to-kind identity. */
const storageBackendPluginKindBrand: unique symbol = Symbol('storage-web/backend-plugin-kind')
/** Module-private brand authority for reactive capability presence. */
const storageBackendReactiveBrand: unique symbol = Symbol('storage-web/backend-reactive')
/** Module-private carrier keeps Plugin extensions distinct from the installed Store. */
export declare const storageBackendPluginExtensionsBrand: unique symbol

/** Opaque backend identity whose store binding cannot be forged by object literals. */
export type IStorageBackendKind<TName extends string, TStore extends IKeyValueStore> = {
  readonly name: TName
  readonly [storageBackendKindBrand]: TStore
}

/** Reactive source metadata consumed only by the Host adapter materializer. */
export type IStorageReactiveSourceDisposer = () => void | Promise<void>

/** Exact store/context passed to an advanced adapter source at synchronous admission. */
export type IStorageReactiveSubscribeContext<TStore extends IKeyValueStore = IKeyValueStore> = {
  readonly store: TStore
  /** Host-snapshotted scheduler shared with source timing and installation deadlines. */
  readonly scheduler: ILifecycleScheduler
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
export type IStorageBackendPluginHandle<
  TExtensions extends object = Record<never, never>,
  TStore extends IKeyValueStore = IKeyValueStore
> = {
  readonly id: string
  readonly [storageBackendPluginBrand]: TStore
  readonly [storageBackendPluginKindBrand]: unknown
  readonly [storageBackendReactiveBrand]: boolean
  readonly [storageBackendPluginExtensionsBrand]: TExtensions
}

/** Exact backend plugin handle returned by a definition factory. */
export type IStorageBackendPlugin<
  TStore extends IKeyValueStore,
  TBackendKind extends IStorageBackendKind<string, IKeyValueStore>,
  TId extends string,
  TReactive extends boolean = false,
  TExtensions extends object = Record<never, never>
> = IStorageBackendPluginHandle<TExtensions, TStore> & {
  readonly id: TId
  readonly [storageBackendPluginBrand]: TStore
  readonly [storageBackendPluginKindBrand]: TBackendKind
  readonly [storageBackendReactiveBrand]: TReactive
}

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

/** Adapts Storage's opaque extension carrier to PluginHost's canonical merger. */
type IStoragePluginExtensionCarrier<TPlugin> = TPlugin extends {
  readonly [storageBackendPluginExtensionsBrand]: infer TExtensions extends object
}
  ? TExtensions extends Record<string, unknown>
    ? IPlugin<object, TExtensions>
    : IPlugin<object, Record<never, never>>
  : never

export type IStoragePluginExtensions<TPlugin> = IMergePluginExts<
  [IStoragePluginExtensionCarrier<TPlugin>]
> &
  object

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
  TReactiveIds extends keyof TStores & string = never,
  TExtensions extends object = Record<never, never>
> = {
  readonly extensions: Readonly<TExtensions>
  use<const TPlugins extends readonly IStorageBackendPluginHandle[]>(
    ...plugins: IRejectInstalledOrDuplicateIds<TStores, TPlugins>
  ): Promise<
    IStorageHost<
      TStores & IPluginStoreMap<TPlugins>,
      TReactiveIds | IStoragePluginReactiveId<TPlugins[number]>,
      TExtensions & IStoragePluginExtensions<TPlugins[number]>
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
  TReactiveIds extends keyof TStores & string = never,
  TExtensions extends object = Record<never, never>
> = IStorageHostBase<TStores, TReactiveIds, TExtensions> &
  ([TReactiveIds] extends [never]
    ? Record<never, never>
    : IStorageHostReactiveApi<TStores, TReactiveIds>)
