import type {
  IDefinedPluginConstraint,
  IFeature,
  IPluginConfig,
  IPluginConstraint,
  IPluginFeatureName,
  IPluginFeatureOutput
} from '@migaia/plugin-host'
import type { IAbortSignal, IUrlLike } from '@migaia/utils'
import type { IRuntimeConnectionDetail } from '@migaia/rpc-host/plugin'
import type { TrayInstanceEvent, TrayInstanceState, TrayRuntime } from './constants.js'
import type { ITrayRoutingPolicy } from './routing-policy.js'

/** Caller cancellation and deadline occupy only the third public call position. */
export type ITrayCallOptions = Readonly<{
  /** Optional caller cancellation forwarded to the selected RPC generation. */
  signal?: IAbortSignal
  /** Optional RPC deadline delay; omission uses the owning runtime's call default. */
  timeoutMs?: number
}>
/** Accepted host runtime families; transport and supervision remain rpc-owned. */
export type ITrayRuntime = (typeof TrayRuntime)[keyof typeof TrayRuntime]
/** Registry domains are declared once by their canonical value/type owner. */
export type { TrayInstanceState, TrayInstanceEvent } from './constants.js'
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

/** Immutable identity and configuration associated with an admission or child generation. */
export type ITrayInstanceInfo<TName extends string = string, TConfig = unknown> = Readonly<{
  /** Registry admission id, distinct from the host definition name. */
  id: string
  /** Name of the trusted host definition used for this admission. */
  host: TName
  /** Parent snapshots retain portable input; child plugin factories receive validator output. */
  config: TConfig
  /** Numeric generation supplied by the owning RPC runtime unit. */
  generation: number
}>
/** Public registry snapshot; admission tokens and queues remain private. */
export type ITrayInstance = ITrayInstanceInfo &
  Readonly<{
    /** Coroutine, thread or process, selected by the trusted host definition. */
    runtime: ITrayRuntime
    /** Tray init/readiness state, separate from the underlying supervisor's detailed state. */
    state: TrayInstanceState
    /** Business operations sent by this admission and not yet ended. */
    inFlight: number
  }>
/** Discovery merges rpc detail while retaining Tray's numeric unit generation. */
export type ITrayInstanceDetail = ITrayInstance & Omit<IRuntimeConnectionDetail, 'generation'>
/** Frozen lifecycle record carries safe exit classification rather than crash object identity. */
export type ITrayInstanceEventRecord = ITrayInstance &
  Readonly<{
    /** Lifecycle transition emitted by the registry, separate from business topic names. */
    event: TrayInstanceEvent
    /** Frozen safe source/code classification, without transferring the crash Error object. */
    error?: Readonly<{ source?: string; code?: string }>
  }>
/** External process command transformation; Tray ships no sandbox implementation. */
export type ITraySandbox = Readonly<{
  /** Nonempty diagnostic identity of the external command transformer. */
  name: string
  /** Transforms the process launch command; Tray itself supplies no isolation implementation. */
  wrap(command: ITrayLaunchCommand): ITrayLaunchCommand
}>
/**
 * The launch command a sandbox may rewrite. Structurally identical to rpc-plugin-process
 * `IProcessLaunchCommand`; declared here so Tray's public types do not pull in rpc-plugin-process
 * declarations and their Node types.
 */
export type ITrayLaunchCommand = Readonly<{
  /** Executable passed to the canonical process launcher after transformation. */
  command: string
  /** Argument vector for that executable. */
  args: readonly string[]
  /** Optional launch directory retained by the process owner. */
  cwd?: string
  /** Explicit inherited environment names and replacement values. */
  env: Readonly<{ inherit: readonly string[]; set: Readonly<Record<string, string>> }>
}>
/**
 * Runtime-specific launch fields: omission selects coroutine with no entry/limits/sandbox. thread
 * requires entry and permits a positive finite heapBytes limit; process requires entry and permits
 * an external sandbox wrapper. Omitted optional launch policy remains owned by the RPC factory.
 */
export type ITrayRuntimeOptions =
  | Readonly<{ runtime?: 'coroutine'; entry?: never; limits?: never; sandbox?: never }>
  | Readonly<{
      runtime: 'thread'
      entry: IUrlLike
      limits?: Readonly<{ heapBytes?: number }>
      sandbox?: never
    }>
  | Readonly<{ runtime: 'process'; entry: IUrlLike; limits?: never; sandbox?: ITraySandbox }>
/** Tray projects the canonical supervision names into each rpc runtime adapter. */
export type ITraySupervisorPolicy = Readonly<{
  /** Optional native restart subset; Tray does not add a retry or recovery loop. */
  restart?: Readonly<{
    /** Never, on-failure or always; omission preserves the runtime's native default. */
    mode?: 'never' | 'on-failure' | 'always'
    /** Optional finite nonnegative restart budget forwarded under the native name. */
    maxRestarts?: number
    /** Optional finite nonnegative window forwarded to native supervision. */
    windowMs?: number
    /** Optional finite nonnegative initial delay, without a Tray-specific backoff owner. */
    initialDelayMs?: number
  }>
  /** Optional finite nonnegative startup budget forwarded to the selected runtime. */
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
    /** Nonempty registry name, unique within one parent Tray. */
    name: TName
    /**
     * Optional synchronous config validator executed in each generation before business
     * installation.
     */
    config?: (input: unknown) => TConfig
    /**
     * Builds this generation's plugin tuple, optionally injecting its trayClient Feature
     * dependency.
     */
    plugins(
      instance: ITrayInstanceInfo<TName, TConfig>,
      trayPlugin: ITrayClientPlugin<TRouting>
    ): TPlugins
    /** Unique plugin.Feature paths whose callable methods may be dispatched remotely. */
    exposes: readonly TExposes[]
    /** Optional immutable native supervision policy projection. */
    supervisor?: ITraySupervisorPolicy
    /** Custom policy identities declared for child use; built-ins need no declaration. */
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
    /** Explicit runtime after defineTrayHost has applied the coroutine default. */
    runtime: ITrayRuntime
    /** Compile-time marker only; runtime trust requires the exact object issued by defineTrayHost. */
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
  /** Fixed record admission; removing and reusing the same id does not revive this remote. */
  id: string
  /** Sends one portable payload to an exposed method and awaits its scalar result; no retry. */
  request<P extends ITrayMethodPath<IHostPlugins<H>, IHostExposes<H>>>(
    path: P,
    ...args: IArgs<IMethodAt<IHostPlugins<H>, P>>
  ): Promise<IResult<IMethodAt<IHostPlugins<H>, P>>>
  /** Awaits sending the notification, without acknowledging remote business completion. */
  notify<P extends ITrayMethodPath<IHostPlugins<H>, IHostExposes<H>>>(
    path: P,
    ...args: IArgs<IMethodAt<IHostPlugins<H>, P>>
  ): Promise<void>
  /**
   * Lazily consumes one selected generation; complete or return the iterator to end its inFlight
   * count.
   */
  stream<P extends ITrayMethodPath<IHostPlugins<H>, IHostExposes<H>>>(
    path: P,
    ...args: IArgs<IMethodAt<IHostPlugins<H>, P>>
  ): AsyncIterableIterator<IStreamItem<IMethodAt<IHostPlugins<H>, P>>>
}>
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
  /** Reads this generation's frozen identity and validated config. */
  self(): ITrayInstanceInfo
  /** Obtains a parent-issued admission receipt for a trusted host/id pair. */
  to<H extends IAnyTrayHost>(host: H, id: string): Promise<ITrayRemote<H>>
  /** Requests clean exit when omitted or crash exit with an error; only the first request wins. */
  exit(error?: unknown): void
  /** Existential internal host views erase callbacks; concrete tuples retain closed policy names. */
  routing: 0 extends 1 & TRouting
    ? any
    : ITrayRouting<IBuiltInRoutingName | IPolicyNames<TRouting>, readonly IAnyTrayHost[]>
  /** Publishes portable business data without persistence, replay or a delivery acknowledgement. */
  publish(topic: string, payload?: unknown): Promise<void>
  /** Registers generation-bound membership; the asynchronous unsubscribe receipt is idempotent. */
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
/**
 * Spawn grammar requires config only when validator output excludes undefined. id is a nonempty,
 * non-reserved registry identity; optional config is portable data, not a launch-options object.
 */
export type ITraySpawnOptions<H extends IAnyTrayHost> = Readonly<
  { id: string } & (undefined extends IHostConfig<H> ? { config?: unknown } : { config: unknown })
>
/** Registry contract exposes lifecycle observations without any event trigger. */
export type ITray<
  THosts extends readonly IAnyTrayHost[],
  TRouting extends readonly ITrayRoutingPolicy[] = readonly []
> = Readonly<{
  /** Built-in and registered custom policy forms share one selection sequence per host/policy. */
  routing: ITrayRouting<ITrayParentRoutingNames<THosts, TRouting>, THosts>
  /**
   * Publishes portable data to current ready subscribers; listener failures are reported
   * separately.
   */
  publish(topic: string, payload?: unknown): void
  /** Adds a parent-side business listener and returns a synchronous unsubscribe receipt. */
  subscribe(topic: string, listener: import('./topics.js').ITrayTopicListener): () => void
  /**
   * Admits an id, starts its RPC unit and initializes plugins before returning a fixed-admission
   * remote.
   */
  spawn<N extends THosts[number]['name']>(
    host: N,
    options: ITraySpawnOptions<IHostByName<THosts, N>>
  ): Promise<ITrayRemote<IHostByName<THosts, N>>>
  /** Captures an existing matching admission; calls still require a ready target at dispatch time. */
  instance<H extends THosts[number]>(host: H, id: string): ITrayRemote<H>
  /**
   * Revokes the admission before cleanup; omitted graceMs uses the 5000ms child shutdown request
   * budget.
   */
  remove(id: string, options?: Readonly<{ graceMs?: number }>): Promise<void>
  /** Returns frozen current snapshots in spawn order; omitted filter accepts all current records. */
  list(
    filter?: Readonly<{
      host?: THosts[number]['name']
      runtime?: ITrayRuntime
      state?: TrayInstanceState
    }>
  ): readonly ITrayInstance[]
  /** Merges current Tray metadata with authoritative RPC discovery; unknown ids reject. */
  get(id: string): Promise<ITrayInstanceDetail>
  /** Serializes child cleanup and native stop for this admission; omitted shutdown grace is 5000ms. */
  stop(id: string, options?: Readonly<{ graceMs?: number }>): Promise<void>
  /**
   * Serializes native restart and re-init using the retained config; business calls are not
   * replayed.
   */
  restart(id: string): Promise<ITrayInstance>
  /** Replaces the native generation; omitted config retains the prior portable config. */
  replace(id: string, options?: Readonly<{ config?: unknown }>): Promise<ITrayInstance>
  /** Observes registry transitions without granting authority to publish lifecycle events. */
  on(event: TrayInstanceEvent, listener: (event: ITrayInstanceEventRecord) => void): () => void
  /** Streams future lifecycle records; return or an optional signal releases the watcher. */
  watch(
    options?: Readonly<{ signal?: IAbortSignal }>
  ): AsyncIterableIterator<ITrayInstanceEventRecord>
  /**
   * Rejects new work and shares one removal/parent-Host cleanup Promise; omitted child grace is
   * 5000ms.
   */
  dispose(options?: Readonly<{ graceMs?: number }>): Promise<void>
  /** Delegates to the same dispose() Promise. */
  [Symbol.asyncDispose](): Promise<void>
}>
