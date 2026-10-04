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
    /**
     * Runtime adapter that creates handles and reports actual exit; the supervisor does not launch
     * native resources itself.
     */
    readonly launcher: IProcessLauncher<THandle>
    /** Initial launch specification validated by the profile before any unit is admitted. */
    readonly spec: IProcessSpec
    /** Shared unit admission budget; its lease remains occupied until actual unit exit. */
    readonly budget: IProcessBudget
    /** Optional native usage sampling policy for process resource-limit enforcement. */
    readonly usage?: {
      /** Scheduler interval between native process memory and CPU usage samples. */
      readonly intervalMs?: number
      /** Consecutive resource-limit violations required before terminating the process. */
      readonly failureThreshold?: number
    }
    /** Policy for bounded stdout and stderr tails and optional streaming chunk observation. */
    readonly output?: {
      /** Maximum bytes retained separately for each stdout and stderr diagnostic tail. */
      readonly tailBytes?: number
      /** Receives drained stdout or stderr bytes; observation does not own the launcher drain loop. */
      readonly onChunk?: (stream: DrainedStream, chunk: Uint8Array) => void
    }
    /** Durable process record owner used for fingerprint-aware recovery after parent loss. */
    readonly registry?: {
      /** Storage port that adds, removes and lists durable process identity records. */
      readonly port: IProcessRegistry
      /** Isolation key that restricts recovery and record listing to this application owner. */
      readonly namespace: string
    }
    /** Optional pool that transfers a ready idle handle together with its still-occupied lease. */
    readonly prewarm?: IPrewarmPool<THandle>
    /** Epoch timestamp provider used only for durable records; deadlines still use scheduler time. */
    readonly wallClock?: IWallClock
  }
/** Core command surface with a process specification. */
export type IProcessSupervisor<THandle extends IProcessHandle> = ISupervisor<THandle, IProcessSpec>
/** Options for a bounded, non-restarting pool of idle processes. */
export type IPrewarmPoolOptions<THandle extends IProcessHandle> = {
  /** Stable supervisor identity used in unit diagnostics and durable ownership records. */
  readonly id: string
  /**
   * Runtime adapter that creates handles and reports actual exit; the supervisor does not launch
   * native resources itself.
   */
  readonly launcher: IProcessLauncher<THandle>
  /** Initial launch specification validated by the profile before any unit is admitted. */
  readonly spec: IProcessSpec
  /** Shared unit admission budget; its lease remains occupied until actual unit exit. */
  readonly budget: IProcessBudget
  /** Target number of ready idle processes; every pooled handle consumes the shared process budget. */
  readonly size: number
  /** Required sink for contained launch, health, cleanup and late failures; it must not throw. */
  readonly report: (error: unknown) => void
  /**
   * Requires declared launcher capabilities or explicitly accepts cooperative isolation; defaults
   * to required.
   */
  readonly isolation?: IsolationMode
  /** Additional launcher capabilities checked together with the profile requirements before launch. */
  readonly requires?: readonly string[]
  /** Durable process record owner used for fingerprint-aware recovery after parent loss. */
  readonly registry?: {
    /** Storage port that adds, removes and lists durable process identity records. */
    readonly port: IProcessRegistry
    /** Isolation key that restricts recovery and record listing to this application owner. */
    readonly namespace: string
  }
  /** Optional native usage sampling policy for process resource-limit enforcement. */
  readonly usage?: {
    /** Scheduler interval between native process memory and CPU usage samples. */
    readonly intervalMs?: number
    /** Consecutive resource-limit violations required before terminating the process. */
    readonly failureThreshold?: number
  }
  /** Maximum launch and readiness time in scheduler milliseconds; defaults to 10000. */
  readonly startupTimeoutMs?: number
  /** Maximum time to retain an unused prewarmed process before disposing its handle. */
  readonly idleTimeoutMs?: number
  /** Maximum graceful exit wait when shutting down a prewarm entry. */
  readonly exitTimeoutMs?: number
  /** Maximum actual-exit wait after hard termination of a prewarm entry. */
  readonly reapTimeoutMs?: number
  /** Owns monotonic deadlines, restart delays and health timers; omission uses systemScheduler. */
  readonly scheduler?: IScheduler
  /** Epoch timestamp provider used only for durable records; deadlines still use scheduler time. */
  readonly wallClock?: IWallClock
}
