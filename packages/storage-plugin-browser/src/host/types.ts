import type { IAbortSignal, INativeAbortSignal } from '@migaia/utils/promise'
import type { IReactiveComputed, IRuntime } from '@migaia/reactive'
import type { IStorageBase, IStorageChange } from '@migaia/storage-contract'

/** Reactive consistency observation domain retained in private feature metadata. */
export type IStorageReactiveVisibility =
  | 'instance'
  | 'document-eventual'
  | 'top-level-context-eventual'
  | 'origin-js-visible-eventual'
  | 'origin-eventual'

/** Reactive consistency retained in private feature metadata. */
export type IStorageReactiveFeatureMetadata = {
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
  TStores extends Record<string, IStorageBase>,
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
