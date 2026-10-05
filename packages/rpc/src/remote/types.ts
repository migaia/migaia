import type { IAbortSignal } from '@migaia/lifecycle'
import type { ICodec } from '@migaia/serialize/codec'
import type { ISupervisor } from '@migaia/supervision'
import type { IScheduler } from '@migaia/utils/scheduler'
import type { IRpcFramer, IRpcPortableValue } from '../contract/types.js'
import type { IRpcFeature } from '../core/feature.js'
import type { IOneWaySurface } from '../core/features/one-way.js'
import type { IRpcStreamRuntime } from '../core/features/stream.js'
import type { IRpcEndpoint, IRpcAbortSignal } from '../core/typing.js'
import type { IRpcTransport } from '../core/transport.js'
import type { IRemoteContract, IRemoteHostCatalog, RemoteMethodMode } from './contract.js'

/** A channel presents the complete negotiated pipeline to one endpoint factory. */
export type IRemoteChannel = Readonly<{
  transport: IRpcTransport
  peerId: string
  scheduler: IScheduler
  agreement: Readonly<{
    source: 'negotiated' | 'static'
    codec: string
    capabilities: readonly string[]
  }>
  pipeline: Readonly<{
    codec: ICodec<unknown, unknown>
    framer: IRpcFramer<unknown, unknown, string, number>
  }>
  features: readonly IRpcFeature[]
  close(): Promise<void>
}>

/** A launcher and channel are paired without leaking a platform handle into remote. */
export type IRemoteBinding<TUnit, TSpec> = Readonly<{
  ownership: 'owned' | 'borrowed'
  supervisor: ISupervisor<TUnit, TSpec>
  scheduler: IScheduler
  openChannel(unit: TUnit, signal: IAbortSignal): Promise<IRemoteChannel>
}>

/** Endpoint assembly must install channel features in the same construction batch. */
export type IRemoteServeEndpoint = Readonly<{
  endpoint: IRpcEndpoint
  oneWay?: IOneWaySurface
  stream?: IRpcStreamRuntime
}>

/** One endpoint factory receives the whole channel rather than a guessed default codec. */
export type IRemoteEndpointFactory = (
  channel: IRemoteChannel,
  signal: IAbortSignal
) => Promise<IRemoteServeEndpoint>

/** Request and stream options are local control data, never method params. */
export type IRemoteCallOptions = Readonly<{
  signal?: IRpcAbortSignal
  timeoutMs?: number
  idempotencyKey?: string
  /** Only runtime profile operations negotiate provider-wide ordered execution. */
  orderKey?: string
  /** The final provider start decides this intent; resource revocation retains its original owner. */
  cancel?: 'before-start'
}>

/** A one-shot guard runs after input validation and before the generation gate. */
export type IRemoteCallGuard = Readonly<{
  beforeDispatch(
    input: Readonly<{ method: string; mode: RemoteMethodMode | 'host-control'; generation: number }>
  ): void
}>

/** Events let the shared retry strategy observe unit departure and readiness. */
export type IRemoteGenerationEvents = Readonly<{
  current(): Readonly<{ generation: number; active: boolean }>
  onLeave(generation: number, listener: (reason: unknown) => void): () => void
  whenReady(afterGeneration: number, signal?: IAbortSignal): Promise<number>
}>

/** One invocation is bound to the original logical key and deadline. */
export type IRemoteRetryDispatch = Readonly<{
  method: string
  mode: 'request'
  idempotent: boolean
  key?: string
  generation: number
  signal?: IRpcAbortSignal
  timeoutMs?: number
  deadlineAt?: number
  events: IRemoteGenerationEvents
  sendOnce(
    input: Readonly<{ expectedGeneration: number; remainingMs?: number; key?: string }>
  ): Promise<IRpcPortableValue>
}>

/** Explicit retry ports replace the I13 single-send default as a whole. */
export type IRemoteRetryPort = Readonly<{
  dispatch(input: IRemoteRetryDispatch): Promise<IRpcPortableValue>
}>

/** Host methods require a caller-provided PluginHost enablement port. */
export type IRemotePluginHostPort = Readonly<{
  disable(name: string, options: { readonly policy: 'suspend' }): Promise<unknown>
  enable(name: string): Promise<unknown>
}>

/** Common proxy configuration; platform launchers supply only the binding. */
export type IRemoteProxyOptions<TUnit, TSpec> = Readonly<{
  contract: IRemoteContract | IRemoteHostCatalog
  binding: IRemoteBinding<TUnit, TSpec>
  endpointFactory: IRemoteEndpointFactory
  report(error: unknown): void
  keyFactory?: () => string
  retryPort?: IRemoteRetryPort
  callDeadlineCapMs?: number
  callGuard?: IRemoteCallGuard
}>
