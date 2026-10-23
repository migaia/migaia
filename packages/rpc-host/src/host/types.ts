import type { IAbortSignal } from '@migaia/utils'
import type { IRpcPortableValue } from '@migaia/rpc-contract'
import type { IRpcRuntimeStepOutcome } from '@migaia/rpc-contract/runtime'
import type { IRpcHostPlugin } from '../plugin/types.js'
import type {
  IRpcAuthenticationConfig,
  IRpcFanoutResult,
  IRpcProviderLimits,
  IRpcRuntimeGroupOptions,
  IRpcRuntimeOutcomeResult
} from '../core/typing.js'
import type { IRemoteContract } from '../remote/contract.js'
import type { IRuntimePeerProvide } from '../remote/runtime-api/catalog.js'
import type {
  IRuntimePeerDescription,
  IRuntimePeerIdentity
} from '../remote/runtime-api/description.js'
import type { IRuntimePeer } from '../remote/runtime-api/peer.js'
import type { IRuntimeCallOptions, IRuntimeFlatten } from '../remote/runtime-api/typing.js'

/** Host configuration is captured before the single canonical endpoint is opened. */
export type IRpcHostOptions = Readonly<{
  plugins: readonly IRpcHostPlugin[]
  provide?: IRuntimePeerProvide
  self?: IRuntimePeerIdentity
  defaultTimeoutMs?: number
  providerLimits?: IRpcProviderLimits
  authentication?: IRpcAuthenticationConfig
  contract?: IRemoteContract
  report?(error: unknown): void
  signal?: IAbortSignal
}>

/** Notification selection confirms physical sending without waiting for provider completion. */
export type IRpcHostNotifyOptions = IRuntimeCallOptions & Readonly<{ targetId?: string }>

/** Feature hooks observe accepted directories without owning another directory or lifetime. */
export type IRpcHostFeatureContext = Readonly<{
  host: IRpcHost<unknown>
  directories: Readonly<{
    current(): readonly IRuntimePeerDescription[]
    onAccepted(listener: (description: IRuntimePeerDescription) => unknown): () => void
  }>
  report(error: unknown): void
  onDispose(dispose: () => void | Promise<void>): void
}>

/** An omitted surface keeps dynamic calls within the existing portable wire domain. */
type IDynamicMethods = Readonly<
  Record<string, (payload?: IRpcPortableValue) => IRpcPortableValue | undefined>
>
/** Unknown or empty declarations select dynamic calls; declared surfaces reuse canonical flattening. */
type IMethods<T> = keyof T extends never ? IDynamicMethods : IRuntimeFlatten<T>
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

/** One host broadcasts to its current direct targets and preserves scalar versus fanout outcomes. */
export type IRpcHost<TRemote = Record<never, never>> = IRpcHostSurface<TRemote, IMethods<TRemote>>

/** The internal method projection is derived from the public capability parameter, never supplied. */
type IRpcHostSurface<TRemote, S> = Pick<
  IRuntimePeer,
  'self' | 'describe' | 'on' | 'close' | typeof Symbol.asyncDispose
> &
  Readonly<{
    /** Current held capabilities reject once their original connection generation retires. */
    peers: IPeers<TRemote>
    /** Incremental provider registration retains the canonical duplicate-name rejection. */
    provide(definition: IRuntimePeerProvide): void
    /** Broadcast scalar calls preserve each direct target's independent settlement. */
    request<M extends IScalarKeys<S>>(
      method: M,
      ...args: [...IPayload<S[M]>, options?: IRuntimeCallOptions]
    ): Promise<IResult<S[M]> | IRpcFanoutResult<IResult<S[M]>>>
    /** Physical-send completion is independent of remote provider acknowledgement. */
    notify<M extends IScalarKeys<S>>(
      method: M,
      ...args: [...IPayload<S[M]>, options?: IRpcHostNotifyOptions]
    ): Promise<void | IRpcFanoutResult<void>>
    /** Each direct target owns an independent returned iterator. */
    stream<M extends IStreamKeys<S>>(
      method: M,
      ...args: [...IPayload<S[M]>, options?: IRuntimeCallOptions]
    ): AsyncIterableIterator<IYield<S[M]>> | IRpcFanoutResult<AsyncIterableIterator<IYield<S[M]>>>
    /** Atomicity remains local to each target; no cross-target transaction is implied. */
    group<Steps extends readonly IGroupStep<S>[]>(
      steps: Steps,
      options?: IRpcRuntimeGroupOptions
    ): Promise<
      readonly IRpcRuntimeStepOutcome[] | IRpcFanoutResult<readonly IRpcRuntimeStepOutcome[]>
    >
    /** Query retained logical outcomes independently on the current direct targets. */
    outcome(
      idempotencyKey: string
    ): Promise<IRpcRuntimeOutcomeResult | IRpcFanoutResult<IRpcRuntimeOutcomeResult>>
    /** Send to one direct target with that target's declared scalar method contract. */
    send<K extends ITargets<TRemote>, M extends IScalarKeys<ITargetMethods<TRemote, NoInfer<K>>>>(
      targetId: K,
      method: M,
      ...args: [...IPayload<ITargetMethods<TRemote, K>[M]>, options?: IRuntimeCallOptions]
    ): Promise<IResult<ITargetMethods<TRemote, K>[M]>>
    /** Fire-and-report dispatch retains the same direct target and payload correlation. */
    dispatch<
      K extends ITargets<TRemote>,
      M extends IScalarKeys<ITargetMethods<TRemote, NoInfer<K>>>
    >(
      targetId: K,
      method: M,
      ...args: IPayload<ITargetMethods<TRemote, K>[M]>
    ): void
  }>
