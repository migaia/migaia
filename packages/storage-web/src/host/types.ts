import type { IAbortSignal, INativeAbortSignal } from '@migaia/utils/promise'
import type { IScheduler } from '@migaia/utils/scheduler'
import type { IReactiveComputed, IRuntime } from '@migaia/reactive'
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
  /**
   * Stable descriptive backend-kind name; only the original opaque token carries matching
   * authority.
   */
  readonly name: TName
  readonly [storageBackendKindBrand]: TStore
}

/** Reactive source metadata consumed only by the Host adapter materializer. */
export type IStorageReactiveSourceDisposer = () => void | Promise<void>

/** Exact store/context passed to an advanced adapter source at synchronous admission. */
export type IStorageReactiveSubscribeContext<TStore extends IKeyValueStore = IKeyValueStore> = {
  /** Exact Store registered by this backend plugin. */
  readonly store: TStore
  /** Host-snapshotted scheduler shared with source timing and installation deadlines. */
  readonly scheduler: IScheduler
  /** Source lifetime cancellation; subscriptions must release their resources when retired. */
  readonly signal: INativeAbortSignal
  /** Report source failures without changing an already committed storage write. */
  readonly report: (error: unknown) => void
  /** Undefined invalidates all queries on this adapter; a known change permits scope filtering. */
  readonly onChange: (change?: IStorageChange) => void
}

/** Reactive consistency and optional source hook retained in private feature metadata. */
export type IStorageReactiveVisibility =
  | 'instance'
  | 'document-eventual'
  | 'top-level-context-eventual'
  | 'origin-js-visible-eventual'
  | 'origin-eventual'

/** Reactive consistency and optional source hook retained in private feature metadata. */
export type IStorageReactiveFeatureMetadata<TStore extends IKeyValueStore = IKeyValueStore> = {
  /**
   * Push uses notifications only; hybrid adds periodic reconciliation; polling uses periodic
   * reconciliation.
   */
  readonly mode: 'push' | 'hybrid' | 'polling'
  /** Declared observation scope, ranging from this instance to eventual same-origin visibility. */
  readonly visibility: IStorageReactiveVisibility
  /**
   * Required positive finite milliseconds for hybrid/polling, forbidden for push; no implicit
   * custom-adapter interval.
   */
  readonly pollIntervalMs?: number
  /**
   * Optional source hook; admission requires a synchronous disposer. Promise-like results are
   * rejected and observed for late cleanup.
   */
  readonly subscribe?: (
    context: IStorageReactiveSubscribeContext<TStore>
  ) => IStorageReactiveSourceDisposer | PromiseLike<unknown>
}

/** Publicly consumable backend plugin identity shell; runtime metadata stays in WeakMaps. */
export type IStorageBackendPluginHandle<
  TExtensions extends object = Record<never, never>,
  TStore extends IKeyValueStore = IKeyValueStore
> = {
  /** Exact bounded, case-sensitive backend registration id. */
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
  /** Literal backend id used for Host lookup and duplicate admission. */
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

/**
 * Installed extension projection inferred from the original PluginHost definition without treating
 * the Store as an extension.
 */
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
  /** Supplies lifecycle timing for installation, rollback and cleanup; defaults to systemScheduler. */
  readonly scheduler?: IScheduler
  /**
   * Optional late-rejection/cleanup diagnostic sink; omission installs no caller sink. Reporter
   * failures are contained and cannot replace the primary failure.
   */
  readonly report?: (error: unknown) => void | PromiseLike<void>
}

/** Constructor options preserving literal plugin tuples for exact Host capabilities. */
export type IStorageHostCreateOptions<TPlugins extends readonly IStorageBackendPluginHandle[]> =
  IStorageHostOptions & {
    /** Initial plugin tuple installed atomically before the host is returned. */
    readonly plugins?: IRejectInstalledOrDuplicateIds<Record<never, never>, TPlugins>
  }

/** Backend-bound query handle sharing the exact committed Store and adapter. */
export type IReactiveBackendHandle<TStore extends IKeyValueStore, TId extends string> = {
  /** Exact installed backend id whose reactive adapter this handle addresses. */
  readonly id: TId
  /** Same actual Store returned by Host.backend for this id. */
  readonly store: TStore
  /** Create a query for this fixed backend using a caller-owned reactive Runtime. */
  liveQuery<T>(
    options: Omit<ILiveQueryOptions<{ readonly [TKey in TId]: TStore }, TId, T>, 'backendId'>
  ): ILiveQuery<T>
}

/**
 * Resource-backed state: loading has no accepted value, ready exposes settlement, refreshing keeps
 * a prior value while work runs, error records failure, and disposed is terminal. Optional values
 * retain their application identity rather than being deep-cloned.
 */
export type ILiveQueryState<T> =
  | { readonly status: 'loading'; readonly value?: T }
  | { readonly status: 'ready'; readonly value: T }
  | { readonly status: 'refreshing'; readonly value: T }
  | { readonly status: 'error'; readonly value?: T; readonly error: unknown }
  | { readonly status: 'disposed'; readonly value?: T; readonly error?: unknown }

/** Non-disposable read-only projection of the same-runtime computed state node. */
export type ILiveQueryStateView<T> = Pick<
  IReactiveComputed<ILiveQueryState<T>>,
  'runtime' | 'debugName' | 'observed' | 'value' | 'peek'
>

/** Frozen consistency admitted by the installed reactive adapter. */
export type IReactiveConsistency = Readonly<{
  /** Push, hybrid or polling policy from the installed adapter. */
  readonly mode: 'push' | 'hybrid' | 'polling'
  /** Configured reconciliation interval; absent for push. */
  readonly pollIntervalMs?: number
  /**
   * Actual adapter observation scope; eventual scopes are not transactional cross-context
   * consistency.
   */
  readonly visibility: IStorageReactiveVisibility
}>

/** Non-reactive Host operations shared by every conditional Host view. */
export type IStorageHostBase<
  TStores extends Record<string, IKeyValueStore>,
  TReactiveIds extends keyof TStores & string = never,
  TExtensions extends object = Record<never, never>
> = {
  /** Committed immutable extension projection; does not expose or replace the Store registry. */
  readonly extensions: Readonly<TExtensions>
  /**
   * Install one atomic plugin batch and return this Host with narrowed types. Concurrent use throws
   * STORAGE_HOST_BUSY; batch failures reject and roll back.
   */
  use<const TPlugins extends readonly IStorageBackendPluginHandle[]>(
    ...plugins: IRejectInstalledOrDuplicateIds<TStores, TPlugins>
  ): Promise<
    IStorageHost<
      TStores & IPluginStoreMap<TPlugins>,
      TReactiveIds | IStoragePluginReactiveId<TPlugins[number]>,
      TExtensions & IStoragePluginExtensions<TPlugins[number]>
    >
  >
  /** Read the exact committed Store for an installed id; an absent id throws BACKEND_NOT_INSTALLED. */
  backend<TId extends keyof TStores & string>(id: TId): TStores[TId]
  /** Test current committed id membership while the Host is open. */
  hasBackend(id: string): id is keyof TStores & string
  /** Return a detached Map copy typed readonly; mutating that copy cannot change Host membership. */
  backends(): ReadonlyMap<keyof TStores & string, TStores[keyof TStores]>
  /** Test whether this exact id has a committed reactive adapter. */
  hasReactiveBackend(id: string): id is TReactiveIds
  /** Return the exact adapter-bound Store/query view, or undefined when no adapter is installed. */
  reactiveBackend<TId extends keyof TStores & string>(
    id: TId
  ): IReactiveBackendHandle<TStores[TId], TId> | undefined
  /** Return the exact adapter-bound Store/query view, or undefined when no adapter is installed. */
  reactiveBackend(id: string): IReactiveBackendHandle<IKeyValueStore, string> | undefined
  /**
   * Seal new operations immediately and release owned registrations; repeated calls share the
   * original cleanup Promise.
   */
  dispose(): Promise<void>
}

/** Resource-backed query handle with explicit ready, refresh and terminal cleanup. */
export type ILiveQuery<T> = {
  /**
   * Frozen non-disposable view of the same-runtime computed state; nested domain values remain
   * application-owned.
   */
  readonly state: ILiveQueryStateView<T>
  /** Frozen admitted adapter policy; no stronger cross-context guarantee is implied. */
  readonly consistency: IReactiveConsistency
  /** Initial Resource settlement projection; rejects on initial failure or terminal disposal. */
  readonly ready: Promise<void>
  /**
   * Start or join current Resource work and return its settlement projection; terminal queries
   * reject LIVE_QUERY_DISPOSED.
   */
  refresh(): Promise<void>
  /**
   * Retire this query and its owned Resource/computed/subscription; the borrowed Runtime remains
   * alive.
   */
  dispose(): Promise<void>
}

/**
 * Query inputs captured once before allocation, retaining the exact backend id, Store and borrowed
 * Runtime.
 */
export type ILiveQueryOptions<
  TStores extends Record<string, IKeyValueStore>,
  TBackendId extends keyof TStores & string,
  T
> = {
  /** Exact installed reactive backend id; there is no default backend fallback. */
  readonly backendId: TBackendId
  /**
   * Caller-owned reactive Runtime used for Resource/computed state; query/Host disposal does not
   * dispose it.
   */
  readonly runtime: IRuntime
  /** Authoritative read callback receiving the exact Store and per-generation cancellation signal. */
  readonly query: (context: {
    /** Exact backend Store captured at query admission. */
    readonly store: TStores[TBackendId]
    /** Resource generation cancellation signal; query I/O must observe it to cooperate. */
    readonly signal: INativeAbortSignal
    /** Optional entity invalidation scope, forwarded to the callback. */
    readonly scope?: string
  }) => T | PromiseLike<T>
  /** Optional entity scope used only to prove that an invalidation cannot be unrelated. */
  readonly scope?: string
  /** Optional change predicate; failures are reported and conservatively refresh the query. */
  readonly matches?: (change: IStorageChange) => boolean
  /** Preserve the last visible value while Resource refreshes; defaults to true. */
  readonly keepPreviousData?: boolean
  /**
   * Optional equality policy preserving the prior visible value when true; omission accepts the new
   * value.
   */
  readonly equals?: (previous: T, next: T) => boolean
  /**
   * Optional finite non-negative per-generation deadline, driven by the Host scheduler; omission is
   * unbounded.
   */
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
  /**
   * Create a Resource-backed query only for an admitted reactive id; missing service/adapter fails
   * synchronously.
   */
  liveQuery<TBackendId extends TReactiveIds, _T>(
    options: ILiveQueryOptions<TStores, TBackendId, _T>
  ): ILiveQuery<_T>
}

/**
 * Host view preserving exact backend ids and exposing liveQuery only when a reactive backend is
 * known.
 */
export type IStorageHost<
  TStores extends Record<string, IKeyValueStore>,
  TReactiveIds extends keyof TStores & string = never,
  TExtensions extends object = Record<never, never>
> = IStorageHostBase<TStores, TReactiveIds, TExtensions> &
  ([TReactiveIds] extends [never]
    ? Record<never, never>
    : IStorageHostReactiveApi<TStores, TReactiveIds>)
