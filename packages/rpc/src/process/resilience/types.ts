import type { IAbortSignal } from '@migaia/lifecycle'
import type { IPluginDependencyPlan, IPluginRemoval } from '@migaia/plugin-host'
import type { IReadyOutcome, ISupervisorSnapshot } from '@migaia/supervision'
import type { IScheduler } from '@migaia/utils/scheduler'
import type { IRpcHandshakeOffer, IRpcPeerInfo } from '../../contract/index.js'
import type { IRpcPortableValue } from '../../contract/index.js'
import type { IRpcIdempotencyConfig, IRpcProviderLimits } from '../../core/index.js'
import type { IRpcIdempotencyStore } from '../../core/index.js'
import type { IRemoteCallGuard, IRemoteChannel } from '../../remote/index.js'
import type {
  IListenProcessByteChannel,
  IProcessCommonOptions,
  IProcessPendingByteConnection
} from '../types.js'

/** A verified principal owns a stable deduplication scope across its individual connections. */
export type IProcessSessionIdentity = Readonly<{
  connectionId: string
  sessionId: string
  principalId: string
  processId?: string
}>

/** A ready channel and its connection lease are released together by the adopter. */
export type IProcessSessionLease = Readonly<{
  channel: IRemoteChannel
  identity: IProcessSessionIdentity
  close(): Promise<void>
}>

/** The local PluginHost commits its own dependency plan before liquidation reports dependants. */
export type IProcessDependencyHostPort = Readonly<{
  unUse(
    name: string,
    options: Readonly<{ policy: 'suspend' | 'cascade'; dryRun?: false }>
  ): Promise<IPluginRemoval>
  unUse(
    name: string,
    options: Readonly<{ policy: 'suspend' | 'cascade'; dryRun: true }>
  ): Promise<IPluginDependencyPlan>
}>

/** Proxy plugins and standalone Hosts have distinct liquidation owners. */
export type IProcessLiquidationOwner =
  | Readonly<{ kind: 'proxy-plugin'; name: string; host: IProcessDependencyHostPort }>
  | Readonly<{ kind: 'standalone-host'; release(): Promise<void> }>

/** A narrow projection of either an owned process or a borrowed connection supervisor. */
export type IProcessRegistrationSupervisorPort = Readonly<{
  restart(): Promise<IReadyOutcome<unknown>>
  inspect(): ISupervisorSnapshot
  onTerminal(listener: (event: Readonly<{ entry: number; error: unknown }>) => void): () => void
  dispose(): Promise<void>
}>

/** Ownership determines whether close may terminate a child or only its local socket session. */
export type IProcessRegistrationBinding = Readonly<{
  ownership: 'spawn-owned' | 'connection-borrowed'
  supervisor: IProcessRegistrationSupervisorPort
  health: 'ping' | 'custom' | 'none'
}>

/** The registration's observable state is derived from its supervisor and diagnostic policy. */
export type IProcessResilienceSnapshot = Readonly<{
  id: string
  state: ISupervisorSnapshot['state']
  health: IProcessRegistrationBinding['health']
  unhandled: number
  liquidated: boolean
  reason?: unknown
}>

/** One registration can be restarted or normally closed without disposing its supervisor. */
export type IProcessRegistration = Readonly<{
  restart(): Promise<IReadyOutcome<unknown>>
  inspect(): IProcessResilienceSnapshot | undefined
  close(): Promise<void>
}>

/** The listener owns pending candidates while adopted leases remain with their caller. */
export type IProcessRegistrationListener = Readonly<{ address: string; close(): Promise<void> }>

/** Authenticated native candidates can be adopted once or rejected without a second handshake. */
export type IProcessRegistrationListenOptions = Readonly<{
  wire: 'native'
  listen: IListenProcessByteChannel
  address: string
  /** Unix rendezvous paths require a stable owner identity before binding. */
  serviceId?: string
  offer: IRpcHandshakeOffer
  createConnectionContext(pending: IProcessPendingByteConnection): Readonly<{
    peerId: string
    ipc: IProcessCommonOptions['ipc']
  }>
  verifyToken(auth: IRpcPortableValue | undefined, peer: IRpcPeerInfo): string | Promise<string>
  onCandidate(
    candidate: IProcessSessionLease & Readonly<{ signal: IAbortSignal }>
  ): 'adopt' | 'reject' | Promise<'adopt' | 'reject'>
  scheduler?: IScheduler
  handshakeTimeoutMs?: number
  signal?: AbortSignal
}>

/** Bounded defaults are selected at construction; the scheduler and reporter are caller owned. */
export type IProcessResilienceOptions = Readonly<{
  scheduler: IScheduler
  report(error: unknown): void
  idempotencyStore?: IRpcIdempotencyStore
  maxConnections?: number
  maxConcurrentCallsPerConnection?: number
  maxCallsPerMinute?: number
  maxPayloadBytes?: number
  maxConsecutiveTimeouts?: number
  idleTimeoutMs?: number
  drainMs?: number
  reportAtMs?: readonly number[]
  unhandledLimit?: number
  liquidation?: Readonly<{ cascade?: boolean }>
}>

/** One owner coordinates scoped sessions, native registration, terminal policy, and release. */
export type IProcessResilience = Readonly<{
  sessionOptions(identity: IProcessSessionIdentity): Readonly<{
    idempotency: IRpcIdempotencyConfig
    limits: IRpcProviderLimits
  }>
  listenRegistrations(
    options: IProcessRegistrationListenOptions
  ): Promise<IProcessRegistrationListener>
  attachRegistration(
    name: string,
    binding: IProcessRegistrationBinding,
    liquidation: IProcessLiquidationOwner
  ): IProcessRegistration
  callGuard(name: string): IRemoteCallGuard
  inspect(id: string): IProcessResilienceSnapshot | undefined
  onTerminal(listener: (snapshot: IProcessResilienceSnapshot) => void | Promise<void>): () => void
  close(): Promise<void>
}>
