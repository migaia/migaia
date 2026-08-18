import { EventSubscriberState } from './state-constants.js';

export type IUnsubscribe = () => void;

export type IEventSubscriberAbortType = typeof EventSubscriberState.abort;
export type IEventSubscriberResultStatus =
  | typeof EventSubscriberState.fulfilled
  | typeof EventSubscriberState.rejected;

export type IEventAbortSignal = {
  readonly aborted: boolean;
  readonly reason?: unknown;
  addEventListener(
    type: IEventSubscriberAbortType,
    listener: () => void,
    options?: { readonly once?: boolean }
  ): void;
  removeEventListener(type: IEventSubscriberAbortType, listener: () => void): void;
};

export type IEventContext<T> = {
  readonly value: T;
  readonly aborted: boolean;
  readonly abortReason: unknown;
  readonly taskId: string | undefined;
  abort(reason?: unknown): void;
  setTaskId(taskId: string | undefined): void;
};

export type IEventDispatchControl = {
  readonly active: boolean;
  readonly aborted: boolean;
  readonly abortReason: unknown;
  abort(reason?: unknown): void;
  setTaskId(taskId: string | undefined): void;
};

export type IEventDispatchSnapshot<T, R> = {
  readonly listener: IEventListener<T, R>;
  readonly taskId: string | undefined;
  readonly control: IEventDispatchControl;
};

export type IEventListener<T, R = void> = (event: IEventContext<T>) => R | PromiseLike<R>;

export type IEventSubscriber<T, R = void> = {
  handle(event: IEventContext<T>): R | PromiseLike<R>;
};

export type IEventReport<T> = {
  readonly event: IEventContext<T>;
  readonly error: unknown;
};

export type IListenerResult<R> =
  | { readonly status: typeof EventSubscriberState.fulfilled; readonly value: Awaited<R> }
  | { readonly status: typeof EventSubscriberState.rejected; readonly reason: unknown };

export type IEventChannelLike<T, R = void> = {
  subscribe(listener: IEventListener<T, R>, options?: { readonly taskId?: string }): IUnsubscribe;
};

export type IEventChannel<T, R = void> = {
  subscribe(listener: IEventListener<T, R>, options?: { readonly taskId?: string }): IUnsubscribe;
  subscribeOnce(
    listener: IEventListener<T, R>,
    options?: { readonly taskId?: string }
  ): IUnsubscribe;
  subscribeUntil(
    signal: IEventAbortSignal,
    listener: IEventListener<T, R>,
    options?: { readonly taskId?: string }
  ): IUnsubscribe;
  publish(value: T): void;
  filterTaskId(taskId: string): IFilteredEventChannel<T, R>;
  clear(): void;
  readonly size: number;
};

declare const filteredChannelBrand: unique symbol;
declare const canonicalChannelBrand: unique symbol;

export type IFilteredEventChannel<T, R = void> = {
  readonly [filteredChannelBrand]: { readonly value: T; readonly result: R };
};

export type ICanonicalEventChannel<T, R = void> = IEventChannel<T, R> & {
  readonly [canonicalChannelBrand]: true;
};

export type IEventMap = object;

export type IEventHubReport<C extends IEventMap> = {
  [K in keyof C]: {
    readonly key: K;
    readonly event: IEventContext<C[K]>;
    readonly error: unknown;
  };
}[keyof C];

export type IEventHubOptions<C extends IEventMap> = {
  readonly report?: (failure: IEventHubReport<C>) => void | PromiseLike<void>;
  readonly terminalReport?: (error: unknown) => void | PromiseLike<void>;
};

export type IEventHub<C extends IEventMap> = {
  subscribe<K extends keyof C>(key: K, listener: IEventListener<C[K]>): IUnsubscribe;
  publish<K extends keyof C>(key: K, value: C[K]): void;
  clear(key?: keyof C): void;
  size(key?: keyof C): number;
};

export type IEventChannelOptions<T> = {
  readonly report?: (failure: IEventReport<T>) => void | PromiseLike<void>;
  readonly terminalReport?: (error: unknown) => void | PromiseLike<void>;
};
