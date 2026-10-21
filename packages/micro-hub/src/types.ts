import type { IPersistHandle } from '@migaia/store-persist'
import type {
  IContract,
  IContractTypesOf,
  IEventMarker,
  IKeyedMarker,
  IRequestMarker,
  IResourceMarker,
  IStateValues
} from './contract.js'

/**
 * Framework-neutral read contract for every value the hub exposes.
 *
 * `get()` returns the same reference until the value is committed again, so `===` change checks and
 * React's `useSyncExternalStore` work without extra renders. Listeners receive no value: they call
 * `get()`, which already returns the committed value when the listener runs.
 */
export type IReadable<T> = {
  /** Current committed value. */
  get(): T
  /** Calls `listener` after each committed change; the returned function unsubscribes. */
  subscribe(listener: () => void): () => void
}

/** Readable view of a `keyed()` field: one readable per id, plus the id list. */
export type IKeyedReadable<T> = {
  /** Readable for one id; `undefined` while the id is absent. */
  at(id: string): IReadable<T | undefined>
  /** Present ids in insertion order. */
  readonly ids: IReadable<readonly string[]>
}

/** Result of a command: the contract revision after the commit. */
export type ICommitResult = { readonly revision: number }

/** Options for a request. */
export type IRequestOptions = {
  /** Milliseconds to wait for the owner's handler when it is not registered yet. */
  readonly waitForOwner?: number
}

/**
 * Status of a shared resource; values mirror `@migaia/resource` so the core entry does not need
 * that optional peer.
 */
export const MicroResourceStatus = {
  idle: 'idle',
  pending: 'pending',
  success: 'success',
  error: 'error',
  cancelled: 'cancelled'
} as const

/** Key union of {@link MicroResourceStatus}. */
export type MicroResourceStatus = keyof typeof MicroResourceStatus

/** Snapshot of a shared resource. */
export type IMicroResourceState<T> = {
  readonly status: MicroResourceStatus
  readonly data: T | undefined
  readonly error: unknown
}

/** Fetcher an owner provides for a resource; `signal` aborts superseded or released requests. */
export type IMicroResourceFetcher<T> = (signal: AbortSignal) => Promise<T>

/** View every app gets of a shared resource. */
export type IMicroResourceView<T> = {
  readonly state: IReadable<IMicroResourceState<T>>
  /** Starts the fetch when idle and resolves with the value; concurrent reads share one request. */
  read(): Promise<T>
  /** Discards the cached value and fetches again. */
  refetch(): void
}

/** Readable state section of a view: keyed fields become {@link IKeyedReadable}. */
export type IStateView<S> = {
  readonly [K in keyof S]: S[K] extends IKeyedMarker<infer T> ? IKeyedReadable<T> : IReadable<S[K]>
}

/** Readable computed section of a view. */
export type IComputedView<D> = {
  readonly [K in keyof D]: D[K] extends (...args: any[]) => infer R ? IReadable<R> : never
}

/** Caller-side command signature: the contract function without its leading state argument. */
export type ICommandView<C> = {
  readonly [K in keyof C]: C[K] extends (state: any, ...args: infer A) => any
    ? (...args: A) => ICommitResult
    : never
}

/** Payload type of an event marker. */
type IPayloadOf<E> = E extends IEventMarker<infer T> ? T : never

/** Listener-only event view used by non-owners. */
export type IEventView<E> = {
  readonly [K in keyof E]: {
    /** Subscribes until the returned function is called or the app disconnects. */
    on(listener: (payload: IPayloadOf<E[K]>) => void): () => void
  }
}

/** Event view of the owner: listening plus emitting. */
export type IOwnedEventView<E> = {
  readonly [K in keyof E]: IEventView<E>[K] & {
    /** Delivers `payload` synchronously to every listener in registration order. */
    emit(payload: IPayloadOf<E[K]>): void
  }
}

/** Caller-side request view. */
export type IRequestView<R> = {
  readonly [K in keyof R]: R[K] extends IRequestMarker<infer I, infer O>
    ? (input: I, options?: IRequestOptions) => Promise<Awaited<O>>
    : never
}

/** Resource section of a view. */
export type IResourceView<R> = {
  readonly [K in keyof R]: R[K] extends IResourceMarker<infer T> ? IMicroResourceView<T> : never
}

/** Plain (non-keyed) state field names; only these can be persisted. */
export type IPlainStateKey<S> = {
  [K in keyof S]: S[K] extends IKeyedMarker<any> ? never : K
}[keyof S] &
  string

/** What any connected app gets from `app.use(contract)`. */
export type IContractView<C extends IContract> = {
  readonly contract: C
  readonly state: IStateView<IContractTypesOf<C>['state']>
  readonly computed: IComputedView<IContractTypesOf<C>['computed']>
  readonly commands: ICommandView<IContractTypesOf<C>['commands']>
  readonly events: IEventView<IContractTypesOf<C>['events']>
  readonly requests: IRequestView<IContractTypesOf<C>['requests']>
  readonly resources: IResourceView<IContractTypesOf<C>['resources']>
  /** Revision of the contract state; increases by one per committed command. */
  readonly revision: IReadable<number>
  /**
   * Readable of a selection over state; notifies only when `equals` (default `Object.is`) says the
   * selected value changed. The selection is released when its last subscriber leaves.
   */
  select<R>(
    selector: (state: IStateValues<IContractTypesOf<C>['state']>) => R,
    equals?: (previous: R, next: R) => boolean
  ): IReadable<R>
}

/** Handler the owner registers for one request. */
export type IRequestHandler<R> =
  R extends IRequestMarker<infer I, infer O> ? (input: I) => O | Promise<O> : never

/** Options for `own()`. */
export type IOwnOptions<C extends IContract> = {
  /** Plain state fields written to the `persist()` store and restored on startup. */
  readonly persist?: readonly IPlainStateKey<IContractTypesOf<C>['state']>[]
  /** Storage key; defaults to the contract name. */
  readonly persistKey?: string
}

/** What the owner gets from `app.own(contract)`: the view plus owner-only members. */
export type IOwnedContract<C extends IContract> = Omit<IContractView<C>, 'events'> & {
  readonly events: IOwnedEventView<IContractTypesOf<C>['events']>
  /** Registers the single handler of a request; returns a function that unregisters it. */
  handle<K extends keyof IContractTypesOf<C>['requests'] & string>(
    name: K,
    handler: IRequestHandler<IContractTypesOf<C>['requests'][K]>
  ): () => void
  /** Registers the fetcher of a resource; returns a function that unregisters it. */
  provide<K extends keyof IContractTypesOf<C>['resources'] & string>(
    name: K,
    fetcher: IMicroResourceFetcher<
      IContractTypesOf<C>['resources'][K] extends IResourceMarker<infer T> ? T : never
    >
  ): () => void
  /** Persistence status when `persist` was requested; otherwise `undefined`. */
  readonly persistence: IPersistHandle | undefined
  /** Gives up ownership; another app may own the contract afterwards. Idempotent. */
  release(): void
}

/** Handle of one connected app. Shell and child apps get exactly the same shape. */
export type IMicroApp = {
  readonly name: string
  /** False once `disconnect()` was called. */
  readonly connected: boolean
  /** Returns the view of `contract`; the same object for repeated calls with the same contract. */
  use<C extends IContract>(contract: C): IContractView<C>
  /** Claims ownership of `contract`. */
  own<C extends IContract>(contract: C, options?: IOwnOptions<C>): IOwnedContract<C>
  /** Releases every subscription, handler and ownership of this app. Idempotent. */
  disconnect(): Promise<void>
}

/** The singleton hub. */
export type IMicroHub = {
  /** Connects an app; names are unique among connected apps. */
  connect(name: string): IMicroApp
  /** Names of connected apps, in connection order. */
  readonly apps: readonly string[]
  /** Disconnects every app and releases the hub; a new hub may be created afterwards. */
  dispose(): Promise<void>
}
