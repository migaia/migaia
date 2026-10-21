import type { IObjectPath, IObjectPathValue } from '@migaia/utils/object-path'
import { EventDelivery, EventSubscriberState } from './state-constants.js'
import type {
  IEventAdmissionPolicy,
  IEventDispatchPolicy,
  IEventRemovalPolicy
} from './state-constants.js'
import type { IEventApiStyle, IEventApiStyleMethodNames, IEventApiStyleOption } from './style.js'

/** Releases an owned subscription synchronously. Repeated calls do not release it again. */
export type IUnsubscribe = () => void

/** Registration metadata shared by canonical channels, naming aliases, and subscription chains. */
export type IEventSubscribeOptions = {
  /** Optional nonempty task label, captured when a dispatch selects this registration. */
  readonly taskId?: string
  /** Selects the listener argument; omission preserves context delivery and its controls. */
  readonly delivery?: EventDelivery
}

/** Selects payload-only delivery explicitly so listener argument inference remains unambiguous. */
type IEventValueSubscribeOptions = IEventSubscribeOptions & {
  readonly delivery: typeof EventDelivery.value
}

/** Retains context delivery for existing subscriptions and an explicit context selection. */
type IEventContextSubscribeOptions = IEventSubscribeOptions & {
  readonly delivery?: typeof EventDelivery.context
}

/** Shares overloads across channel and chain methods without introducing a runtime facade. */
type IEventSubscribe<T, R, V, H> = {
  (listener: IEventValueListener<T, R>, options: IEventValueSubscribeOptions): H
  (listener: IEventListener<T, R, V>, options?: IEventContextSubscribeOptions): H
}

/** Adds one selected payload field to listener contexts without replacing their original value. */
export type IEventValueConfig<T> = {
  /** Static nested path read once per dispatch. An empty or whitespace-only path disables the alias. */
  readonly readPath: IObjectPath<T> | ''
  /**
   * Extra context property name. Active aliases must be nonempty, trimmed, and avoid
   * context/prototype keys.
   */
  readonly alias: string
}

/** Removes leading and trailing spaces from a string literal type. */
type ITrim<S extends string> = S extends ` ${infer R}`
  ? ITrim<R>
  : S extends `${infer R} `
    ? ITrim<R>
    : S
/** Names an alias may not use, because the context or the object model already uses them. */
type IReservedEventContextKey =
  | keyof IEventContext<unknown>
  | '__proto__'
  | 'prototype'
  | 'constructor'
/** Turns an invalid `valueConfig` into a type error at the call site. */
type IEventValueConfigValidation<V> = V extends {
  readonly readPath: infer P extends string
  readonly alias: infer A extends string
}
  ? ITrim<P> extends ''
    ? V
    : A extends IReservedEventContextKey
      ? never
      : V
  : V
/** Adds the alias property, typed from the read path, to the context. */
type IEventValueExtension<T, V> = V extends {
  readonly readPath: infer P extends string
  readonly alias: infer A extends string
}
  ? ITrim<P> extends ''
    ? Record<never, never>
    : P extends IObjectPath<T>
      ? Readonly<Record<A, IObjectPathValue<T, P> | undefined>>
      : Readonly<Record<A, undefined>>
  : Record<never, never>
/** Event context plus the configured alias property. */
type IProjectedEventContext<T, V> = IEventContext<T> & IEventValueExtension<T, V>
/** The value configuration for one Hub key, or `undefined` when it does not apply to that payload. */
type IEventValueForKey<T, V> = V extends IEventValueConfig<T> ? V : undefined

/**
 * Callable owner for one channel subscription chain. Calling it or `unsubscribe` releases the chain
 * once in reverse registration order. Extending a closed chain throws `SUBSCRIPTION_CLOSED`;
 * failure to extend a live chain leaves earlier subscriptions owned by that same handle.
 */
export type IEventChannelSubscription<
  T,
  R = void,
  S extends IEventApiStyle | undefined = undefined,
  V = undefined
> = IUnsubscribe & {
  /** The handle itself, exposed as an immutable cancellation alias. */
  readonly unsubscribe: IEventChannelSubscription<T, R, S, V>
  /** Adds a context or value listener to this chain and returns the same handle. */
  readonly subscribe: IEventSubscribe<T, R, V, IEventChannelSubscription<T, R, S, V>>
} & IEventChannelSubscriptionStyleProjection<T, R, S, V>

/**
 * Callable owner for a Hub subscription chain, released once in reverse registration order. Finite
 * literal event maps exclude keys already used in this chain at the type boundary; widened runtime
 * keys can repeat. A failed extension preserves earlier owned subscriptions.
 */
export type IEventHubSubscription<
  C extends IEventMap,
  UsedKeys = never,
  S extends IEventApiStyle | undefined = undefined,
  V = undefined
> = IUnsubscribe & {
  /** The handle itself. Calling either form closes the entire chain idempotently. */
  readonly unsubscribe: IEventHubSubscription<C, UsedKeys, S, V>
  /** Adds an available event key and listener, returning this same owner; a closed chain throws. */
  subscribe<K extends IEventHubAvailableKey<C, UsedKeys>>(
    key: K,
    listener: IEventValueListener<C[K]>,
    options: Pick<IEventValueSubscribeOptions, 'delivery'>
  ): IEventHubSubscription<C, IEventHubNextUsedKey<C, UsedKeys, K>, S, V>
  /** Retains context controls and key-specific projection when value delivery is not selected. */
  subscribe<K extends IEventHubAvailableKey<C, UsedKeys>>(
    key: K,
    listener: IEventListener<C[K], void, IEventValueForKey<C[K], V>>,
    options?: Pick<IEventContextSubscribeOptions, 'delivery'>
  ): IEventHubSubscription<C, IEventHubNextUsedKey<C, UsedKeys, K>, S, V>
} & IEventHubSubscriptionStyleProjection<C, UsedKeys, S, V>

/** True when `T` is a union type. */
type IIsUnion<T, U = T> = T extends unknown ? ([U] extends [T] ? false : true) : never
/**
 * Keys already used in a Hub subscription chain, so a finite event map cannot add the same key
 * twice.
 */
type IEventHubNextUsedKey<C extends IEventMap, UsedKeys, K> = string extends keyof C
  ? UsedKeys
  : number extends keyof C
    ? UsedKeys
    : symbol extends keyof C
      ? UsedKeys
      : IIsUnion<K> extends true
        ? UsedKeys
        : UsedKeys | K

/** Remaining literal keys in a finite Hub chain; broad key maps retain runtime fan-out. */
export type IEventHubAvailableKey<C extends IEventMap, UsedKeys> = string extends keyof C
  ? keyof C
  : number extends keyof C
    ? keyof C
    : symbol extends keyof C
      ? keyof C
      : Exclude<keyof C, UsedKeys & keyof C>

/** Abort event name accepted by signal-like subscription helpers. */
export type IEventSubscriberAbortType = typeof EventSubscriberState.abort
/** Discriminant of one asynchronous listener result: fulfilled or rejected. */
export type IEventSubscriberResultStatus =
  | typeof EventSubscriberState.fulfilled
  | typeof EventSubscriberState.rejected

/** Published payload plus registration controls. Payload and task label belong to this dispatch. */
export type IEventContext<T> = {
  /**
   * Original payload passed to publish or an invocation helper; no cloning or transformation
   * occurs.
   */
  readonly value: T
  /** Live cancellation state; it can change while this listener is running. */
  readonly aborted: boolean
  /** Reason recorded by event.abort or an abort-linked helper; initially undefined. */
  readonly abortReason: unknown
  /** Task label captured for this dispatch; later retagging does not rewrite it. */
  readonly taskId: string | undefined
  /** Marks this live registration aborted and unsubscribes it. It does not interrupt running code. */
  abort(reason?: unknown): void
  /**
   * Changes future task selection, or clears the label with undefined. Inactive registrations
   * ignore it.
   */
  setTaskId(taskId: string | undefined): void
}

/** Live control of one registration, shared by every dispatch snapshot of it. */
export type IEventDispatchControl = {
  readonly active: boolean
  readonly aborted: boolean
  readonly abortReason: unknown
  abort(reason?: unknown): void
  setTaskId(taskId: string | undefined): void
}

/** Registration state fixed when a dispatch starts. Package-internal; never reaches user code. */
export type IEventDispatchSnapshot<T, R, V = undefined> = {
  readonly listener: IEventListener<T, R, V> | IEventValueListener<T, R>
  /** Argument mode captured with this listener; dispatch helpers share one invocation branch. */
  readonly delivery: EventDelivery
  readonly taskId: string | undefined
  readonly control: IEventDispatchControl
}

/**
 * One callable listener entry without registration ownership. Each entry can be invoked once;
 * calling it again or after its visitor scope closes throws `INVOCATION_CLOSED`.
 */
export type IEventInvocation<R> = {
  /** Task label captured when this invocation entry is created. */
  readonly taskId: string | undefined
  /** Calls the captured listener with this dispatch's context and returns its raw result. */
  invoke(): R | PromiseLike<R>
}

/**
 * Receives a frozen target list from withSnapshotEntries. Returning a promise keeps entries open
 * until it settles; callers must await any listener results they want included in that lifetime.
 */
export type IEventInvocationVisitor<R> = (
  entries: readonly IEventInvocation<R>[]
) => void | PromiseLike<void>

/**
 * Receives one event context and optionally returns a result or thenable. Synchronous publish
 * observes late rejection without waiting; invoke helpers wait and return listener settlements.
 */
export type IEventListener<T, R = void, V = undefined> = (
  event: IProjectedEventContext<T, V>
) => R | PromiseLike<R>

/** Receives the original payload; results and failures use the same dispatch policy as contexts. */
export type IEventValueListener<T, R = void> = (value: T) => R | PromiseLike<R>

/**
 * Object subscription accepted by subscribeSubscriber; handle executes with this object as
 * receiver.
 */
export type IEventSubscriber<T, R = void> = {
  /**
   * Handles each delivered context. Its return or failure follows the source channel's dispatch
   * policy.
   */
  handle(event: IEventContext<T>): R | PromiseLike<R>
}

/** Diagnostic passed to report for a late publish rejection or a configured payload-path failure. */
export type IEventReport<T, V = undefined> = {
  /** Delivered context, including its original payload and optional projected alias. */
  readonly event: IProjectedEventContext<T, V>
  /** Original listener rejection, or a coded VALUE_PROJECTION_FAILED diagnostic. */
  readonly error: unknown
}

/** A settled listener outcome. Rejection retains the original thrown value or rejection reason. */
export type IListenerResult<R> =
  | { readonly status: typeof EventSubscriberState.fulfilled; readonly value: Awaited<R> }
  | { readonly status: typeof EventSubscriberState.rejected; readonly reason: unknown }

/**
 * Structural subscription source accepted by the subscriber helpers, including styled channels.
 * subscribe must return a callable release handle and must not deliver during installation. Helpers
 * reject malformed sources and installation-time delivery with `INVALID_CHANNEL`.
 */
export type IEventChannelLike<T, R = void, V = undefined> = {
  /** Registers the selected listener argument mode and forwards its optional task label. */
  subscribe(listener: IEventValueListener<T, R>, options: IEventValueSubscribeOptions): IUnsubscribe
  /** Omitted or explicit context delivery preserves the structural source's context contract. */
  subscribe(
    listener: IEventListener<T, R, V>,
    options?: IEventContextSubscribeOptions
  ): IUnsubscribe
}

/** Alias methods a style adds to a channel. */
type IEventChannelStyleProjection<T, R, S extends IEventApiStyle | undefined, V> = [
  IEventApiStyleMethodNames<S>
] extends [never]
  ? Record<never, never>
  : IEventApiStyleMethodNames<S> extends {
        readonly subscribe: infer TSubscribe extends string
        readonly publish: infer TPublish extends string
      }
    ? {
        readonly [K in Exclude<TSubscribe, 'subscribe'>]: IEventSubscribe<
          T,
          R,
          V,
          IEventChannelSubscription<T, R, S, V>
        >
      } & {
        readonly [K in Exclude<TPublish, 'publish'>]: (value: T) => void
      }
    : Record<never, never>

/** Alias methods a style adds to a channel subscription handle. */
type IEventChannelSubscriptionStyleProjection<T, R, S extends IEventApiStyle | undefined, V> = [
  IEventApiStyleMethodNames<S>
] extends [never]
  ? Record<never, never>
  : IEventApiStyleMethodNames<S> extends {
        readonly subscribe: infer TSubscribe extends string
        readonly unsubscribe: infer TUnsubscribe extends string
      }
    ? {
        readonly [K in Exclude<TSubscribe, 'subscribe'>]: IEventSubscribe<
          T,
          R,
          V,
          IEventChannelSubscription<T, R, S, V>
        >
      } & {
        readonly [K in Exclude<TUnsubscribe, 'unsubscribe'>]: IEventChannelSubscription<T, R, S, V>
      }
    : Record<never, never>

/**
 * One transient payload stream. It keeps active registrations, not a current value or event
 * history. Ordinary publish captures registration order once; changes during delivery affect later
 * snapshots.
 */
export type IEventChannel<
  T,
  R = void,
  S extends IEventApiStyle | undefined = undefined,
  V = undefined
> = {
  /** Registers a context listener by default, or an explicit value listener, with its chain owner. */
  subscribe(
    listener: IEventValueListener<T, R>,
    options: IEventValueSubscribeOptions
  ): IEventChannelSubscription<T, R, S, V>
  /** Context listeners retain registration controls and the channel's configured value projection. */
  subscribe(
    listener: IEventListener<T, R, V>,
    options?: IEventContextSubscribeOptions
  ): IEventChannelSubscription<T, R, S, V>
  /**
   * Delivers synchronously without waiting for listener promises; synchronous failures aggregate as
   * PUBLISH_FAILED.
   */
  publish(value: T): void
  /**
   * Creates an opaque task filter for invoke helpers. Empty or non-string task ids throw
   * INVALID_TASK_ID.
   */
  filterTaskId(taskId: string): IFilteredEventChannel<T, R, V>
  /**
   * Removes all registrations without calling listeners or user cleanup; current dispatch snapshots
   * survive.
   */
  clear(): void
  /**
   * Number of active registrations, including independent duplicates under the default admission
   * policy.
   */
  readonly size: number
}

/** Channel surface plus selected naming aliases; aliases reference the canonical methods themselves. */
export type IStyledEventChannel<
  T,
  R = void,
  S extends IEventApiStyle | undefined = undefined,
  V = undefined
> = IEventChannel<T, R, S, V> & IEventChannelStyleProjection<T, R, S, V>

/** Type-only brand that keeps task-filter views distinct from canonical channels. */
declare const filteredChannelBrand: unique symbol
/** Type-only brand that marks channels created by this package. */
declare const canonicalChannelBrand: unique symbol

/**
 * Read-only task selection created by channel.filterTaskId. Invoke helpers select matching current
 * registrations for every new call; this view has no publish, subscribe, or mutation methods.
 */
export type IFilteredEventChannel<T, R = void, V = undefined> = {
  readonly [filteredChannelBrand]: { readonly value: T; readonly result: R; readonly config: V }
}

/**
 * Channel created by this package instance. Invocation helpers verify its private runtime identity;
 * structural lookalikes and channels from a separate physical package copy throw INVALID_CHANNEL.
 */
export type ICanonicalEventChannel<
  T,
  R = void,
  S extends IEventApiStyle | undefined = undefined,
  V = undefined
> = IEventChannel<T, R, S, V> & {
  readonly [canonicalChannelBrand]: true
}

/** Object type mapping Hub event keys to their payload types; it does not store event values. */
export type IEventMap = object

/** Key-associated Hub diagnostic; narrowing key also narrows the corresponding event payload. */
export type IEventHubReport<C extends IEventMap, V = undefined> = {
  [K in keyof C]: {
    /** Hub key whose dispatch produced this diagnostic. */
    readonly key: K
    /** Context for the payload type associated with this key. */
    readonly event: IProjectedEventContext<C[K], IEventValueForKey<C[K], V>>
    /** Original late rejection or a coded payload-path diagnostic. */
    readonly error: unknown
  }
}[keyof C]

/**
 * A keyed fanout hub deliberately fixes recursive dispatch, multiple admission, handle removal, a
 * 100000-invocation publish budget and non-throwing aborted admission on its private channels. Use
 * createEventChannel when dispatch/admission/budget/abort policies must be selected by the owner.
 */
export type IEventHubOptions<
  C extends IEventMap,
  S extends IEventApiStyle | undefined = undefined,
  V = undefined
> = {
  /**
   * Optional late-rejection/projection reporter. Missing or failed reporting falls through to
   * terminalReport.
   */
  readonly report?: (failure: IEventHubReport<C, V>) => void | PromiseLike<void>
  /** Optional final diagnostic sink. Its absence or failure uses the host diagnostic fallback chain. */
  readonly terminalReport?: (error: unknown) => void | PromiseLike<void>
  /** Naming preset or custom names; defaults to subscribe-publish and preserves canonical methods. */
  readonly style?: IEventApiStyleOption<S>
  /**
   * Optional static path/alias applied to each payload without changing event.value. No projection
   * by default.
   */
  readonly valueConfig?: IValidatedEventValueConfig<C[keyof C], V>
}

/**
 * Lazily routes each event key to its own channel while preserving its key/payload type
 * association.
 */
export type IEventHub<
  C extends IEventMap,
  S extends IEventApiStyle | undefined = undefined,
  V = undefined
> = {
  /**
   * Registers a listener for one key and returns a callable chain owner; invalid keys/listeners
   * throw.
   */
  subscribe<K extends keyof C>(
    key: K,
    listener: IEventValueListener<C[K]>,
    options: Pick<IEventValueSubscribeOptions, 'delivery'>
  ): IEventHubSubscription<C, IEventHubNextUsedKey<C, never, K>, S, V>
  /** Keeps the existing key-specific context contract when payload-only delivery is not selected. */
  subscribe<K extends keyof C>(
    key: K,
    listener: IEventListener<C[K], void, IEventValueForKey<C[K], V>>,
    options?: Pick<IEventContextSubscribeOptions, 'delivery'>
  ): IEventHubSubscription<C, IEventHubNextUsedKey<C, never, K>, S, V>
  /** Publishes synchronously for this key. A valid key with no listeners is a no-op. */
  publish<K extends keyof C>(key: K, value: C[K]): void
  /** Clears one key, or all keys when omitted, without invoking user cleanup. */
  clear(key?: keyof C): void
  /** Active registration count for one key, or the total in constant time when key is omitted. */
  size(key?: keyof C): number
}

/** Alias methods a style adds to a Hub. */
type IEventHubStyleProjection<C extends IEventMap, S extends IEventApiStyle | undefined, V> = [
  IEventApiStyleMethodNames<S>
] extends [never]
  ? Record<never, never>
  : IEventApiStyleMethodNames<S> extends {
        readonly subscribe: infer TSubscribe extends string
        readonly publish: infer TPublish extends string
      }
    ? {
        readonly [K in Exclude<TSubscribe, 'subscribe'>]: IEventHub<C, S, V>['subscribe']
      } & {
        readonly [K in Exclude<TPublish, 'publish'>]: IEventHub<C, undefined, V>['publish']
      }
    : Record<never, never>

/** Alias methods a style adds to a Hub subscription handle. */
type IEventHubSubscriptionStyleProjection<
  C extends IEventMap,
  UsedKeys,
  S extends IEventApiStyle | undefined,
  V
> = [IEventApiStyleMethodNames<S>] extends [never]
  ? Record<never, never>
  : IEventApiStyleMethodNames<S> extends {
        readonly subscribe: infer TSubscribe extends string
        readonly unsubscribe: infer TUnsubscribe extends string
      }
    ? {
        readonly [K in Exclude<TSubscribe, 'subscribe'>]: IEventHubSubscription<
          C,
          UsedKeys,
          S,
          V
        >['subscribe']
      } & {
        readonly [K in Exclude<TUnsubscribe, 'unsubscribe'>]: IEventHubSubscription<
          C,
          UsedKeys,
          S,
          V
        >
      }
    : Record<never, never>

/**
 * Hub surface with additional immutable naming aliases over its canonical subscribe/publish
 * methods.
 */
export type IStyledEventHub<
  C extends IEventMap,
  S extends IEventApiStyle | undefined = undefined,
  V = undefined
> = IEventHub<C, S, V> & IEventHubStyleProjection<C, S, V>

/**
 * Channel construction options, read before registrations can escape. Malformed fields throw coded
 * errors.
 */
export type IEventChannelOptions<
  T,
  S extends IEventApiStyle | undefined = undefined,
  V = undefined
> = {
  /**
   * Optional reporter for late publish rejections and projection diagnostics; not synchronous
   * listener throws.
   */
  readonly report?: (failure: IEventReport<T, V>) => void | PromiseLike<void>
  /** Optional fallback when report is absent or fails; a failing/missing sink uses host diagnostics. */
  readonly terminalReport?: (error: unknown) => void | PromiseLike<void>
  /** Recursive (default) delivers nested values immediately; queued waits for the current snapshot. */
  readonly dispatchPolicy?: IEventDispatchPolicy
  /**
   * Multiple (default) owns each subscription separately; unique shares one registration per
   * listener identity.
   */
  readonly admissionPolicy?: IEventAdmissionPolicy
  /**
   * Handle (default) releases one registration; listener-all releases every registration of the
   * same function.
   */
  readonly removalPolicy?: IEventRemovalPolicy
  /**
   * Positive safe-integer listener-call limit per top-level synchronous publish; defaults to
   * 100_000.
   */
  readonly publishBudget?: number
  /**
   * Opt in to throwing on already-aborted canonical-channel admission after owned cleanup; the
   * default false returns a callable no-op unsubscribe without invoking listeners.
   */
  readonly throwOnAborted?: boolean
  /** Naming preset or custom names; defaults to subscribe-publish, without adding default aliases. */
  readonly style?: IEventApiStyleOption<S>
  /**
   * Optional static path/alias for listener contexts. Omitted or blank paths leave projection
   * disabled.
   */
  readonly valueConfig?: IValidatedEventValueConfig<T, V>
}

/**
 * Channel options requiring a specific style while preserving its literal alias names in the return
 * type.
 */
export type IStyledEventChannelOptions<T, S extends IEventApiStyle, V = undefined> = Omit<
  IEventChannelOptions<T, undefined, V>,
  'style'
> & {
  /** Required preset/custom naming object; invalid literal aliases fail type checking. */
  readonly style: S
} & (IEventApiStyleOption<S> extends never
    ? { readonly __invalidEventApiStyle: never }
    : Record<never, never>)

/**
 * Hub options requiring a particular style; inherits the Hub's fixed dispatch and admission
 * policies.
 */
export type IStyledEventHubOptions<
  C extends IEventMap,
  S extends IEventApiStyle,
  V = undefined
> = Omit<IEventHubOptions<C, undefined, V>, 'style'> & {
  /** Required preset/custom naming object retained in the styled Hub's type. */
  readonly style: S
} & (IEventApiStyleOption<S> extends never
    ? { readonly __invalidEventApiStyle: never }
    : Record<never, never>)

/** Static path/alias shape with context-name collisions rejected at the type boundary when known. */
export type IValidatedEventValueConfig<_T, V> = IEventValueConfigValidation<V> &
  (V extends { readonly readPath: string; readonly alias: string } ? V : never)
