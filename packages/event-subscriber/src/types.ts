import type { IObjectPath, IObjectPathValue } from '@migaia/utils/object-path'
import type { IAbortSignal } from '@migaia/utils/promise'
import { EventSubscriberState } from './state-constants.js'
import type { IEventDispatchPolicy } from './state-constants.js'
import type { IEventApiStyle, IEventApiStyleMethodNames, IEventApiStyleOption } from './style.js'

export type IUnsubscribe = () => void

export type IEventValueConfig<T> = {
  readonly readPath: IObjectPath<T> | ''
  readonly alias: string
}

type ITrim<S extends string> = S extends ` ${infer R}`
  ? ITrim<R>
  : S extends `${infer R} `
    ? ITrim<R>
    : S
type IReservedEventContextKey =
  | keyof IEventContext<unknown>
  | '__proto__'
  | 'prototype'
  | 'constructor'
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
type IProjectedEventContext<T, V> = IEventContext<T> & IEventValueExtension<T, V>
type IEventValueForKey<T, V> = V extends IEventValueConfig<T> ? V : undefined

export type IEventChannelSubscription<
  T,
  R = void,
  S extends IEventApiStyle | undefined = undefined,
  V = undefined
> = IUnsubscribe & {
  readonly unsubscribe: IEventChannelSubscription<T, R, S, V>
  readonly subscribe: (
    listener: IEventListener<T, R, V>,
    options?: { readonly taskId?: string }
  ) => IEventChannelSubscription<T, R, S, V>
} & IEventChannelSubscriptionStyleProjection<T, R, S, V>

export type IEventHubSubscription<
  C extends IEventMap,
  UsedKeys = never,
  S extends IEventApiStyle | undefined = undefined,
  V = undefined
> = IUnsubscribe & {
  readonly unsubscribe: IEventHubSubscription<C, UsedKeys, S, V>
  readonly subscribe: <K extends IEventHubAvailableKey<C, UsedKeys>>(
    key: K,
    listener: IEventListener<C[K], void, IEventValueForKey<C[K], V>>
  ) => IEventHubSubscription<C, IEventHubNextUsedKey<C, UsedKeys, K>, S, V>
} & IEventHubSubscriptionStyleProjection<C, UsedKeys, S, V>

type IIsUnion<T, U = T> = T extends unknown ? ([U] extends [T] ? false : true) : never
type IEventHubNextUsedKey<C extends IEventMap, UsedKeys, K> = string extends keyof C
  ? UsedKeys
  : number extends keyof C
    ? UsedKeys
    : symbol extends keyof C
      ? UsedKeys
      : IIsUnion<K> extends true
        ? UsedKeys
        : UsedKeys | K

export type IEventHubAvailableKey<C extends IEventMap, UsedKeys> = string extends keyof C
  ? keyof C
  : number extends keyof C
    ? keyof C
    : symbol extends keyof C
      ? keyof C
      : Exclude<keyof C, UsedKeys & keyof C>

export type IEventSubscriberAbortType = typeof EventSubscriberState.abort
export type IEventSubscriberResultStatus =
  | typeof EventSubscriberState.fulfilled
  | typeof EventSubscriberState.rejected

/** Public compatibility name for utils-owned structural abort-signal admission. */
export type IEventAbortSignal = IAbortSignal

export type IEventContext<T> = {
  readonly value: T
  readonly aborted: boolean
  readonly abortReason: unknown
  readonly taskId: string | undefined
  abort(reason?: unknown): void
  setTaskId(taskId: string | undefined): void
}

export type IEventDispatchControl = {
  readonly active: boolean
  readonly aborted: boolean
  readonly abortReason: unknown
  abort(reason?: unknown): void
  setTaskId(taskId: string | undefined): void
}

export type IEventDispatchSnapshot<T, R, V = undefined> = {
  readonly listener: IEventListener<T, R, V>
  readonly taskId: string | undefined
  readonly control: IEventDispatchControl
}

/** Opaque invocation entry used by consumers that must not receive listener ownership. */
export type IEventInvocation<R> = {
  readonly taskId: string | undefined
  invoke(): R | PromiseLike<R>
}

/** Callback supplied to the package-owned invocation scope. */
export type IEventInvocationVisitor<R> = (
  entries: readonly IEventInvocation<R>[]
) => void | PromiseLike<void>

export type IEventListener<T, R = void, V = undefined> = (
  event: IProjectedEventContext<T, V>
) => R | PromiseLike<R>

export type IEventSubscriber<T, R = void> = {
  handle(event: IEventContext<T>): R | PromiseLike<R>
}

export type IEventReport<T, V = undefined> = {
  readonly event: IProjectedEventContext<T, V>
  readonly error: unknown
}

export type IListenerResult<R> =
  | { readonly status: typeof EventSubscriberState.fulfilled; readonly value: Awaited<R> }
  | { readonly status: typeof EventSubscriberState.rejected; readonly reason: unknown }

export type IEventChannelLike<T, R = void, V = undefined> = {
  subscribe(listener: IEventListener<T, R, V>, options?: { readonly taskId?: string }): IUnsubscribe
}

type IEventChannelStyleProjection<T, R, S extends IEventApiStyle | undefined, V> = [
  IEventApiStyleMethodNames<S>
] extends [never]
  ? Record<never, never>
  : IEventApiStyleMethodNames<S> extends {
        readonly subscribe: infer TSubscribe extends string
        readonly publish: infer TPublish extends string
      }
    ? {
        readonly [K in Exclude<TSubscribe, 'subscribe'>]: (
          listener: IEventListener<T, R, V>,
          options?: { readonly taskId?: string }
        ) => IEventChannelSubscription<T, R, S, V>
      } & {
        readonly [K in Exclude<TPublish, 'publish'>]: (value: T) => void
      }
    : Record<never, never>

type IEventChannelSubscriptionStyleProjection<T, R, S extends IEventApiStyle | undefined, V> = [
  IEventApiStyleMethodNames<S>
] extends [never]
  ? Record<never, never>
  : IEventApiStyleMethodNames<S> extends {
        readonly subscribe: infer TSubscribe extends string
        readonly unsubscribe: infer TUnsubscribe extends string
      }
    ? {
        readonly [K in Exclude<TSubscribe, 'subscribe'>]: (
          listener: IEventListener<T, R, V>,
          options?: { readonly taskId?: string }
        ) => IEventChannelSubscription<T, R, S, V>
      } & {
        readonly [K in Exclude<TUnsubscribe, 'unsubscribe'>]: IEventChannelSubscription<T, R, S, V>
      }
    : Record<never, never>

export type IEventChannel<
  T,
  R = void,
  S extends IEventApiStyle | undefined = undefined,
  V = undefined
> = {
  subscribe(
    listener: IEventListener<T, R, V>,
    options?: { readonly taskId?: string }
  ): IEventChannelSubscription<T, R, S, V>
  subscribeOnce(
    listener: IEventListener<T, R, V>,
    options?: { readonly taskId?: string }
  ): IUnsubscribe
  subscribeUntil(
    signal: IEventAbortSignal,
    listener: IEventListener<T, R, V>,
    options?: { readonly taskId?: string }
  ): IUnsubscribe
  publish(value: T): void
  filterTaskId(taskId: string): IFilteredEventChannel<T, R, V>
  clear(): void
  readonly size: number
}

export type IStyledEventChannel<
  T,
  R = void,
  S extends IEventApiStyle | undefined = undefined,
  V = undefined
> = IEventChannel<T, R, S, V> & IEventChannelStyleProjection<T, R, S, V>

declare const filteredChannelBrand: unique symbol
declare const canonicalChannelBrand: unique symbol

export type IFilteredEventChannel<T, R = void, V = undefined> = {
  readonly [filteredChannelBrand]: { readonly value: T; readonly result: R; readonly config: V }
}

export type ICanonicalEventChannel<
  T,
  R = void,
  S extends IEventApiStyle | undefined = undefined,
  V = undefined
> = IEventChannel<T, R, S, V> & {
  readonly [canonicalChannelBrand]: true
}

export type IEventMap = object

export type IEventHubReport<C extends IEventMap, V = undefined> = {
  [K in keyof C]: {
    readonly key: K
    readonly event: IProjectedEventContext<C[K], IEventValueForKey<C[K], V>>
    readonly error: unknown
  }
}[keyof C]

export type IEventHubOptions<
  C extends IEventMap,
  S extends IEventApiStyle | undefined = undefined,
  V = undefined
> = {
  readonly report?: (failure: IEventHubReport<C, V>) => void | PromiseLike<void>
  readonly terminalReport?: (error: unknown) => void | PromiseLike<void>
  readonly style?: IEventApiStyleOption<S>
  readonly valueConfig?: IValidatedEventValueConfig<C[keyof C], V>
}

export type IEventHub<
  C extends IEventMap,
  S extends IEventApiStyle | undefined = undefined,
  V = undefined
> = {
  subscribe<K extends keyof C>(
    key: K,
    listener: IEventListener<C[K], void, IEventValueForKey<C[K], V>>
  ): IEventHubSubscription<C, IEventHubNextUsedKey<C, never, K>, S, V>
  publish<K extends keyof C>(key: K, value: C[K]): void
  clear(key?: keyof C): void
  size(key?: keyof C): number
}

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

export type IStyledEventHub<
  C extends IEventMap,
  S extends IEventApiStyle | undefined = undefined,
  V = undefined
> = IEventHub<C, S, V> & IEventHubStyleProjection<C, S, V>

export type IEventChannelOptions<
  T,
  S extends IEventApiStyle | undefined = undefined,
  V = undefined
> = {
  readonly report?: (failure: IEventReport<T, V>) => void | PromiseLike<void>
  readonly terminalReport?: (error: unknown) => void | PromiseLike<void>
  /** Controls synchronous nested publishes while preserving listener snapshot semantics. */
  readonly dispatchPolicy?: IEventDispatchPolicy
  /** Controls whether one subscription handle removes only itself or all matching listeners. */
  readonly removalPolicy?: 'handle' | 'listener-all'
  /** Maximum listener invocations in one top-level synchronous publish transaction. */
  readonly publishBudget?: number
  /** Makes already-aborted canonical-channel admission fail after owned cleanup completes. */
  readonly throwOnAborted?: boolean
  readonly style?: IEventApiStyleOption<S>
  readonly valueConfig?: IValidatedEventValueConfig<T, V>
}

export type IStyledEventChannelOptions<T, S extends IEventApiStyle, V = undefined> = Omit<
  IEventChannelOptions<T, undefined, V>,
  'style'
> & {
  readonly style: S
} & (IEventApiStyleOption<S> extends never
    ? { readonly __invalidEventApiStyle: never }
    : Record<never, never>)

export type IStyledEventHubOptions<
  C extends IEventMap,
  S extends IEventApiStyle,
  V = undefined
> = Omit<IEventHubOptions<C, undefined, V>, 'style'> & {
  readonly style: S
} & (IEventApiStyleOption<S> extends never
    ? { readonly __invalidEventApiStyle: never }
    : Record<never, never>)

export type IValidatedEventValueConfig<_T, V> = IEventValueConfigValidation<V> &
  (V extends { readonly readPath: string; readonly alias: string } ? V : never)
