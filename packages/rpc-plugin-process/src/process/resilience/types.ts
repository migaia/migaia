/**
 * Defines readonly native supervision, terminal diagnostics and committed dependency-liquidation
 * ports. Each operation keeps its original PluginHost or standalone resource authority.
 */
import type { IPluginDependencyPlan, IPluginRemoval } from '@migaia/plugin-host'
import type { IReadyOutcome, ISupervisorSnapshot } from '@migaia/supervision'
import type { IScheduler } from '@migaia/utils/scheduler'
import type { ProcessConnectionCapacity } from '../plugin/serve/admission.ts'

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

/** Native policy retains only physical capacity, drain and original terminal diagnostics. */
export type IProcessResilienceOptions = Readonly<{
  scheduler: IScheduler
  report(error: unknown): void
  maxConnections?: number
  drainMs?: number
  reportAtMs?: readonly number[]
  unhandledLimit?: number
  liquidation?: Readonly<{ cascade?: boolean }>
}>
/** This actual native governor owns no provider limits, replay store or request facade. */
export type IProcessResilience = Readonly<{
  connections: ProcessConnectionCapacity
  options: Readonly<{ drainMs: number }>
  attachRegistration(
    name: string,
    binding: IProcessRegistrationBinding,
    liquidation: IProcessLiquidationOwner
  ): IProcessRegistration
  assertAvailable(name: string): void
  inspect(id: string): IProcessResilienceSnapshot | undefined
  onTerminal(listener: (snapshot: IProcessResilienceSnapshot) => void | Promise<void>): () => void
  onLiquidated(listener: (snapshot: IProcessResilienceSnapshot) => unknown): () => void
  close(): Promise<void>
}>
