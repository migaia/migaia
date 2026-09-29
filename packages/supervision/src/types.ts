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
  readonly kind: TKind
  readonly maxUnits: number
  readonly overflow?: BudgetOverflow
  readonly queueTimeoutMs?: number
  readonly launchRate?: { readonly max: number; readonly windowMs: number } | false
  readonly parent?: IUnitBudget<TKind>
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
  readonly id: string
  readonly report: (error: unknown) => void
  readonly ready?: (unit: THandle, signal: IAbortSignal) => PromiseLike<void>
  readonly startupTimeoutMs?: number
  readonly restart?: {
    readonly mode?: RestartMode
    readonly initialDelayMs?: number
    readonly factor?: number
    readonly maxDelayMs?: number
    readonly maxRestarts?: number
    readonly windowMs?: number
  }
  readonly terminalPolicy?:
    | { readonly mode: 'stay' }
    | { readonly mode: 'cooldown'; readonly afterMs: number }
  readonly stop?: {
    readonly beforeTerminate?: (unit: THandle, signal: IAbortSignal) => PromiseLike<void>
    readonly drainTimeoutMs?: number
    readonly exitTimeoutMs?: number
    readonly reapTimeoutMs?: number
  }
  readonly health?: {
    readonly check: (unit: THandle, signal: IAbortSignal) => PromiseLike<void>
    readonly intervalMs?: number
    readonly timeoutMs?: number
    readonly failureThreshold?: number
  }
  readonly isolation?: IsolationMode
  readonly requires?: readonly string[]
  readonly scheduler?: IScheduler
}
/** Core supervisor construction contract. */
export type ISupervisorOptions<
  TSpec,
  THandle extends IUnitHandle<TExit>,
  TExit,
  TContext extends ILaunchContext
> = ISupervisorBaseOptions<THandle> & {
  readonly launcher: IUnitLauncher<TSpec, THandle, TContext>
  readonly spec: TSpec
  readonly budget: IUnitBudget<string>
  readonly profile: IUnitProfile<TSpec, THandle, TExit, TContext>
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
