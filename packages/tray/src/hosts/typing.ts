import type {
  IDefinedPluginConstraint,
  IFeature,
  IPluginConfig,
  IPluginConstraint,
  IPluginFeatureName,
  IPluginFeatureOutput
} from '@migaia/plugin-host'
import type { IProcessLaunchCommand } from '@migaia/rpc-process'
import type { IRuntimeConnectionDetail } from '@migaia/rpc-core/remote'
import type {
  TrayInstanceEvent as TrayInstanceEventValues,
  TrayInstanceState as TrayInstanceStateValues,
  TrayRuntime
} from './constants.js'
import type { ITrayRoutingPolicy } from './routing-policy.js'

/** Caller cancellation and deadline occupy only the third public call position. */
export type ITrayCallOptions = Readonly<{ signal?: AbortSignal; timeoutMs?: number }>
/** Accepted host runtime families; transport and supervision remain rpc-owned. */
export type ITrayRuntime = (typeof TrayRuntime)[keyof typeof TrayRuntime]
/** Current registry state published through discovery. */
export type TrayInstanceState =
  (typeof TrayInstanceStateValues)[keyof typeof TrayInstanceStateValues]
/** Read-only registry lifecycle topic. */
export type TrayInstanceEvent =
  (typeof TrayInstanceEventValues)[keyof typeof TrayInstanceEventValues]
/** Native plugin tuple, retaining each definition's Feature metadata. */
export type ITrayPlugins = readonly IPluginConstraint<any, any, any>[]
/** Selects a literal plugin identity without recursively walking its tuple. */
type IPluginByName<TPlugins extends ITrayPlugins, TName extends string> = Extract<
  TPlugins[number],
  { readonly name: TName }
>
/** Plugin/Feature paths permitted in a host's exposure declaration. */
export type ITrayExposePath<TPlugins extends ITrayPlugins> = {
  [K in keyof TPlugins]: `${TPlugins[K]['name']}.${IPluginFeatureName<TPlugins[K]>}`
}[number]
/** Native PluginHost output at one declared Feature path. */
type IFeatureAt<
  TPlugins extends ITrayPlugins,
  TExpose extends string
> = TExpose extends `${infer P}.${infer F}`
  ? F extends IPluginFeatureName<IPluginByName<TPlugins, P>>
    ? IPluginFeatureOutput<IPluginByName<TPlugins, P>, F>
    : never
  : never
/** Function member paths derived from exposed PluginHost Features. */
export type ITrayMethodPath<
  TPlugins extends ITrayPlugins,
  TExposes extends string
> = TExposes extends string
  ? {
      [M in keyof IFeatureAt<TPlugins, TExposes> & string]: IFeatureAt<
        TPlugins,
        TExposes
      >[M] extends (...args: any[]) => any
        ? `${TExposes}.${M}`
        : never
    }[keyof IFeatureAt<TPlugins, TExposes> & string]
  : never
/** Concrete method signature behind one callable wire path. */
type IMethodAt<
  TPlugins extends ITrayPlugins,
  TPath extends string
> = TPath extends `${infer P}.${infer F}.${infer M}`
  ? M extends keyof IFeatureAt<TPlugins, `${P}.${F}`>
    ? IFeatureAt<TPlugins, `${P}.${F}`>[M]
    : never
  : never
/** Uniform payload grammar distinguishes empty, optional and required first parameters. */
type IArgs<TMethod> = TMethod extends (...args: infer A) => any
  ? A extends []
    ? [] | [payload: undefined, options?: ITrayCallOptions]
    : A extends [infer P, ...any[]]
      ? [payload: P, options?: ITrayCallOptions]
      : A extends [(infer Q)?, ...any[]]
        ? [payload?: Q, options?: ITrayCallOptions]
        : never
  : never
/** Requests resolve ordinary method results; iterable methods are consumed through stream. */
type IResult<TMethod> = TMethod extends (...args: any[]) => infer R
  ? R extends AsyncIterable<any>
    ? never
    : Awaited<R>
  : never
/** Stream element type comes from the method's synchronous or asynchronous iterator. */
type IStreamItem<TMethod> = TMethod extends (...args: any[]) => infer R
  ? R extends AsyncIterable<infer I>
    ? I
    : R extends Iterable<infer I>
      ? I
      : never
  : never

/** Immutable init identity and validated config delivered to each generation. */
export type ITrayInstanceInfo<TName extends string = string, TConfig = unknown> = Readonly<{
  id: string
  host: TName
  config: TConfig
  generation: number
}>
/** Public registry snapshot; admission tokens and queues remain private. */
export type ITrayInstance = ITrayInstanceInfo &
  Readonly<{
    runtime: ITrayRuntime
    state: TrayInstanceState
    /** Business operations sent by this admission and not yet ended. */
    inFlight: number
  }>
/** Discovery merges rpc detail while retaining Tray's numeric unit generation. */
export type ITrayInstanceDetail = ITrayInstance & Omit<IRuntimeConnectionDetail, 'generation'>
/** Frozen lifecycle record carries safe exit classification rather than crash object identity. */
export type ITrayInstanceEventRecord = ITrayInstance &
  Readonly<{
    event: TrayInstanceEvent
    error?: Readonly<{ source?: string; code?: string }>
  }>
/** External process command transformation; Tray ships no sandbox implementation. */
export type ITraySandbox = Readonly<{
  name: string
  wrap(command: IProcessLaunchCommand): IProcessLaunchCommand
}>
/** Runtime-specific options reject launch fields outside their owning family. */
export type ITrayRuntimeOptions =
  | Readonly<{ runtime?: 'coroutine'; entry?: never; limits?: never; sandbox?: never }>
  | Readonly<{
      runtime: 'thread'
      entry: URL | string
      limits?: Readonly<{ heapBytes?: number }>
      sandbox?: never
    }>
  | Readonly<{ runtime: 'process'; entry: URL | string; limits?: never; sandbox?: ITraySandbox }>
/** Tray projects the canonical supervision names into each rpc runtime adapter. */
export type ITraySupervisorPolicy = Readonly<{
  restart?: Readonly<{
    mode?: 'never' | 'on-failure' | 'always'
    maxRestarts?: number
    windowMs?: number
    initialDelayMs?: number
  }>
  startupTimeoutMs?: number
}>
/** Public DSL definition preserves policy and plugin tuples for caller inference. */
export type ITrayHostDefinition<
  TName extends string,
  TConfig,
  TPlugins extends ITrayPlugins,
  TExposes extends string,
  TRouting extends readonly ITrayRoutingPolicy[] = readonly []
> = ITrayRuntimeOptions &
  Readonly<{
    name: TName
    config?: (input: unknown) => TConfig
    plugins(
      instance: ITrayInstanceInfo<TName, TConfig>,
      trayPlugin: ITrayClientPlugin<TRouting>
    ): TPlugins
    exposes: readonly TExposes[]
    supervisor?: ITraySupervisorPolicy
    routing?: TRouting
  }>
/** Compile-time opaque identity; runtime admission is exclusively the definition WeakSet. */
declare const trayHostBrand: unique symbol
/** Frozen host DSL created only by defineTrayHost. */
export type ITrayHost<
  TName extends string,
  TConfig,
  TPlugins extends ITrayPlugins,
  TExposes extends string,
  TRouting extends readonly ITrayRoutingPolicy[] = readonly []
> = ITrayHostDefinition<TName, TConfig, TPlugins, TExposes, TRouting> &
  Readonly<{
    runtime: ITrayRuntime
    [trayHostBrand]: true
  }>
/** Existential host used internally without erasing concrete consumer signatures. */
export type IAnyTrayHost = ITrayHost<any, any, any, any, any>
/** Concrete host tuple's plugin metadata. */
type IHostPlugins<H> = H extends ITrayHost<any, any, infer P, any, any> ? P : never
/** Concrete host's exposed Feature union. */
type IHostExposes<H> = H extends ITrayHost<any, any, any, infer E, any> ? E : never
/** Validator output decides whether a spawn requires config input. */
type IHostConfig<H> = H extends ITrayHost<any, infer C, any, any, any> ? C : never
/** Typed methods bound to one registry record admission. */
export type ITrayRemote<H extends IAnyTrayHost> = Readonly<{
  id: string
  request<P extends ITrayMethodPath<IHostPlugins<H>, IHostExposes<H>>>(
    path: P,
    ...args: IArgs<IMethodAt<IHostPlugins<H>, P>>
  ): Promise<IResult<IMethodAt<IHostPlugins<H>, P>>>
  notify<P extends ITrayMethodPath<IHostPlugins<H>, IHostExposes<H>>>(
    path: P,
    ...args: IArgs<IMethodAt<IHostPlugins<H>, P>>
  ): Promise<void>
  stream<P extends ITrayMethodPath<IHostPlugins<H>, IHostExposes<H>>>(
    path: P,
    ...args: IArgs<IMethodAt<IHostPlugins<H>, P>>
  ): AsyncIterableIterator<IStreamItem<IMethodAt<IHostPlugins<H>, P>>>
}>
/** Per-generation Feature methods; routing and pub/sub are extended by the mesh owner. */
/** Routed remote retains the same method grammar but selects a candidate for every operation. */
export type ITrayRoutedRemote<H extends IAnyTrayHost> = Readonly<{ host: string }> &
  Omit<ITrayRemote<H>, 'id'>
/** Built-ins are always addressable without a declaration. */
type IBuiltInRoutingName = 'roundRobin' | 'leastInFlight'
/** Literal policy tuple names remain closed rather than widening to arbitrary strings. */
type IPolicyNames<T> = T extends readonly ITrayRoutingPolicy[] ? T[number]['name'] : never
/** Host policy tuples contribute their names without recursive tuple traversal. */
type IHostRoutingNames<T> = T extends readonly (infer H)[]
  ? H extends { readonly routing?: infer R }
    ? IPolicyNames<R>
    : never
  : never
/** Parent registration combines explicit policies and all host declarations. */
export type ITrayParentRoutingNames<THosts, TRouting> =
  | IBuiltInRoutingName
  | IPolicyNames<TRouting>
  | IHostRoutingNames<THosts>
/** The callable and member forms share the same host domain and routed remote signature. */
export type ITrayRouting<TNames extends string, THosts extends readonly IAnyTrayHost[]> = (<
  N extends TNames,
  H extends THosts[number]
>(
  name: N,
  host: H
) => ITrayRoutedRemote<H>) &
  Readonly<{ [N in TNames]: <H extends THosts[number]>(host: H) => ITrayRoutedRemote<H> }>
/** Per-generation child Feature keeps its declared policy names. */
export type ITrayClient<TRouting extends readonly ITrayRoutingPolicy[] = readonly []> = Readonly<{
  self(): ITrayInstanceInfo
  to<H extends IAnyTrayHost>(host: H, id: string): Promise<ITrayRemote<H>>
  exit(error?: unknown): void
  /** Existential internal host views erase callbacks; concrete tuples retain closed policy names. */
  routing: 0 extends 1 & TRouting
    ? any
    : ITrayRouting<IBuiltInRoutingName | IPolicyNames<TRouting>, readonly IAnyTrayHost[]>
  publish(topic: string, payload?: unknown): Promise<void>
  subscribe(
    topic: string,
    listener: import('./topics.js').ITrayTopicListener
  ): Promise<() => Promise<void>>
}>
/** Per-init PluginHost definition exposes one precise native `tray` Feature. */
export type ITrayClientPlugin<TRouting extends readonly ITrayRoutingPolicy[] = readonly []> =
  IDefinedPluginConstraint<
    object,
    never,
    Record<never, never>,
    IPluginConfig,
    Record<never, never>,
    'trayClient',
    Readonly<{ tray: IFeature<Record<never, never>, ITrayClient<TRouting>> }>
  >
/** Host selected by an admitted literal registry name. */
type IHostByName<THosts extends readonly IAnyTrayHost[], N> = Extract<
  THosts[number],
  { readonly name: N }
>
/** Spawn grammar requires input only when the validator output excludes undefined. */
export type ITraySpawnOptions<H extends IAnyTrayHost> = Readonly<
  { id: string } & (undefined extends IHostConfig<H> ? { config?: unknown } : { config: unknown })
>
/** Registry contract exposes lifecycle observations without any event trigger. */
export type ITray<
  THosts extends readonly IAnyTrayHost[],
  TRouting extends readonly ITrayRoutingPolicy[] = readonly []
> = Readonly<{
  routing: ITrayRouting<ITrayParentRoutingNames<THosts, TRouting>, THosts>
  publish(topic: string, payload?: unknown): void
  subscribe(topic: string, listener: import('./topics.js').ITrayTopicListener): () => void
  spawn<N extends THosts[number]['name']>(
    host: N,
    options: ITraySpawnOptions<IHostByName<THosts, N>>
  ): Promise<ITrayRemote<IHostByName<THosts, N>>>
  instance<H extends THosts[number]>(host: H, id: string): ITrayRemote<H>
  remove(id: string, options?: Readonly<{ graceMs?: number }>): Promise<void>
  list(
    filter?: Readonly<{
      host?: THosts[number]['name']
      runtime?: ITrayRuntime
      state?: TrayInstanceState
    }>
  ): readonly ITrayInstance[]
  get(id: string): Promise<ITrayInstanceDetail>
  stop(id: string, options?: Readonly<{ graceMs?: number }>): Promise<void>
  restart(id: string): Promise<ITrayInstance>
  replace(id: string, options?: Readonly<{ config?: unknown }>): Promise<ITrayInstance>
  on(event: TrayInstanceEvent, listener: (event: ITrayInstanceEventRecord) => void): () => void
  watch(
    options?: Readonly<{ signal?: AbortSignal }>
  ): AsyncIterableIterator<ITrayInstanceEventRecord>
  dispose(options?: Readonly<{ graceMs?: number }>): Promise<void>
  [Symbol.asyncDispose](): Promise<void>
}>
