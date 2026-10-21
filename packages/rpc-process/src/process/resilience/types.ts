import type { IAbortSignal } from '@migaia/utils/promise'
import type { IPluginDependencyPlan, IPluginRemoval } from '@migaia/plugin-host'
import type { IReadyOutcome, ISupervisorSnapshot } from '@migaia/supervision'
import type { IScheduler } from '@migaia/utils/scheduler'
import type { IRpcHandshakeOffer, IRpcPeerInfo } from '@migaia/rpc-contract'
import type { IRpcPortableValue } from '@migaia/rpc-contract'
import type { IRpcIdempotencyConfig, IRpcProviderLimits } from '@migaia/rpc-core'
import type { IRpcIdempotencyStore } from '@migaia/rpc-core'
import type { IRemoteCallGuard, IRemoteChannel } from '@migaia/rpc-core/remote'
import type {
  IListenProcessByteChannel,
  IProcessCommonOptions,
  IProcessPendingByteConnection
} from '../types.js'

/** A verified principal owns a stable deduplication scope across its individual connections. */
export type IProcessSessionIdentity = Readonly<{
  /** Physical connection label; it does not create a separate deduplication scope. */
  connectionId: string
  /** Session label used for diagnostics and generation assembly. */
  sessionId: string
  /** Required nonempty verified identity; equal principals share this governor's replay scope. */
  principalId: string
  /** Optional supervised process label, separate from the authenticated principal. */
  processId?: string
}>

/** A ready channel and its connection lease are released together by the adopter. */
export type IProcessSessionLease = Readonly<{
  /** Ready authenticated channel whose lifetime transfers with this lease. */
  channel: IRemoteChannel
  /** Verified session labels retained by the adopting owner. */
  identity: IProcessSessionIdentity
  /** Release this connection and its admission lease; repeated release uses the same owner. */
  close(): Promise<void>
}>

/** The local PluginHost commits its own dependency plan before liquidation reports dependants. */
export type IProcessDependencyHostPort = Readonly<{
  /** Commit suspension or cascading removal using the local Host's actual dependency plan. */
  unUse(
    name: string,
    options: Readonly<{ policy: 'suspend' | 'cascade'; dryRun?: false }>
  ): Promise<IPluginRemoval>
  /** Preview that same dependency policy without committing removal. */
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
  /** Delegate restart to the original supervisor and return its readiness outcome. */
  restart(): Promise<IReadyOutcome<unknown>>
  /** Read the supervisor's current lifecycle state without creating another state machine. */
  inspect(): ISupervisorSnapshot
  /** Subscribe to entries into terminal; the returned function removes this subscription. */
  onTerminal(listener: (event: Readonly<{ entry: number; error: unknown }>) => void): () => void
  /** Supervisor-owned release; normal registration cleanup does not invoke this method. */
  dispose(): Promise<void>
}>

/** Ownership determines whether close may terminate a child or only its local socket session. */
export type IProcessRegistrationBinding = Readonly<{
  /** Spawn ownership may terminate a child; borrowed ownership releases only the local connection. */
  ownership: 'spawn-owned' | 'connection-borrowed'
  /** Borrowed supervisor that remains responsible for restart and native execution lifetime. */
  supervisor: IProcessRegistrationSupervisorPort
  /** Describe native ping, caller health, or no health checks; this field does not install a probe. */
  health: 'ping' | 'custom' | 'none'
}>

/** The registration's observable state is derived from its supervisor and diagnostic policy. */
export type IProcessResilienceSnapshot = Readonly<{
  /** Registration name used by inspect and callGuard. */
  id: string
  /** Current supervisor state, or terminal state retained after committed liquidation. */
  state: ISupervisorSnapshot['state']
  /** Health policy selected by the binding, not a fresh health-check result. */
  health: IProcessRegistrationBinding['health']
  /** Consecutive terminal notifications without any successfully settled observer. */
  unhandled: number
  /** True only after the local liquidation owner has committed release. */
  liquidated: boolean
  /** Terminal primary and any retained cleanup failures; absent for ordinary nonterminal state. */
  reason?: unknown
}>

/** One registration can be restarted or normally closed without disposing its supervisor. */
export type IProcessRegistration = Readonly<{
  /** Restart through the borrowed supervisor; committed liquidation rejects PROCESS_LIQUIDATED. */
  restart(): Promise<IReadyOutcome<unknown>>
  /** Return a fresh diagnostic snapshot, or undefined after this registration closes. */
  inspect(): IProcessResilienceSnapshot | undefined
  /** Idempotently stop diagnostics and detach this registration without disposing its supervisor. */
  close(): Promise<void>
}>

/** The listener owns pending candidates while adopted leases remain with their caller. */
export type IProcessRegistrationListener = Readonly<{
  /** Actual bound rendezvous address. */
  address: string
  /** Stop new candidates and release pending ones; adopted leases remain with their adopters. */
  close(): Promise<void>
}>

/** Authenticated native candidates can be adopted once or rejected without a second handshake. */
export type IProcessRegistrationListenOptions = Readonly<{
  /** Reverse registration accepts the native protocol only, not JSON-RPC. */
  wire: 'native'
  /** Borrowed platform-specific authenticated listener implementation. */
  listen: IListenProcessByteChannel
  /** Address consumed by that listener without rewriting explicit paths. */
  address: string
  /** Unix rendezvous paths require a stable owner identity before binding. */
  serviceId?: string
  /** Local proposal used for each candidate's one responder handshake. */
  offer: IRpcHandshakeOffer
  /** Supply per-connection routing and nonsecret log identities before acceptance. */
  createConnectionContext(pending: IProcessPendingByteConnection): Readonly<{
    peerId: string
    ipc: IProcessCommonOptions['ipc']
  }>
  /** Authenticate the token and return a stable nonempty principal. */
  verifyToken(auth: IRpcPortableValue | undefined, peer: IRpcPeerInfo): string | Promise<string>
  /** Return adopt to take the lease, or reject to release it; rejection also releases the candidate. */
  onCandidate(
    candidate: IProcessSessionLease & Readonly<{ signal: IAbortSignal }>
  ): 'adopt' | 'reject' | Promise<'adopt' | 'reject'>
  /** Optional handshake clock forwarded to accept; omission selects the shared system scheduler. */
  scheduler?: IScheduler
  /** Optional per-handshake deadline forwarded to the platform accept operation. */
  handshakeTimeoutMs?: number
  /** Optional cancellation for listening and in-progress candidate admission. */
  signal?: IAbortSignal
}>

/** Bounded defaults are selected at construction; the scheduler and reporter are caller owned. */
export type IProcessResilienceOptions = Readonly<{
  /** Borrowed monotonic scheduler required for quotas, idle checks, and diagnostic offsets. */
  scheduler: IScheduler
  /** Required diagnostic sink; failures are forwarded to the host reporter. */
  report(error: unknown): void
  /** Borrowed replay store; omission creates one store scoped to this governor. */
  idempotencyStore?: IRpcIdempotencyStore
  /** Positive safe-integer physical connection capacity; defaults to 64. */
  maxConnections?: number
  /** Positive safe-integer per-connection global and per-peer call limit; defaults to 32. */
  maxConcurrentCallsPerConnection?: number
  /** Positive safe-integer per-connection minute quota; defaults to 600. */
  maxCallsPerMinute?: number
  /** Positive safe-integer payload admission bound; defaults to 16777216 bytes. */
  maxPayloadBytes?: number
  /** Positive safe-integer consecutive timeout threshold per connection; defaults to 3. */
  maxConsecutiveTimeouts?: number
  /** Positive safe-integer idle budget; defaults to 60000 milliseconds. */
  idleTimeoutMs?: number
  /** Positive safe-integer retirement drain budget; defaults to 5000 milliseconds. */
  drainMs?: number
  /**
   * At least two increasing safe-integer offsets starting at zero; defaults to
   * [0,60000,300000,900000].
   */
  reportAtMs?: readonly number[]
  /** Positive safe-integer unhandled threshold; defaults to 3, so the fourth starts liquidation. */
  unhandledLimit?: number
  /** Cascade defaults to false: suspend actual dependants instead of removing their closure. */
  liquidation?: Readonly<{ cascade?: boolean }>
}>

/** One owner coordinates scoped sessions, native registration, terminal policy, and release. */
export type IProcessResilience = Readonly<{
  /** Derive a shared replay store/scope by principal and frozen per-connection provider limits. */
  sessionOptions(identity: IProcessSessionIdentity): Readonly<{
    idempotency: IRpcIdempotencyConfig
    limits: IRpcProviderLimits
  }>
  /** Bind authenticated reverse registration; adopted leases transfer out of listener ownership. */
  listenRegistrations(
    options: IProcessRegistrationListenOptions
  ): Promise<IProcessRegistrationListener>
  /**
   * Attach one unique nonempty name and its borrowed supervisor; invalid bindings reject
   * synchronously.
   */
  attachRegistration(
    name: string,
    binding: IProcessRegistrationBinding,
    liquidation: IProcessLiquidationOwner
  ): IProcessRegistration
  /** Return a stable guard that rejects terminal or liquidated registrations before remote dispatch. */
  callGuard(name: string): IRemoteCallGuard
  /**
   * Read active or retained committed-liquidation diagnostics; unknown and normally closed names
   * return undefined.
   */
  inspect(id: string): IProcessResilienceSnapshot | undefined
  /**
   * Observe terminal entries; any fulfilled observer handles the report, while rejected observers
   * are reported.
   */
  onTerminal(listener: (snapshot: IProcessResilienceSnapshot) => void | Promise<void>): () => void
  /**
   * Share one release Promise for listeners/registrations; aggregate failures as
   * PROCESS_CHANNEL_CLOSED.
   */
  close(): Promise<void>
}>
