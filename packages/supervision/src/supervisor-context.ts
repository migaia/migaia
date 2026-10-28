/** Internal supervisor state shared explicitly by command, policy, attempt and exit modules. */
import type {
  createGenerationController,
  createMutationQueue,
  createTerminalController
} from '@migaia/lifecycle'
import type { IScheduler, IScheduledTask } from '@migaia/utils/scheduler'
import type { LaunchCause, RestartMode, SupervisorState } from './constants.js'
import type { TimestampWindow } from './timestamp-window.js'
import type { IManagedSlot } from './supervisor-slot.js'
import type {
  ILaunchContext,
  IReadyOutcome,
  ISupervisorEvent,
  ISupervisorOptions,
  ISupervisorSnapshot,
  IUnitHandle
} from './types.js'

/** One owner context; runtime modules consume it without captured component variables. */
export type ISupervisorContext<
  TSpec,
  THandle extends IUnitHandle<TExit>,
  TExit,
  TContext extends ILaunchContext
> = {
  /** Original caller contract, retained without rebuilding hooks. */
  readonly options: ISupervisorOptions<TSpec, THandle, TExit, TContext>
  /** Canonical clock for every deadline and observation. */
  readonly scheduler: IScheduler
  /** Construction diagnostics are reported only on the first explicit start. */
  readonly admission: {
    readonly degraded: readonly string[]
    readonly diagnostics: readonly Error[]
  }
  /** Lifecycle owns serialization, attempt authority and terminal closure. */
  readonly commands: ReturnType<typeof createMutationQueue>
  readonly attempts: ReturnType<typeof createGenerationController>
  readonly terminal: ReturnType<typeof createTerminalController>
  /** Subscriber and waiter records are removed by unsubscribe or settlement. */
  readonly listeners: Set<(event: ISupervisorEvent<THandle>) => void>
  /** Membership changes invalidate this immutable event snapshot; unchanged events reuse it. */
  listenerSnapshot: readonly ((event: ISupervisorEvent<THandle>) => void)[] | undefined
  readonly waiters: Set<() => void>
  /** Retry history uses a cursor rather than repeatedly moving surviving timestamps. */
  readonly failures: TimestampWindow
  /** Policy timers enter the same owner command path as explicit starts. */
  readonly launch: (cause: LaunchCause) => Promise<IReadyOutcome<THandle>>
  /** Observable state and serving/candidate ownership remain independent of attempt generation. */
  state: SupervisorState
  active: IManagedSlot<TSpec, THandle, TExit, TContext> | undefined
  candidate: IManagedSlot<TSpec, THandle, TExit, TContext> | undefined
  /** A replacement transaction retains old-unit failure facts until candidate completion. */
  replacementInProgress: boolean
  replacementOldFailure: unknown
  replacementOldNormalExit: boolean
  /** Only a successful replacement commits the next specification and degradation set. */
  spec: TSpec
  degraded: readonly string[]
  degradationReported: boolean
  /** Stable facts remain observable after shutdown and late native exits. */
  lastExit: ISupervisorSnapshot['lastExit']
  terminalError: unknown
  terminalEntries: number
  abandoned: number
  restartCount: number
  executionGeneration: number
  /** Joiners share exact original command promises, cleared at their original settlement points. */
  pendingStart: Promise<IReadyOutcome<THandle>> | undefined
  pendingStop: Promise<void> | undefined
  pendingDispose: Promise<void> | undefined
  /** Retry timers are cancelled before commands and again when shutdown reaches the queue head. */
  backoffTimer: IScheduledTask | undefined
  cooldownTimer: IScheduledTask | undefined
  /** Admitted retry and deadline values preserve construction-time option capture. */
  readonly restartMode: RestartMode
  readonly maxRestarts: number
  readonly windowMs: number
  readonly initialDelayMs: number
  readonly factor: number
  readonly maxDelayMs: number
  readonly startupTimeoutMs: number
  readonly reapTimeoutMs: number
}
