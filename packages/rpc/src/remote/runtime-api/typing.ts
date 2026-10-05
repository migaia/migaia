import type { IFeatureOutput, IFeatureRecord, IPluginConstraint } from '@migaia/plugin-host'
import type { IRemoteCallOptions } from '../types.js'
import type { IRuntimePeer as IRuntimePeerHandle } from './peer.js'

/** Explicit dynamic invocation is opt-in and still checked against the accepted runtime catalog. */
export type IRuntimeDynamicSurface = Readonly<
  Record<
    string,
    (payload?: unknown) => import('../../contract/types.js').IRpcPortableValue | undefined
  >
>

/** A declaration-only marker prevents ordinary Plugins from being inferred as connections. */
declare const runtimePluginSurface: unique symbol

/** Definitions carry only type metadata; no runtime object, property or catalog is emitted. */
export type IRuntimePluginTyping<
  TRemote,
  TProvide,
  TName extends string,
  TExpose,
  TKind
> = Readonly<{
  readonly name: TName
  readonly [runtimePluginSurface]: Readonly<{
    remote: TRemote
    provide: TProvide
    expose: TExpose
    kind: TKind
  }>
}>

/** A callable path maps to the original application function, preserving payload and result types. */
export type IRuntimeFlatten<
  T,
  TPrefix extends string = '',
  D extends readonly unknown[] = []
> = 0 extends 1 & T
  ? IRuntimeDynamicSurface
  : D['length'] extends typeof import('../../contract/normalize.js').RPC_PORTABLE_MAX_DEPTH
    ? Record<never, never>
    : T extends object
      ? IRuntimeIntersection<
          {
            [K in Extract<keyof T, string>]: T[K] extends (...args: any[]) => any
              ? Record<`${TPrefix}${K}`, T[K]>
              : IRuntimeFlatten<T[K], `${TPrefix}${K}.`, [...D, unknown]>
          }[Extract<keyof T, string>]
        >
      : Record<never, never>

/** Disjoint Feature groups contribute to one flat plugin method namespace. */
type IRuntimeIntersection<T> = [T] extends [never]
  ? Record<never, never>
  : (T extends unknown ? (value: T) => void : never) extends (value: infer R) => void
    ? R
    : never

/** The existing Host tuple is the sole type inventory, without runtime reflection. */
export type IRuntimeRegistry<THost> = THost extends {
  readonly __installedPlugins?: infer T extends readonly IPluginConstraint<any>[]
}
  ? T
  : readonly []

/** Only callable Feature data members may enter the type whitelist, matching the runtime builder. */
type IRuntimeCallableMembers<T> = {
  [K in keyof T as T[K] extends (...args: any[]) => any ? K : never]: T[K]
}

/** Connection metadata remains distinct from ordinary locally owned Feature outputs. */
type IRuntimePluginMethods<T> =
  T extends IRuntimePluginTyping<infer R, any, any, any, any>
    ? string extends keyof R
      ? Record<never, never>
      : IRuntimeFlatten<R>
    : T extends { readonly features?: infer F extends IFeatureRecord }
      ? IRuntimeIntersection<
          { [K in keyof F]: IRuntimeCallableMembers<IFeatureOutput<F[K]>> }[keyof F]
        >
      : Record<never, never>

/** Names and each remote prefix are offered directly as string-literal editor completions. */
export type IRuntimeExpose<TPlugins extends readonly unknown[]> =
  | {
      [K in keyof TPlugins]: TPlugins[K] extends { readonly name: infer N extends string }
        ? keyof IRuntimePluginMethods<TPlugins[K]> extends never
          ? never
          : N | `${N}.${Extract<keyof IRuntimePluginMethods<TPlugins[K]>, string>}`
        : never
    }[number]
  | 'host'

/** Whitelist selection is a type operation; the production builder remains the authority. */
type IRuntimeSelected<TPlugins extends readonly unknown[], TPath> = TPath extends string
  ? IRuntimeIntersection<
      {
        [K in keyof TPlugins]: TPlugins[K] extends { readonly name: infer N extends string }
          ? TPath extends N
            ? {
                [M in Extract<
                  keyof IRuntimePluginMethods<TPlugins[K]>,
                  string
                > as `${N}.${M}`]: IRuntimePluginMethods<TPlugins[K]>[M]
              }
            : TPath extends `${N}.${infer M}`
              ? M extends keyof IRuntimePluginMethods<TPlugins[K]>
                ? Record<TPath, IRuntimePluginMethods<TPlugins[K]>[M]>
                : Record<never, never>
              : Record<never, never>
          : Record<never, never>
      }[number]
    >
  : Record<never, never>

/** Surface composition includes own provide and only explicitly exposed local/forward methods. */
export type IRuntimeSurface<THost, TPlugin> =
  TPlugin extends IRuntimePluginTyping<any, infer P, any, infer E extends readonly string[], any>
    ? IRuntimeFlatten<P> & IRuntimeSelected<IRuntimeRegistry<THost>, E[number]>
    : Record<never, never>

/** A method's first argument is the application payload; provider context is not a caller argument. */
type IRuntimePayload<F> = F extends (...args: infer A) => any
  ? A extends readonly []
    ? [payload?: undefined]
    : undefined extends A[0]
      ? [payload?: A[0]]
      : [payload: A[0]]
  : never
/** Stream results expose yielded values and admit only actual iterable-returning methods. */
type IRuntimeYield<F> = F extends (...args: any[]) => infer R
  ? Awaited<R> extends AsyncIterableIterator<infer V> | IterableIterator<infer V>
    ? V
    : never
  : never
/** Scalar calls cannot misrepresent a generator as a portable scalar result. */
type IRuntimeScalarKeys<S> = {
  [K in keyof S]: IRuntimeYield<S[K]> extends never ? K : never
}[keyof S]
/** Generator paths are inferred purely from the provided function's return type. */
type IRuntimeStreamKeys<S> = string extends keyof S
  ? string
  : { [K in keyof S]: IRuntimeYield<S[K]> extends never ? never : K }[keyof S]
/** Awaiting a scalar call preserves its concrete application result. */
type IRuntimeResult<F> = F extends (...args: any[]) => infer R ? Awaited<R> : never

/** Public Peer calls require an explicit remote surface; no generic means no callable methods. */
export type IRuntimeTypedPeer<TRemote = Record<never, never>, S = IRuntimeFlatten<TRemote>> = Pick<
  IRuntimePeerHandle,
  'self' | 'describe' | 'close'
> &
  Readonly<{
    request<M extends Extract<IRuntimeScalarKeys<S>, string>>(
      method: M,
      ...args: [...IRuntimePayload<S[M]>, options?: IRemoteCallOptions]
    ): Promise<IRuntimeResult<S[M]>>
    notify<M extends Extract<IRuntimeScalarKeys<S>, string>>(
      method: M,
      ...args: [...IRuntimePayload<S[M]>, options?: IRemoteCallOptions]
    ): Promise<void>
    stream<M extends Extract<IRuntimeStreamKeys<S>, string>>(
      method: M,
      ...args: [...IRuntimePayload<S[M]>, options?: IRemoteCallOptions]
    ): AsyncIterableIterator<IRuntimeYield<S[M]>>
  }>

/** Typed instance addressing keeps the registered connection name and method surface correlated. */
export type IRuntimeTarget<N extends string> = N | Readonly<{ name: N; instanceId: string }>

/** Only registered connections of this platform contribute callable targets. */
type IRuntimeConnections<P extends readonly unknown[], K> = Extract<
  P[number],
  IRuntimePluginTyping<any, any, any, any, K>
>
/** Select the exact declared remote surface before checking method, payload and result. */
type IRuntimeRemote<P extends readonly unknown[], K, N> =
  IRuntimeConnections<P, K> extends infer C
    ? C extends IRuntimePluginTyping<infer R, any, infer Name, any, any>
      ? N extends Name
        ? IRuntimeFlatten<R>
        : never
      : never
    : never
/** Targets preserve name correlation even when selected by an instance identity. */
type IRuntimeNames<P extends readonly unknown[], K> = IRuntimeConnections<P, K>['name']

/** A Host outlet reads its existing typed registration tuple and adds no runtime registry. */
export type IRuntimeTypedOutlet<P extends readonly unknown[], K> =
  string extends IRuntimeNames<P, K>
    ? string extends keyof IRuntimeRemote<P, K, IRuntimeNames<P, K>>
      ? Omit<
          import('./outlet.js').IRuntimeOutlet,
          keyof import('./outlet.js').IRuntimeOutletControls<K>
        > &
          import('./outlet.js').IRuntimeOutletControls<K>
      : IRuntimeOutletCalls<P, K>
    : IRuntimeOutletCalls<P, K>

/** Each registered literal name keeps its own method and payload associations. */
type IRuntimeOutletCalls<
  P extends readonly unknown[],
  K
> = import('./outlet.js').IRuntimeOutletControls<K> &
  Readonly<{
    /** Local query retains the same format overloads regardless of erased remote surface. */
    list: import('./outlet.js').IRuntimeOutlet['list']
    request<
      N extends IRuntimeNames<P, K>,
      M extends Extract<IRuntimeScalarKeys<IRuntimeRemote<P, K, N>>, string>
    >(
      target: IRuntimeTarget<N>,
      method: M,
      ...args: [...IRuntimePayload<IRuntimeRemote<P, K, N>[M]>, options?: IRemoteCallOptions]
    ): Promise<IRuntimeResult<IRuntimeRemote<P, K, N>[M]>>
    notify<
      N extends IRuntimeNames<P, K>,
      M extends Extract<IRuntimeScalarKeys<IRuntimeRemote<P, K, N>>, string>
    >(
      target: IRuntimeTarget<N>,
      method: M,
      ...args: [...IRuntimePayload<IRuntimeRemote<P, K, N>[M]>, options?: IRemoteCallOptions]
    ): Promise<void>
    stream<
      N extends IRuntimeNames<P, K>,
      M extends Extract<IRuntimeStreamKeys<IRuntimeRemote<P, K, N>>, string>
    >(
      target: IRuntimeTarget<N>,
      method: M,
      ...args: [...IRuntimePayload<IRuntimeRemote<P, K, N>[M]>, options?: IRemoteCallOptions]
    ): AsyncIterableIterator<IRuntimeYield<IRuntimeRemote<P, K, N>[M]>>
    /** Cold queries have the same portable format overloads as every runtime outlet. */
    get: import('./outlet.js').IRuntimeOutlet['get']
    broadcast(
      method: string,
      payload?: unknown,
      options?: IRemoteCallOptions
    ): Promise<readonly import('./outlet.js').IRuntimeBroadcastResult[]>
  }>
