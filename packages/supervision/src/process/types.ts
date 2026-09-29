import type { IWallClock, IScheduler } from '@migaia/utils/scheduler'
import type {
  ILaunchContext,
  IUnitBudget,
  IUnitHandle,
  IUnitIdentity,
  IUnitLauncher,
  IUnitLease,
  ISupervisor,
  ISupervisorBaseOptions,
  IsolationMode,
  TerminationMode
} from '../index.js'
import type {
  BootstrapVia,
  DrainedStream,
  OrphanProbeResult,
  StderrMode,
  StdinMode,
  StdoutMode
} from './constants.js'

/** Explicit environment allowlist; launchers cannot add ambient variables. */
export type IProcessEnv = {
  readonly inherit: readonly string[]
  readonly set: Readonly<Record<string, string>>
}
/** Stdio carrier selection for the launcher. */
export type IProcessStdio = {
  readonly stdin: StdinMode
  readonly stdout: StdoutMode
  readonly stderr: StderrMode
}
/** Relative limits; wall time is enforced by the consumer, not this profile. */
export type IProcessLimits = {
  readonly memoryBytes?: number
  readonly cpuTimeMs?: number
  readonly callWallTimeMs?: number
}
/** Secret payload may travel only as a stdin prefix or through a dedicated fd. */
export type IProcessBootstrap = {
  readonly via: BootstrapVia
  readonly fd?: number
  readonly payload: Uint8Array
}
/** Closed, shell-free launch specification. */
export type IProcessSpec = {
  readonly command: string
  readonly args: readonly string[]
  readonly cwd?: string
  readonly tmpDir?: string
  readonly env: IProcessEnv
  readonly stdio: IProcessStdio
  readonly limits?: IProcessLimits
  readonly permissions?: readonly string[]
  readonly bootstrap?: IProcessBootstrap
}
/** Optional usage fields supplied by an adapter. */
export type IProcessUsage = { readonly rssBytes?: number; readonly cpuTimeMs?: number }
/** Native termination status returned after all launcher resources have closed. */
export type IProcessExitStatus = { readonly code: number | null; readonly signal: string | null }
/** Fingerprint distinguishes repeated use of one pid across parent runs. */
export type IProcessIdentity = IUnitIdentity & { readonly pid?: number }
/** One launched process; termination is idempotent and addresses the entire declared container. */
export type IProcessHandle = IUnitHandle<IProcessExitStatus> & {
  readonly identity: IProcessIdentity
  terminate(mode: TerminationMode): void
  sampleUsage?(): Promise<IProcessUsage>
}
/** Output is drained by the launcher from startup, regardless of consumer speed. */
export type IProcessLaunchContext = ILaunchContext & {
  output(stream: DrainedStream, chunk: Uint8Array): void
}
/** Durable record of an active process. */
export type IProcessRecord = {
  readonly id: string
  readonly namespace: string
  readonly identity: IProcessIdentity
  readonly launchedAt: number
}
/** Duplicate add fails; removing an absent id succeeds without effect. */
export type IProcessRegistry = {
  add(record: IProcessRecord): Promise<void>
  remove(id: string): Promise<void>
  list(namespace: string): Promise<readonly IProcessRecord[]>
}
/** Launcher owns actual process creation and fingerprint-aware recovery probes. */
export type IProcessLauncher<THandle extends IProcessHandle = IProcessHandle> = IUnitLauncher<
  IProcessSpec,
  THandle,
  IProcessLaunchContext
> & {
  probe?(record: IProcessRecord): Promise<OrphanProbeResult>
  terminateRecord?(record: IProcessRecord): Promise<void>
}
/** Process budget is the shared unit budget with a fixed kind. */
export type IProcessBudget = IUnitBudget<'process'>
/** Handover of a ready idle process and its occupied budget lease. */
export type IPrewarmEntry<THandle extends IProcessHandle> = {
  readonly handle: THandle
  readonly lease: IUnitLease
  bindOutput(sink: IProcessLaunchContext['output']): void
}
/** Independent pool of idle processes; ownership moves on take. */
export type IPrewarmPool<THandle extends IProcessHandle> = {
  readonly id: string
  readonly spec: IProcessSpec
  readonly budget: IProcessBudget
  readonly launcher: IProcessLauncher<THandle>
  readonly idle: number
  take(): IPrewarmEntry<THandle> | undefined
  invalidate(): void
  dispose(): Promise<void>
}
/** Process-specific hooks and optional pool combined above the core supervisor. */
export type IProcessSupervisorOptions<THandle extends IProcessHandle> =
  ISupervisorBaseOptions<THandle> & {
    readonly launcher: IProcessLauncher<THandle>
    readonly spec: IProcessSpec
    readonly budget: IProcessBudget
    readonly usage?: { readonly intervalMs?: number; readonly failureThreshold?: number }
    readonly output?: {
      readonly tailBytes?: number
      readonly onChunk?: (stream: DrainedStream, chunk: Uint8Array) => void
    }
    readonly registry?: { readonly port: IProcessRegistry; readonly namespace: string }
    readonly prewarm?: IPrewarmPool<THandle>
    readonly wallClock?: IWallClock
  }
/** Core command surface with a process specification. */
export type IProcessSupervisor<THandle extends IProcessHandle> = ISupervisor<THandle, IProcessSpec>
/** Options for a bounded, non-restarting pool of idle processes. */
export type IPrewarmPoolOptions<THandle extends IProcessHandle> = {
  readonly id: string
  readonly launcher: IProcessLauncher<THandle>
  readonly spec: IProcessSpec
  readonly budget: IProcessBudget
  readonly size: number
  readonly report: (error: unknown) => void
  readonly isolation?: IsolationMode
  readonly requires?: readonly string[]
  readonly registry?: { readonly port: IProcessRegistry; readonly namespace: string }
  readonly usage?: { readonly intervalMs?: number; readonly failureThreshold?: number }
  readonly startupTimeoutMs?: number
  readonly idleTimeoutMs?: number
  readonly exitTimeoutMs?: number
  readonly reapTimeoutMs?: number
  readonly scheduler?: IScheduler
  readonly wallClock?: IWallClock
}
