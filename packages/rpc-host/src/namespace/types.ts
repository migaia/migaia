/**
 * Namespace call types preserve payload/result correlation while runtime ownership stays in named
 * host owners.
 */
import type { IAbortSignal } from '@migaia/utils/promise'
import type { IRpcCallFeatures } from '@migaia/rpc-contract/interfaces'
import type { IRpcClosingHandler, IRpcPeerClosedHandler } from '../session/types.ts'
export type {
  IRpcClosingEvent,
  IRpcPeerClosedEvent,
  IRpcClosingHandler,
  IRpcPeerClosedHandler
} from '../session/types.ts'
import type {
  IRpcPortableValue,
  IRpcStepOutcome,
  IRpcCallOptions as IRpcWireCallOptions
} from '@migaia/rpc-contract/protocol'

/** Only complete call features or false may override installed policies. */
export type IRpcCallOptions<Support extends boolean = false> = IRpcCallFeatures &
  IRpcWireCallOptions &
  Readonly<{ signal?: IAbortSignal; transfer?: readonly ArrayBuffer[]; trace?: string }> &
  (Support extends true ? Readonly<{ keepalive?: boolean }> : Record<never, never>)
/** Explicit notification selection preserves the original target override. */
export type IRpcNotifyOptions<Support extends boolean = false> = IRpcCallOptions<Support> &
  Readonly<{ targetId?: string }>
/** Stream policies leave addressing to streamTo's first argument. */
export type IRpcStreamOptions<Support extends boolean = false> = IRpcCallOptions<Support>
/** Independent target outcomes use the established null-record key grammar. */
export type IRpcFanoutResult<T> = Readonly<{
  fulfilled: Partial<Record<string, T>>
  rejected: Partial<Record<string, unknown>>
}>

/** An omitted surface keeps dynamic calls within the existing portable wire domain. */
type IDynamicMethods = Readonly<
  Record<string, (payload?: IRpcPortableValue) => IRpcPortableValue | undefined>
>
/** Unknown or empty declarations select dynamic calls; declared surfaces reuse canonical flattening. */
type IMethods<T> = keyof T extends never ? IDynamicMethods : IRpcFlatten<T>
/** A provider's first argument is its payload; provider context is never a caller argument. */
type IPayload<F> = F extends (...args: infer A) => unknown
  ? A extends readonly []
    ? [payload?: undefined]
    : undefined extends A[0]
      ? [payload?: A[0]]
      : [payload: A[0]]
  : never
/** Stream recognition follows iterable-returning application methods rather than a scalar cast. */
type IIsStream<F> = F extends (...args: never[]) => infer R
  ? [Awaited<R>] extends [never]
    ? false
    : Awaited<R> extends AsyncIterable<unknown> | IterableIterator<unknown>
      ? true
      : false
  : false
/** Only declared scalar paths may be requested, notified or grouped. */
type IScalarKeys<S> = Extract<
  { [K in keyof S]: IIsStream<S[K]> extends true ? never : K }[keyof S],
  string
>
/** Dynamic streaming retains portable values while explicit declarations require stream paths. */
type IStreamKeys<S> = string extends keyof S
  ? string
  : Extract<{ [K in keyof S]: IIsStream<S[K]> extends true ? K : never }[keyof S], string>
/** Awaited scalar values retain the application's declared result. */
type IResult<F> = F extends (...args: never[]) => infer R ? Awaited<R> : never
/** Dynamic streams retain portable items; explicit streams preserve their yielded value. */
type IYield<F> = F extends (...args: never[]) => infer R
  ? Awaited<R> extends AsyncIterable<infer V> | IterableIterator<infer V>
    ? V
    : IRpcPortableValue
  : never
/** Every group step keeps its method and payload correlated. */
type IGroupStep<S> = {
  [M in IScalarKeys<S>]: Readonly<
    { method: M } & (undefined extends IPayload<S[M]>[0]
      ? { payload?: IPayload<S[M]>[0] }
      : { payload: IPayload<S[M]>[0] })
  >
}[IScalarKeys<S>]
/** A top-level function marks a single capability, while object entries may name direct peers. */
type ICallableKeys<T> = {
  [K in keyof T]: T[K] extends (...args: never[]) => unknown ? K : never
}[keyof T]
/** Mapped capabilities restrict target names; a single capability keeps dynamic peer addressing. */
type ITargets<T> = keyof T extends never
  ? string
  : ICallableKeys<T> extends never
    ? Extract<keyof T, string>
    : string
/** The selected target determines its method inventory before payload inference. */
type ITargetMethods<T, K extends string> = K extends keyof T
  ? ICallableKeys<T> extends never
    ? IMethods<T[K]>
    : IMethods<T>
  : IMethods<T>
/** Held peer capabilities preserve nested namespaces and their original call mode. */
type IPeerCapabilities<T> = {
  readonly [K in keyof T]: T[K] extends (...args: never[]) => unknown
    ? (
        ...args: IPayload<T[K]>
      ) => IIsStream<T[K]> extends true
        ? AsyncIterableIterator<IYield<T[K]>>
        : Promise<IResult<T[K]>>
    : IPeerCapabilities<T[K]>
}
/** Unknown peers have no untyped native access; their callable payloads remain portable values. */
type IPeers<T> = keyof T extends never
  ? Readonly<Record<string, IPeerCapabilities<IDynamicMethods>>>
  : ICallableKeys<T> extends never
    ? Readonly<{ [K in keyof T]: IPeerCapabilities<T[K]> }>
    : Readonly<Record<string, IPeerCapabilities<T>>>

/** A callable path maps to the original application function, preserving payload and result types. */
export type IRpcFlatten<
  T,
  TPrefix extends string = '',
  D extends readonly unknown[] = []
> = 0 extends 1 & T
  ? IDynamicMethods
  : D['length'] extends 64
    ? Record<never, never>
    : T extends object
      ? IRpcIntersection<
          {
            [K in Extract<keyof T, string>]: T[K] extends (...args: any[]) => any
              ? Record<`${TPrefix}${K}`, T[K]>
              : IRpcFlatten<T[K], `${TPrefix}${K}.`, [...D, unknown]>
          }[Extract<keyof T, string>]
        >
      : Record<never, never>

/** Disjoint Feature groups contribute to one flat plugin method namespace. */
export type IRpcIntersection<T> = [T] extends [never]
  ? Record<never, never>
  : (T extends unknown ? (value: T) => void : never) extends (value: infer R) => void
    ? R
    : never

/** One namespace contains RPC calls; no root-level request/notify facade is generated. */
export type IRpcNamespace<
  TRemote = Record<never, never>,
  Support extends boolean = false
> = IRpcNamespaceSurface<TRemote, IMethods<TRemote>, Support> &
  (Support extends true
    ? Readonly<{
        /** The physical Session's one close budget bounds all callbacks and their keepalive work. */
        onClosing(handler: IRpcClosingHandler): () => void
        /** Native loss and an admitted peer close frame retain their distinct original reasons. */
        onPeerClosed(handler: IRpcPeerClosedHandler): () => void
      }>
    : Record<never, never>)

/** Internal helper parameters preserve the declared remote method inventory. */
type IRpcNamespaceSurface<TRemote, S, Support extends boolean> = Readonly<{
  /** Namespace shutdown owns one Promise and retires only this transport's sessions. */
  close(reason?: unknown): Promise<void>
  [Symbol.asyncDispose](): Promise<void>
  /** Current held capabilities reject once their original connection generation retires. */
  peers: IPeers<TRemote>
  /** Broadcast scalar calls preserve each direct target's independent settlement. */
  request<M extends IScalarKeys<S>>(
    method: M,
    ...args: [...IPayload<S[M]>, options?: IRpcCallOptions<Support>]
  ): Promise<IResult<S[M]> | IRpcFanoutResult<IResult<S[M]>>>
  /** Physical-send completion is independent of remote provider acknowledgement. */
  notify<M extends IScalarKeys<S>>(
    method: M,
    ...args: [...IPayload<S[M]>, options?: IRpcNotifyOptions<Support>]
  ): Promise<void | IRpcFanoutResult<void>>
  /** Each direct target owns an independent returned iterator. */
  stream<M extends IStreamKeys<S>>(
    method: M,
    ...args: [...IPayload<S[M]>, options?: IRpcStreamOptions<Support>]
  ): AsyncIterableIterator<IYield<S[M]>> | IRpcFanoutResult<AsyncIterableIterator<IYield<S[M]>>>
  /** The first argument selects one direct target and its declared streaming contract. */
  streamTo<K extends ITargets<TRemote>, M extends IStreamKeys<ITargetMethods<TRemote, NoInfer<K>>>>(
    targetId: K,
    method: M,
    ...args: [...IPayload<ITargetMethods<TRemote, K>[M]>, options?: IRpcStreamOptions<Support>]
  ): AsyncIterableIterator<IYield<ITargetMethods<TRemote, K>[M]>>
  /** Atomicity remains local to each target; no cross-target transaction is implied. */
  group<Steps extends readonly IGroupStep<S>[]>(
    steps: Steps,
    options?: IRpcCallOptions<Support>
  ): Promise<readonly IRpcStepOutcome[] | IRpcFanoutResult<readonly IRpcStepOutcome[]>>
  /** Send to one direct target with that target's declared scalar method contract. */
  send<K extends ITargets<TRemote>, M extends IScalarKeys<ITargetMethods<TRemote, NoInfer<K>>>>(
    targetId: K,
    method: M,
    ...args: [...IPayload<ITargetMethods<TRemote, K>[M]>, options?: IRpcCallOptions<Support>]
  ): Promise<IResult<ITargetMethods<TRemote, K>[M]>>
  /** Fire-and-report dispatch retains the same direct target and payload correlation. */
  dispatch<K extends ITargets<TRemote>, M extends IScalarKeys<ITargetMethods<TRemote, NoInfer<K>>>>(
    targetId: K,
    method: M,
    ...args: [...IPayload<ITargetMethods<TRemote, K>[M]>, options?: IRpcCallOptions<Support>]
  ): void
}>
