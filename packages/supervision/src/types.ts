import type { IAbortSignal, ILifecycleScope } from '@migaia/lifecycle'
import type { IScheduler } from '@migaia/utils/scheduler'
import type {
  BudgetOverflow,
  BudgetRejection,
  CapabilityLevel,
  ExitReason,
  IsolationMode,
  LaunchCause,
  ReplaceStrategy,
  RestartMode,
  SupervisorState,
  TerminationMode
} from './constants.js'

/** Stable identity of one launched unit. */
export type IUnitIdentity = { readonly fingerprint: string }
/** `exited` fulfills only after the unit and launcher-owned resources have stopped. */
export type IUnitHandle<TExit> = {
  readonly identity: IUnitIdentity
  readonly exited: Promise<TExit>
}
/** Attempt-scoped cancellation; active units own a separate runtime signal. */
export type ILaunchContext = { readonly signal: IAbortSignal }
/** Unit-specific launcher with declared capability strengths. */
export type IUnitLauncher<TSpec, THandle, TContext extends ILaunchContext = ILaunchContext> = {
  readonly capabilities: Readonly<Record<string, CapabilityLevel>>
  launch(spec: TSpec, context: TContext): Promise<THandle>
}
/** Profile-owned exit classification and original failure. */
export type IExitClassification = {
  readonly reason: 'exited' | 'crashed' | 'resource-violation'
  readonly detail?: Readonly<Record<string, unknown>>
  readonly cause?: unknown
}
/** Unit resource scopes: monitors release before the unit and attachments afterwards. */
export type IUnitRuntime = {
  readonly generation: number
  readonly scope: ILifecycleScope
  readonly monitors: ILifecycleScope
  readonly signal: IAbortSignal
}
/** Contract for one kind of unit, independent of its execution mechanism. */
export type IUnitProfile<
  TSpec,
  THandle extends IUnitHandle<TExit>,
  TExit,
  TContext extends ILaunchContext = ILaunchContext
> = {
  readonly kind: string
  readonly gracefulTermination: boolean
  requirements(spec: TSpec): readonly string[]
  validateSpec(spec: TSpec): void
  launchContext?(base: ILaunchContext, unit: IUnitRuntime): TContext
  terminate(handle: THandle, mode: TerminationMode): void
  classifyExit(status: TExit): IExitClassification
}
/** Idempotent ownership of one occupied budget slot. */
export type IUnitLease = { release(): void }
/** A budget grants a lease or returns a stable refusal reason. */
export type IBudgetOutcome =
  | { readonly kind: 'granted'; readonly lease: IUnitLease }
  | { readonly kind: 'rejected'; readonly reason: BudgetRejection }
/** Limits and optional parent for one kind of unit. */
export type IUnitBudgetOptions<TKind extends string> = {
  /** Unit kind kept on granted leases so process, thread and coroutine budgets cannot be mixed. */
  readonly kind: TKind
  /** Maximum simultaneously granted leases; queued requests do not occupy a unit slot. */
  readonly maxUnits: number
  /** Chooses reject or queue when all unit slots are occupied; defaults to reject. */
  readonly overflow?: BudgetOverflow
  /**
   * Maximum scheduler-time wait for a queued unit request; expiry returns a rejected admission
   * outcome.
   */
  readonly queueTimeoutMs?: number
  /** Optional sliding-window launch-rate limit in addition to the concurrent unit limit. */
  readonly launchRate?:
    | {
        /** Maximum leases granted during one launch-rate window. */
        readonly max: number
        /** Scheduler-time duration in milliseconds for the launch-rate window. */
        readonly windowMs: number
      }
    | false
  /** Optional parent budget acquired before the local lease; release returns both occupied slots. */
  readonly parent?: IUnitBudget<TKind>
  /** Owns monotonic deadlines, restart delays and health timers; omission uses systemScheduler. */
  readonly scheduler?: IScheduler
}
/** Shared admission controller; granted leases survive close. */
export type IUnitBudget<TKind extends string> = {
  readonly kind: TKind
  acquire(signal?: IAbortSignal): Promise<IBudgetOutcome>
  tryAcquire(): IBudgetOutcome
  readonly inUse: number
  readonly pending: number
  readonly closed: boolean
  close(): void
}
/** Extension hooks supplied by a unit profile or outer adapter. */
export type ISupervisionHooks<TSpec, THandle> = {
  acquireUnit?(request: {
    readonly cause: LaunchCause
    readonly spec: TSpec
  }): { readonly handle: THandle; readonly lease: IUnitLease } | undefined
  afterLaunch?(handle: THandle, unit: IUnitRuntime): PromiseLike<void>
  onReady?(
    handle: THandle,
    unit: IUnitRuntime,
    fail: (
      reason: 'resource-violation' | 'unhealthy',
      detail: Readonly<Record<string, unknown>>,
      cause?: unknown
    ) => void
  ): void
  inspectUnit?(handle: THandle): Readonly<Record<string, unknown>>
}
/** Policy shared by all unit profiles. */
export type ISupervisorBaseOptions<THandle> = {
  /** Stable supervisor identity used in unit diagnostics and durable ownership records. */
  readonly id: string
  /** Required sink for contained launch, health, cleanup and late failures; it must not throw. */
  readonly report: (error: unknown) => void
  /**
   * Optional readiness handshake run after launch; honor its cancellation signal and settle before
   * the startup deadline.
   */
  readonly ready?: (unit: THandle, signal: IAbortSignal) => PromiseLike<void>
  /** Maximum launch and readiness time in scheduler milliseconds; defaults to 10000. */
  readonly startupTimeoutMs?: number
  /** Restart mode and bounded exponential backoff after profile-classified retryable exit. */
  readonly restart?: {
    /** Selects never, on-failure or always restart after exit; defaults to on-failure. */
    readonly mode?: RestartMode
    /** First automatic restart delay in scheduler milliseconds; defaults to 250. */
    readonly initialDelayMs?: number
    /** Multiplier for successive restart delays; defaults to 2 and remains bounded by maxDelayMs. */
    readonly factor?: number
    /** Upper bound on exponential restart delay in milliseconds; defaults to 30000. */
    readonly maxDelayMs?: number
    /** Maximum restart attempts in the sliding window before the supervisor enters terminal state. */
    readonly maxRestarts?: number
    /** Sliding scheduler-time window used to count restart attempts; defaults to 60000 milliseconds. */
    readonly windowMs?: number
  }
  /** Chooses permanent terminal state or an explicit cooldown before allowing another generation. */
  readonly terminalPolicy?:
    | {
        /** Keeps admission permanently closed after terminal state. */
        readonly mode: 'stay'
      }
    | {
        /** Reopens admission after the explicit cooldown duration. */
        readonly mode: 'cooldown'
        /** Scheduler milliseconds to wait before admitting a new generation. */
        readonly afterMs: number
      }
  /**
   * Ordered shutdown policy for draining application work, requesting exit and finally reaping the
   * unit.
   */
  readonly stop?: {
    /** Optional cancellable drain callback invoked before profile-specific termination. */
    readonly beforeTerminate?: (unit: THandle, signal: IAbortSignal) => PromiseLike<void>
    /** Maximum application drain time before termination proceeds; defaults to 5000 milliseconds. */
    readonly drainTimeoutMs?: number
    /** Maximum wait for graceful actual exit before hard termination; defaults to 5000 milliseconds. */
    readonly exitTimeoutMs?: number
    /** Maximum wait for actual exit after hard termination; defaults to 5000 milliseconds. */
    readonly reapTimeoutMs?: number
  }
  /**
   * Periodic cancellable health checks for a ready unit; repeated failure invalidates that
   * generation.
   */
  readonly health?: {
    /**
     * Checks the current unit and rejects on unhealthy state; honor the provided cancellation
     * signal.
     */
    readonly check: (unit: THandle, signal: IAbortSignal) => PromiseLike<void>
    /** Scheduler interval between health checks; defaults to 5000 milliseconds. */
    readonly intervalMs?: number
    /** Maximum duration of one health check; defaults to 2000 milliseconds. */
    readonly timeoutMs?: number
    /** Consecutive failed checks required to declare the ready generation unhealthy; defaults to 3. */
    readonly failureThreshold?: number
  }
  /**
   * Requires declared launcher capabilities or explicitly accepts cooperative isolation; defaults
   * to required.
   */
  readonly isolation?: IsolationMode
  /** Additional launcher capabilities checked together with the profile requirements before launch. */
  readonly requires?: readonly string[]
  /** Owns monotonic deadlines, restart delays and health timers; omission uses systemScheduler. */
  readonly scheduler?: IScheduler
}
/** Core supervisor construction contract. */
export type ISupervisorOptions<
  TSpec,
  THandle extends IUnitHandle<TExit>,
  TExit,
  TContext extends ILaunchContext
> = ISupervisorBaseOptions<THandle> & {
  /**
   * Runtime adapter that creates handles and reports actual exit; the supervisor does not launch
   * native resources itself.
   */
  readonly launcher: IUnitLauncher<TSpec, THandle, TContext>
  /** Initial launch specification validated by the profile before any unit is admitted. */
  readonly spec: TSpec
  /** Shared unit admission budget; its lease remains occupied until actual unit exit. */
  readonly budget: IUnitBudget<string>
  /**
   * Unit-kind policy for specification validation, capability requirements, exit classification and
   * termination.
   */
  readonly profile: IUnitProfile<TSpec, THandle, TExit, TContext>
  /** Adapter extension points for prewarmed admission, post-launch setup and ready-unit diagnostics. */
  readonly hooks?: ISupervisionHooks<TSpec, THandle>
}
/** Nonthrowing readiness observation. */
export type IReadyOutcome<THandle> =
  | { readonly state: 'ready'; readonly generation: number; readonly unit: THandle }
  | { readonly state: 'stopped'; readonly rejection?: BudgetRejection }
  | { readonly state: 'terminal' | 'disposed' | 'idle' }
/** Nonthrowing replacement outcome. */
export type IReplaceOutcome =
  | { readonly kind: 'replaced'; readonly generation: number }
  | { readonly kind: 'rejected'; readonly reason: BudgetRejection | 'terminal' | 'stopped' }
  | { readonly kind: 'failed'; readonly error: unknown }
/** Read-only view of current supervisor state and diagnostics. */
export type ISupervisorSnapshot = {
  readonly kind: string
  readonly state: SupervisorState
  readonly generation: number
  readonly identity?: IUnitIdentity
  readonly failuresInWindow: number
  readonly lastExit?: {
    readonly generation: number
    readonly reason: ExitReason
    readonly error?: unknown
  }
  readonly terminalError?: unknown
  readonly terminalEntries: number
  readonly degraded: readonly string[]
  readonly abandoned: number
  readonly unit?: Readonly<Record<string, unknown>>
}
/** State, exit, terminal, and replacement observations. */
export type ISupervisorEvent<THandle> =
  | {
      readonly type: 'state'
      readonly from: SupervisorState
      readonly to: SupervisorState
      readonly generation: number
    }
  | {
      readonly type: 'exit'
      readonly generation: number
      readonly reason: ExitReason
      readonly error?: unknown
    }
  | { readonly type: 'terminal'; readonly error: unknown; readonly entry: number }
  | {
      readonly type: 'switched'
      readonly from: number
      readonly to: number
      readonly unit: THandle
    }
/** Public command and inspection surface of a supervisor. */
export type ISupervisor<THandle, TSpec> = {
  readonly state: SupervisorState
  readonly generation: number
  start(): Promise<IReadyOutcome<THandle>>
  whenReady(signal?: IAbortSignal): Promise<IReadyOutcome<THandle>>
  stop(): Promise<void>
  restart(): Promise<IReadyOutcome<THandle>>
  replace(options?: {
    readonly strategy?: ReplaceStrategy
    readonly spec?: TSpec
  }): Promise<IReplaceOutcome>
  inspect(): ISupervisorSnapshot
  subscribe(listener: (event: ISupervisorEvent<THandle>) => void): () => void
  dispose(): Promise<void>
}
