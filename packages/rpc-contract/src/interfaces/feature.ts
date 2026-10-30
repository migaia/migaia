/**
 * Defines executing call features and plugin-owned feature installation contracts. FeatureScope
 * selects instances; timeout, retry, pool, and media features own their own behavior.
 */
import type { IAbortSignal, IRetryFailureContext } from '@migaia/utils/promise'
import type { IScheduler } from '@migaia/utils/scheduler'
import type { IFeature, IFeatureRecord } from '@migaia/plugin-host'
import type { IRpcAuthenticationRetain, IRpcDispose, IRpcTransportContext } from './carrier.ts'

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
  callTimeoutCap?: IRpcTimeoutExecution
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

/** Parameters captured by a timeout owner; per-call data selects only its duration. */
export type ITimeoutFeatureOptions = Readonly<{
  ms: number
  scheduler?: IScheduler
  report?(error: unknown): void
}>

/** Origin retry parameters retain the existing strategy controls without carrying a Feature. */
export type IRetryFeatureOptions = Readonly<{
  attempts?: number
  backoff?: number | ((error: unknown, context: IRetryFailureContext) => number)
  keyFactory?(): string
  scheduler?: IScheduler
  report?(error: unknown): void
}>

/** Installed timeout behavior owns each attempt's timer and cancellation cleanup. */
export type IRpcTimeoutExecution = Readonly<{
  run<T>(attempt: IRpcAttempt<T>): Promise<T>
}>

/** Installed retry behavior owns origin replay while borrowing actual generation facts. */
export type IRpcRetryExecution = Readonly<{
  run<T>(attempt: IRpcAttempt<T>): Promise<T>
}>

/** Timeout definitions are native opaque tokens; behavior exists only in installation output. */
export type IRpcTimeoutFeature = IFeature<Record<never, never>, IRpcTimeoutExecution>

/** Retry definitions are native opaque tokens, never an executing per-call option. */
export type IRpcRetryFeature = IFeature<Record<never, never>, IRpcRetryExecution>

/** The role is private metadata; both supported definitions use native Feature identity. */
export type IRpcCallFeature = IRpcTimeoutFeature | IRpcRetryFeature

/** Fixed role keys select execution parameters; false disables an inherited optional policy. */
export type IRpcCallFeatures = Readonly<{
  timeout?: Readonly<{ ms: number }> | false
  retry?: IRetryFeatureOptions | false
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

/** A native definition may output a deferred installer for a real transport connection. */
export type IRpcFeatureDefinition<TContext = IRpcFeatureContext, TValue = unknown> = IFeature<
  Record<never, never>,
  Readonly<{
    install(
      context: TContext
    ):
      | Readonly<{ value: TValue; dispose: IRpcDispose }>
      | Promise<Readonly<{ value: TValue; dispose: IRpcDispose }>>
  }>
>

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
  TFeatures extends IFeatureRecord = Readonly<Record<string, IRpcCallFeature>>,
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
  features?: TFeatures
  /** Only generic local connection policy reaches Host; native acquisition options stay native. */
  connect?: Readonly<{ retain?: IRpcAuthenticationRetain }>
  /** Bound each physical handshake with the existing Session clock; omission keeps its default. */
  handshakeTimeoutMs?: number
  /** Name arbitration has its own original connect deadline after protocol negotiation. */
  nameAdmissionTimeoutMs?: number
  /** Acquire carriers during native install and publish the namespace surface in that same result. */
  open(
    context: TContext
  ): IRpcTransportInstallation<TExtensions> | Promise<IRpcTransportInstallation<TExtensions>>
}>
