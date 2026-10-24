import type { IAbortSignal, INativeAbortSignal } from '@migaia/utils/promise'
import type { ICodec } from '@migaia/serialize/codec'
import type { ISupervisor } from '@migaia/supervision'
import type { IScheduler } from '@migaia/utils/scheduler'
import type { IRpcFramer, IRpcPortableValue } from '@migaia/rpc-contract'
import type { IRpcFeature } from '../core/feature.js'
import type { IOneWaySurface } from '../core/features/one-way.js'
import type { IRpcStreamRuntime } from '../core/stream/index.js'
import type { IRpcEndpoint } from '../core/typing.js'
import type { IRpcTransport } from '../core/transport.js'
import type { RemoteMethodMode } from './contract.js'
import type { IRuntimeCallOptions } from './runtime-api/typing.js'

/** Native drain invokes one cold dispatcher or the unchanged zero-argument legacy operation. */
export type IRemoteRequestTracker = {
  <T>(operation: () => Promise<T>): Promise<T>
  <T>(
    operation: (method: string, payload: unknown, options: IRuntimeCallOptions) => Promise<T>,
    method: string,
    payload: unknown,
    options: IRuntimeCallOptions
  ): Promise<T>
}

/** A channel presents the complete negotiated pipeline to one endpoint factory. */
export type IRemoteChannel = Readonly<{
  /** Negotiated physical adapter supplied to the endpoint; its owner retains terminal cleanup. */
  transport: IRpcTransport
  /** Accepted direct peer address. */
  peerId: string
  /** Original monotonic scheduler used by this channel's deadlines. */
  scheduler: IScheduler
  /** Actual accepted source, codec and capability set, not a proposal. */
  agreement: Readonly<{
    /** Whether the actual agreement came from negotiation or a fixed static channel. */
    source: 'negotiated' | 'static'
    /** Accepted codec identifier in agreement, or the actual codec in pipeline. */
    codec: string
    /** Actual accepted capability set; local proposals are not authority. */
    capabilities: readonly string[]
  }>
  /** Actual codec and framer selected for this connection. */
  pipeline: Readonly<{
    /** Accepted codec identifier in agreement, or the actual codec in pipeline. */
    codec: ICodec<unknown, unknown>
    /** Actual framing owner paired with the selected codec. */
    framer: IRpcFramer<unknown, unknown, string, number>
  }>
  /** Channel Features that must join the endpoint's construction batch. */
  features: readonly IRpcFeature[]
  /**
   * Release the original channel resources; the remote holder calls this even if endpoint cleanup
   * fails.
   */
  close(): Promise<void>
}>

/** Borrowing a channel grants only its supplied operations; close exists only when delegated. */
export type IRemoteChannelResources = Omit<IRemoteChannel, 'close'> &
  Partial<Pick<IRemoteChannel, 'close'>>

/** A launcher and channel are paired without leaking a platform handle into remote. */
export type IRemoteBinding<TUnit, TSpec> = Readonly<{
  /**
   * Owned lets the registration dispose its supervisor; borrowed leaves the supervisor with its
   * caller.
   */
  ownership: 'owned' | 'borrowed'
  /** Existing execution-unit supervisor; remote does not create a second supervisor. */
  supervisor: ISupervisor<TUnit, TSpec>
  /** Monotonic clock for generation, retry and call deadlines. */
  scheduler: IScheduler
  /** Open a channel for this exact unit generation, honoring preparation cancellation. */
  openChannel(unit: TUnit, signal: INativeAbortSignal): Promise<IRemoteChannel>
  /** Existing native drain tracks runtime requests that bypass the legacy endpoint.send wrapper. */
  trackRequest?: IRemoteRequestTracker
}>

/** Endpoint assembly must install channel features in the same construction batch. */
export type IRemoteServeEndpoint = Readonly<{
  /** Constructed Core endpoint whose disposal belongs to this remote holder/service. */
  endpoint: IRpcEndpoint
  /** Optional physical one-way surface required by one-way contract methods. */
  oneWay?: IOneWaySurface
  /** Optional stream runtime required by generator contract methods. */
  stream?: IRpcStreamRuntime
}>

/** One endpoint factory receives the whole channel rather than a guessed default codec. */
export type IRemoteEndpointFactory = (
  channel: IRemoteChannel,
  signal: INativeAbortSignal
) => Promise<IRemoteServeEndpoint>

/** Request and stream options are local control data, never method params. */
export type IRemoteCallOptions = Readonly<{
  /** Local cancellation; not serialized as method parameters. */
  signal?: IAbortSignal
  /** Optional finite non-negative call budget, bounded by the proxy's deadline cap. */
  timeoutMs?: number
  /** Explicit logical key used by the accepted idempotent request contract. */
  idempotencyKey?: string
  /** Only runtime profile operations negotiate provider-wide ordered execution. */
  orderKey?: string
  /** The final provider start decides this intent; resource revocation retains its original owner. */
  cancel?: 'before-start'
}>

/** A one-shot guard runs after input validation and before the generation gate. */
export type IRemoteCallGuard = Readonly<{
  /**
   * Validate this one dispatch before entering the generation gate; throwing prevents it from being
   * sent.
   */
  beforeDispatch(
    input: Readonly<{ method: string; mode: RemoteMethodMode | 'host-control'; generation: number }>
  ): void
}>

/** Events let the shared retry strategy observe unit departure and readiness. */
export type IRemoteGenerationEvents = Readonly<{
  /** Read the active generation and its availability. */
  current(): Readonly<{ generation: number; active: boolean }>
  /** Observe departure of this exact generation and return its listener remover. */
  onLeave(generation: number, listener: (reason: unknown) => void): () => void
  /** Wait for a later accepted generation; cancellation releases that readiness wait. */
  whenReady(afterGeneration: number, signal?: IAbortSignal): Promise<number>
}>

/** One invocation is bound to the original logical key and deadline. */
export type IRemoteRetryDispatch = Readonly<{
  /** Declared request method associated with this logical invocation. */
  method: string
  /** Only request calls enter this replay strategy. */
  mode: 'request'
  /** Whether the declared contract allows a retry after generation departure. */
  idempotent: boolean
  /** Stable logical key retained across both physical sends, when present. */
  key?: string
  /** Generation selected for the original physical send. */
  generation: number
  /** Cancellation shared by the entire logical retry operation. */
  signal?: IAbortSignal
  /** Original relative call budget when no absolute deadline is supplied. */
  timeoutMs?: number
  /** Absolute monotonic deadline retained across sending and generation readiness waits. */
  deadlineAt?: number
  /** Existing generation owner used to observe departure and replacement. */
  events: IRemoteGenerationEvents
  /** Perform one send for the expected generation using the remaining original budget. */
  sendOnce(
    input: Readonly<{ expectedGeneration: number; remainingMs?: number; key?: string }>
  ): Promise<IRpcPortableValue>
}>

/** Explicit retry ports replace the single-send default as a whole. */
export type IRemoteRetryPort = Readonly<{
  /**
   * Replace the single-send policy for one complete logical request; return its original portable
   * result.
   */
  dispatch(input: IRemoteRetryDispatch): Promise<IRpcPortableValue>
}>

/** Actual native generation configuration; platform launchers supply the original binding. */
export type IRemoteProxyOptions<TUnit, TSpec> = Readonly<{
  /** Execution-unit/channel owner used by this registration. */
  binding: IRemoteBinding<TUnit, TSpec>
  /** Required reporter for background and secondary cleanup failures. */
  report(error: unknown): void
  /** Optional idempotency key generator; omission uses the canonical identity generator. */
  keyFactory?: () => string
  /** Optional whole-invocation retry policy; omission sends once. */
  retryPort?: IRemoteRetryPort
  /** Optional positive safe-integer upper deadline cap; omission imposes no additional proxy cap. */
  callDeadlineCapMs?: number
}>
