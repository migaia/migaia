import type { IAbortSignal, INativeAbortSignal } from '@migaia/utils/promise'
import type { ILifecycleScope } from '@migaia/lifecycle'
import type { IScheduler } from '@migaia/utils/scheduler'
import type {
  BudgetOverflow,
  BudgetRejection,
  CapabilityLevel,
  ExitReason,
  HealthState,
  IsolationMode,
  LaunchCause,
  ReplaceStrategy,
  RestartMode,
  SupervisorState,
  TerminationMode
} from './constants.ts'

/** Stable identity of one launched unit. */
export type IUnitIdentity = { readonly fingerprint: string }
/** `exited` fulfills only after the unit and launcher-owned resources have stopped. */
export type IUnitHandle<TExit> = {
  readonly identity: IUnitIdentity
  readonly exited: Promise<TExit>
}
/** Attempt-scoped cancellation; active units own a separate runtime signal. */
export type ILaunchContext = {
  readonly signal: INativeAbortSignal
  /** Cold ordinal reserved by the original supervisor; only a ready promotion advances it. */
  readonly executionGeneration?: number
}
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
/** Native exit facts are projected by the owning profile, without arbitrary status reflection. */
export type IUnitExitStatus = Readonly<{ code: number | null; signal?: string | null }>
/** A per-command grace only bounds the existing application drain phase. */
export type ISupervisorStopOptions = Readonly<{ graceMs?: number }>
/** Unit resource scopes: monitors release before the unit and attachments afterwards. */
export type IUnitRuntime = {
  readonly generation: number
  readonly scope: ILifecycleScope
  readonly monitors: ILifecycleScope
  readonly signal: INativeAbortSignal
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
  /** Preserve actual native status even for a manually stopped or force-retired unit. */
  exitStatus?(status: TExit): IUnitExitStatus
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
  /**
   * Maximum occupied local slots, including reservations waiting for a parent. Requests waiting for
   * local capacity do not occupy a slot.
   */
  readonly maxUnits: number
  /** Chooses reject or queue when all unit slots are occupied; defaults to queue. */
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
  /**
   * Optional parent budget: acquire reserves a local slot while waiting for the parent. Release
   * returns the parent slot before the local slot; a reservation is not a launched unit.
   */
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
  /**
   * Chooses whether terminal policy waits for explicit restart or schedules an automatic cooldown
   * retry.
   */
  readonly terminalPolicy?:
    | {
        /**
         * Stays terminal until an explicit restart resets policy; dispose remains permanently
         * closed.
         */
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
    readonly beforeTerminate?: (
      unit: THandle,
      signal: INativeAbortSignal,
      remainingMs: () => number
    ) => PromiseLike<void>
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
export type IHealthSnapshot = Readonly<{
  state: HealthState
  failures: number
  observedAt?: number
}>
/** Read-only view of current supervisor state and diagnostics. */
export type ISupervisorSnapshot = {
  readonly kind: string
  readonly state: SupervisorState
  readonly generation: number
  readonly identity?: IUnitIdentity
  readonly failuresInWindow: number
  /** Lifetime successful restart causes, excluding initial start and replacement. */
  readonly restartCount?: number
  /** Absent without a current monitor; pending does not claim a successful check. */
  readonly health?: IHealthSnapshot
  readonly lastExit?: {
    readonly generation: number
    readonly reason: ExitReason
    readonly error?: unknown
    readonly status?: IUnitExitStatus
    readonly observedAt?: number
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
      readonly status?: IUnitExitStatus
      readonly observedAt?: number
    }
  | { readonly type: 'terminal'; readonly error: unknown; readonly entry: number }
  | {
      readonly type: 'switched'
      readonly from: number
      readonly to: number
      readonly unit: THandle
    }
  | {
      readonly type: 'restart'
      readonly generation: number
      readonly count: number
      readonly observedAt: number
    }
  | {
      readonly type: 'degraded'
      readonly generation: number
      readonly degraded: readonly string[]
      readonly observedAt: number
    }
/** Public command and inspection surface of a supervisor. */
export type ISupervisor<THandle, TSpec> = {
  /** Current lifecycle state; changes are also published as `state` events. */
  readonly state: SupervisorState
  /** Number of the latest start attempt; a successful start identifies the serving unit. */
  readonly generation: number
  /**
   * Starts the unit, retrying through backoff, and resolves with a stable answer: `ready` with the
   * unit, `stopped` (possibly with a budget rejection) or `terminal`. Unit failures never reject;
   * only a disposed supervisor rejects. Calling it while ready or starting joins the same answer.
   */
  start(): Promise<IReadyOutcome<THandle>>
  /** Waits for the next stable answer without starting anything; `signal` abandons the wait. */
  whenReady(signal?: IAbortSignal): Promise<IReadyOutcome<THandle>>
  /**
   * Stops the current attempt and unit through the bounded drain, exit and reap phases, then
   * settles in `stopped`. It returns on time even if the unit ignores stop; that unit keeps its
   * budget slot until it actually exits. Concurrent calls share one promise; `graceMs` shortens the
   * drain phase.
   */
  stop(options?: ISupervisorStopOptions): Promise<void>
  /** Immediately upgrades the original slot teardown; joiners retain the pending stop promise. */
  kill(): Promise<void>
  /** Clears the failure window, stops the current unit and starts a fresh one, even from `terminal`. */
  restart(): Promise<IReadyOutcome<THandle>>
  /**
   * Replaces the serving unit, optionally with a new spec. `stop-then-start` (default) stops first;
   * `start-then-switch` switches only after the new unit is ready, then stops the old one. A failed
   * replacement resolves `failed` or `rejected` and leaves a still-serving old unit in place.
   */
  replace(options?: {
    readonly strategy?: ReplaceStrategy
    readonly spec?: TSpec
  }): Promise<IReplaceOutcome>
  /** Reads state, last exit, failure window, health and degradation without side effects. */
  inspect(): ISupervisorSnapshot
  /** Registers an event listener and returns its unsubscribe function; listener errors are reported. */
  subscribe(listener: (event: ISupervisorEvent<THandle>) => void): () => void
  /** Stops like `stop()` and closes the supervisor for good; later commands are rejected. */
  dispose(): Promise<void>
}
