/**
 * Defines executing call features and plugin-owned feature installation contracts. FeatureScope
 * selects instances; timeout, retry, pool, and media features own their own behavior.
 */
import type { IAbortSignal } from '@migaia/utils/promise'
import type { IRpcDispose, IRpcTransportContext } from './carrier.js'

/** Canonical executing-policy discriminants are shared by factories and the sole feature selector. */
export const RpcCallFeatureKind = {
  /** One complete instance owns an individual attempt deadline. */ timeout: 'timeout',
  /** One complete instance owns originating generation replay. */ retry: 'retry'
} as const

/** The actual native member supplies generation observation; features never create supervision. */
export type IRpcNativeGeneration = Readonly<{
  current(): Readonly<{ generation: number; active: boolean }>
  onLeave(generation: number, listener: (reason: unknown) => void): () => void
  whenReady(afterGeneration: number, signal?: IAbortSignal): Promise<number>
}>

/** One genuine accepted physical attempt lends departure and replacement readiness only. */
export type IRpcAvailableAttempt = Readonly<{
  carrierId: string
  /** Present only for a real native supervisor generation; ordinary Sessions omit it. */
  generation?: number
  onLeave(listener: (reason: unknown) => void): () => void
  whenReady(signal?: IAbortSignal): Promise<IRpcAvailableAttempt>
}>

/** A local origin borrows actual Session/native availability without owning either lifecycle. */
export type IRpcAttemptAvailability = Readonly<{
  current(): IRpcAvailableAttempt | undefined
}>

/** Origin admission facts are local readonly data, never values trusted from remote diagnostics. */
export type IRpcAttemptFacts = Readonly<{
  method: string
  idempotent: boolean
  idempotencyKey?: string
  availability?: IRpcAttemptAvailability
  /** A real native execution owner may lend its complete, non-disableable call wall-time cap. */
  callTimeoutCap?: IRpcTimeoutFeature
}>

/** A strategy passes selected generation/key and observes only the real physical write handoff. */
export type IRpcAttemptOptions = Readonly<{
  expectedCarrierId?: string
  expectedGeneration?: number
  idempotencyKey?: string
  onWriteStart?(): void
}>

/** One originating attempt is explicit data; transit hops never receive a retry implementation. */
export type IRpcAttempt<T> = Readonly<{
  /** Parent cancellation observed by the feature's owned controller/timer resources. */
  signal: IAbortSignal
  /** Remaining inherited budget can only shorten a timeout chosen by this feature. */
  remainingMs?: number
  /** Only the originating host/native carrier can supply these admitted retry facts. */
  facts?: IRpcAttemptFacts
  /**
   * Invoke with the feature-selected signal/budget. CallTable intersects elapsed inherited budget
   * before encoding remainingMs; no feature can extend an inherited link deadline.
   */
  invoke(signal: IAbortSignal, remainingMs?: number, options?: IRpcAttemptOptions): Promise<T>
}>

/** A timeout instance carries complete execution logic and its captured configuration. */
export type IRpcTimeoutFeature = Readonly<{
  /** Distinguishes timeout from other plugin-owned execution features. */
  kind: typeof RpcCallFeatureKind.timeout
  /** Apply one attempt deadline and remove every installed timer/listener on settlement. */
  run<T>(attempt: IRpcAttempt<T>): Promise<T>
}>

/** A retry instance owns retry decisions and backoff, not host session or provider state. */
export type IRpcRetryFeature = Readonly<{
  /** Distinguishes retry from timeout when FeatureScope selects installed instances. */
  kind: typeof RpcCallFeatureKind.retry
  /** Execute originating attempts; cancellation and final settlement release owned resources. */
  run<T>(attempt: IRpcAttempt<T>): Promise<T>
}>

/** The same instance may be installed on a plugin or supplied to one originating call. */
export type IRpcCallFeature = IRpcTimeoutFeature | IRpcRetryFeature

/** False explicitly disables an inherited instance; omission inherits the next precedence level. */
export type IRpcCallFeatures = Readonly<{
  /** Selected before a transport-installed and chain-policy timeout instance. */
  timeout?: IRpcTimeoutFeature | false
  /** Selected before a transport-installed and chain-policy retry instance. */
  retry?: IRpcRetryFeature | false
}>

/** Non-call features receive only the context offered by the plugin that owns them. */
export type IRpcFeatureContext = Readonly<{
  /** Definition identity used for duplicate feature admission in the owning plugin. */
  owner: string
  /** Present only when the owner is a transport plugin with this host-local namespace. */
  namespace?: string
  /** The owning installation propagates shutdown to feature-owned work. */
  signal: IAbortSignal
  /** A feature reports failures it does not rethrow. */
  report(error: unknown): void
}>

/** A plugin supplies its concrete extension context without giving features host internals. */
export type IRpcFeatureDefinition<TContext = IRpcFeatureContext, TValue = unknown> = Readonly<{
  /** Identifies this feature within its actual plugin owner. */
  kind: string
  /** Install complete behavior, returning its value and exact rollback/shutdown cleanup. */
  install(
    context: TContext
  ):
    | Readonly<{ value: TValue; dispose: IRpcDispose }>
    | Promise<Readonly<{ value: TValue; dispose: IRpcDispose }>>
}>

/** The native install result is the only namespace extension publication path. */
export type IRpcTransportInstallation<TExtensions extends object = Record<never, never>> =
  Readonly<{
    /**
     * Native plugin-host merges this surface once; reserved host call methods cannot be
     * overwritten.
     */
    namespaceExtensions?: TExtensions
    /** Release acquisition/listener/member resources on rollback or namespace shutdown. */
    dispose: IRpcDispose
  }>

/** Cold transport definitions are registered by the one native plugin-host installation. */
export type IRpcTransportDefinition<
  TFeature = IRpcCallFeature,
  TExtensions extends object = Record<never, never>,
  TContext extends IRpcTransportContext = IRpcTransportContext
> = Readonly<{
  /** Native plugin definition name participates in dependency and installation ordering. */
  name: string
  /** One transport owns one unique host-local namespace. */
  namespace: string
  /** Cold namespace publication may expose keepalive APIs before its first native connection. */
  closingWrites?: true
  /**
   * Ordinary Hosts expose real native Feature methods; RPC hosts use their explicit provide
   * catalog.
   */
  expose?: readonly string[]
  /** The transport owns installation and disposal of each supplied feature. */
  features?: readonly TFeature[]
  /** Bound each physical handshake with the existing Session clock; omission keeps its default. */
  handshakeTimeoutMs?: number
  /** Name arbitration has its own original connect deadline after protocol negotiation. */
  nameAdmissionTimeoutMs?: number
  /** Acquire carriers during native install and publish the namespace surface in that same result. */
  open(
    context: TContext
  ): IRpcTransportInstallation<TExtensions> | Promise<IRpcTransportInstallation<TExtensions>>
}>
