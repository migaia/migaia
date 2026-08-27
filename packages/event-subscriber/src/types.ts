import { EventSubscriberState } from './state-constants.js'
import type { IEventDispatchPolicy } from './state-constants.js'
import type { IEventApiStyle, IEventApiStyleMethodNames, IEventApiStyleOption } from './style.js'

export type IUnsubscribe = () => void

export type IEventChannelSubscription<
  T,
  R = void,
  S extends IEventApiStyle | undefined = undefined
> = IUnsubscribe & {
  readonly unsubscribe: IEventChannelSubscription<T, R, S>
  readonly subscribe: (
    listener: IEventListener<T, R>,
    options?: { readonly taskId?: string }
  ) => IEventChannelSubscription<T, R, S>
} & IEventChannelSubscriptionStyleProjection<T, R, S>

export type IEventHubSubscription<
  C extends IEventMap,
  UsedKeys = never,
  S extends IEventApiStyle | undefined = undefined
> = IUnsubscribe & {
  readonly unsubscribe: IEventHubSubscription<C, UsedKeys, S>
  readonly subscribe: <K extends IEventHubAvailableKey<C, UsedKeys>>(
    key: K,
    listener: IEventListener<C[K]>
  ) => IEventHubSubscription<C, IEventHubNextUsedKey<C, UsedKeys, K>, S>
} & IEventHubSubscriptionStyleProjection<C, UsedKeys, S>

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

export type IEventAbortSignal = {
  readonly aborted: boolean
  readonly reason?: unknown
  addEventListener(
    type: IEventSubscriberAbortType,
    listener: () => void,
    options?: { readonly once?: boolean }
  ): void
  removeEventListener(type: IEventSubscriberAbortType, listener: () => void): void
}

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

export type IEventDispatchSnapshot<T, R> = {
  readonly listener: IEventListener<T, R>
  readonly taskId: string | undefined
  readonly control: IEventDispatchControl
}

export type IEventListener<T, R = void> = (event: IEventContext<T>) => R | PromiseLike<R>

export type IEventSubscriber<T, R = void> = {
  handle(event: IEventContext<T>): R | PromiseLike<R>
}

export type IEventReport<T> = {
  readonly event: IEventContext<T>
  readonly error: unknown
}

export type IListenerResult<R> =
  | { readonly status: typeof EventSubscriberState.fulfilled; readonly value: Awaited<R> }
  | { readonly status: typeof EventSubscriberState.rejected; readonly reason: unknown }

export type IEventChannelLike<T, R = void> = {
  subscribe(listener: IEventListener<T, R>, options?: { readonly taskId?: string }): IUnsubscribe
}

type IEventChannelStyleProjection<T, R, S extends IEventApiStyle | undefined> = [
  IEventApiStyleMethodNames<S>
] extends [never]
  ? Record<never, never>
  : IEventApiStyleMethodNames<S> extends {
        readonly subscribe: infer TSubscribe extends string
        readonly publish: infer TPublish extends string
      }
    ? {
        readonly [K in Exclude<TSubscribe, 'subscribe'>]: (
          listener: IEventListener<T, R>,
          options?: { readonly taskId?: string }
        ) => IEventChannelSubscription<T, R, S>
      } & {
        readonly [K in Exclude<TPublish, 'publish'>]: (value: T) => void
      }
    : Record<never, never>

type IEventChannelSubscriptionStyleProjection<T, R, S extends IEventApiStyle | undefined> = [
  IEventApiStyleMethodNames<S>
] extends [never]
  ? Record<never, never>
  : IEventApiStyleMethodNames<S> extends {
        readonly subscribe: infer TSubscribe extends string
        readonly unsubscribe: infer TUnsubscribe extends string
      }
    ? {
        readonly [K in Exclude<TSubscribe, 'subscribe'>]: (
          listener: IEventListener<T, R>,
          options?: { readonly taskId?: string }
        ) => IEventChannelSubscription<T, R, S>
      } & {
        readonly [K in Exclude<TUnsubscribe, 'unsubscribe'>]: IEventChannelSubscription<T, R, S>
      }
    : Record<never, never>

export type IEventChannel<T, R = void, S extends IEventApiStyle | undefined = undefined> = {
  subscribe(
    listener: IEventListener<T, R>,
    options?: { readonly taskId?: string }
  ): IEventChannelSubscription<T, R, S>
  subscribeOnce(
    listener: IEventListener<T, R>,
    options?: { readonly taskId?: string }
  ): IUnsubscribe
  subscribeUntil(
    signal: IEventAbortSignal,
    listener: IEventListener<T, R>,
    options?: { readonly taskId?: string }
  ): IUnsubscribe
  publish(value: T): void
  filterTaskId(taskId: string): IFilteredEventChannel<T, R>
  clear(): void
  readonly size: number
}

export type IStyledEventChannel<
  T,
  R = void,
  S extends IEventApiStyle | undefined = undefined
> = IEventChannel<T, R, S> & IEventChannelStyleProjection<T, R, S>

declare const filteredChannelBrand: unique symbol
declare const canonicalChannelBrand: unique symbol

export type IFilteredEventChannel<T, R = void> = {
  readonly [filteredChannelBrand]: { readonly value: T; readonly result: R }
}

export type ICanonicalEventChannel<
  T,
  R = void,
  S extends IEventApiStyle | undefined = undefined
> = IEventChannel<T, R, S> & {
  readonly [canonicalChannelBrand]: true
}

export type IEventMap = object

export type IEventHubReport<C extends IEventMap> = {
  [K in keyof C]: {
    readonly key: K
    readonly event: IEventContext<C[K]>
    readonly error: unknown
  }
}[keyof C]

export type IEventHubOptions<
  C extends IEventMap,
  S extends IEventApiStyle | undefined = undefined
> = {
  readonly report?: (failure: IEventHubReport<C>) => void | PromiseLike<void>
  readonly terminalReport?: (error: unknown) => void | PromiseLike<void>
  readonly style?: IEventApiStyleOption<S>
}

export type IEventHub<C extends IEventMap, S extends IEventApiStyle | undefined = undefined> = {
  subscribe<K extends keyof C>(
    key: K,
    listener: IEventListener<C[K]>
  ): IEventHubSubscription<C, IEventHubNextUsedKey<C, never, K>, S>
  publish<K extends keyof C>(key: K, value: C[K]): void
  clear(key?: keyof C): void
  size(key?: keyof C): number
}

type IEventHubStyleProjection<C extends IEventMap, S extends IEventApiStyle | undefined> = [
  IEventApiStyleMethodNames<S>
] extends [never]
  ? Record<never, never>
  : IEventApiStyleMethodNames<S> extends {
        readonly subscribe: infer TSubscribe extends string
        readonly publish: infer TPublish extends string
      }
    ? {
        readonly [K in Exclude<TSubscribe, 'subscribe'>]: IEventHub<C, S>['subscribe']
      } & {
        readonly [K in Exclude<TPublish, 'publish'>]: IEventHub<C>['publish']
      }
    : Record<never, never>

type IEventHubSubscriptionStyleProjection<
  C extends IEventMap,
  UsedKeys,
  S extends IEventApiStyle | undefined
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
          S
        >['subscribe']
      } & {
        readonly [K in Exclude<TUnsubscribe, 'unsubscribe'>]: IEventHubSubscription<C, UsedKeys, S>
      }
    : Record<never, never>

export type IStyledEventHub<
  C extends IEventMap,
  S extends IEventApiStyle | undefined = undefined
> = IEventHub<C, S> & IEventHubStyleProjection<C, S>

export type IEventChannelOptions<T, S extends IEventApiStyle | undefined = undefined> = {
  readonly report?: (failure: IEventReport<T>) => void | PromiseLike<void>
  readonly terminalReport?: (error: unknown) => void | PromiseLike<void>
  /**
   * Controls synchronous nested publishes. The default `recursive` policy preserves the canonical
   * channel trace; `queued` is an explicit opt-in for consumers that need all current listeners to
   * finish before a reentrant value is delivered.
   */
  readonly dispatchPolicy?: IEventDispatchPolicy
  readonly style?: IEventApiStyleOption<S>
}

export type IStyledEventChannelOptions<T, S extends IEventApiStyle> = Omit<
  IEventChannelOptions<T>,
  'style'
> & {
  readonly style: S
} & (IEventApiStyleOption<S> extends never
    ? { readonly __invalidEventApiStyle: never }
    : Record<never, never>)

export type IStyledEventHubOptions<C extends IEventMap, S extends IEventApiStyle> = Omit<
  IEventHubOptions<C>,
  'style'
> & {
  readonly style: S
} & (IEventApiStyleOption<S> extends never
    ? { readonly __invalidEventApiStyle: never }
    : Record<never, never>)
