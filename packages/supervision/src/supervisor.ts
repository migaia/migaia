import { trimTimestampWindow } from './timestamp-window.js'
import type { IAbortSignal } from '@migaia/utils/promise'
import {
  LifecycleState,
  createAbortController,
  createGenerationController,
  createLifecycleScope,
  createMutationQueue,
  createTerminalController,
  type IAbortController,
  type IGenerationRequest,
  type ILifecycleScope
} from '@migaia/lifecycle'
import { resolveScheduler, resolveSchedulerOption } from '@migaia/lifecycle/scheduler'
import { systemScheduler, type IScheduledTask } from '@migaia/utils/scheduler'
import { attachSecondaryErrors } from '@migaia/utils/error'
import { inspectThenable, observeThenableRejection } from '@migaia/utils/function'
import { admitCapabilities } from './admission.js'
import {
  ExitReason,
  EXIT_OBSERVATION_CAPABILITY,
  IsolationMode,
  TerminalPolicyMode,
  UnitStopMode,
  LaunchPhase,
  LaunchCause,
  ReplaceStrategy,
  RestartMode,
  SupervisorState,
  SupervisorEventType,
  type BudgetRejection,
  type LaunchCause as ILaunchCause,
  type SupervisorState as ISupervisorState
} from './constants.js'
import { SupervisionErrorCode } from './error-code.js'
import { SupervisionErrorText } from './error-text.js'
import { createSupervisionError } from './errors.js'
import { startHealth } from './health.js'
import { invalidOption, validateSupervisorOptions } from './options.js'
import { forceAndReap, releaseWhenGone, teardownUnit, type IUnitSlot } from './unit-teardown.js'
import type {
  ILaunchContext,
  IHealthSnapshot,
  IReadyOutcome,
  IReplaceOutcome,
  ISupervisor,
  ISupervisorEvent,
  ISupervisorOptions,
  ISupervisorSnapshot,
  ISupervisorStopOptions,
  IUnitExitStatus,
  IUnitHandle,
  IUnitRuntime
} from './types.js'

/** Supervisor-owned unit record, separate from the attempt generation token. */
type IManagedSlot<
  TSpec,
  THandle extends IUnitHandle<TExit>,
  TExit,
  TContext extends ILaunchContext
> = IUnitSlot<TSpec, THandle, TExit, TContext> & {
  readonly request: IGenerationRequest
  readonly scope: ILifecycleScope
  readonly attachments: ILifecycleScope
  readonly monitors: ILifecycleScope
  readonly unitController: IAbortController
  readonly runtime: IUnitRuntime
  /** Candidate execution ordinal is reused after failure and committed only on promotion. */
  readonly executionGeneration: number
  failureReason?:
    | typeof ExitReason.startupTimeout
    | typeof ExitReason.launchFailed
    | typeof ExitReason.unhealthy
    | typeof ExitReason.resourceViolation
  exitEmitted: boolean
  retired: boolean
  /** Actual native exit projection is captured before classification or teardown publication. */
  exitStatus?: IUnitExitStatus
  /** Original scheduler time of the actual exited fulfillment. */
  exitObservedAt?: number
  /** Reads the active unit's original health monitor without running a check. */
  readHealth?: () => IHealthSnapshot | undefined
}

/**
 * Creates a supervisor for one kind of unit, for adapters that bring their own profile and
 * launcher. Applications usually start from `createCoroutineSupervisor`, `createProcessSupervisor`
 * or `createThreadSupervisor`, which call this with a ready-made profile.
 *
 * The supervisor admits each start through the budget, launches through the launcher, waits for
 * `ready`, and then restarts with bounded exponential backoff or enters `terminal` when failures
 * exceed the restart window. Commands are serialized; unit failures are returned as outcomes or
 * sent to `report`, never thrown. Invalid options, and capabilities the launcher cannot guarantee
 * under required isolation, throw coded errors here before any unit starts.
 */
export function createSupervisor<
  TSpec,
  THandle extends IUnitHandle<TExit>,
  TExit,
  TContext extends ILaunchContext = ILaunchContext
>(options: ISupervisorOptions<TSpec, THandle, TExit, TContext>): ISupervisor<THandle, TSpec> {
  validateSupervisorOptions(options)
  options.profile.validateSpec(options.spec)
  const scheduler = resolveSchedulerOption(options) ?? resolveScheduler(systemScheduler)
  const admission = admitCapabilities(
    [...options.profile.requirements(options.spec), ...(options.requires ?? [])],
    options.launcher.capabilities,
    options.isolation ?? IsolationMode.required,
    options.profile.kind
  )
  const commands = createMutationQueue({ scheduler, admissionDiagnosticMs: false })
  const attempts = createGenerationController({ scheduler })
  const terminal = createTerminalController()
  const listeners = new Set<(event: ISupervisorEvent<THandle>) => void>()
  const waiters = new Set<() => void>()
  const failures: number[] = []
  let state: ISupervisorState = SupervisorState.idle
  let active: IManagedSlot<TSpec, THandle, TExit, TContext> | undefined
  let candidate: IManagedSlot<TSpec, THandle, TExit, TContext> | undefined
  let replacementInProgress = false
  let replacementOldFailure: unknown
  let replacementOldNormalExit = false
  let spec = options.spec
  let degraded = admission.degraded
  let degradationReported = false
  let lastExit: ISupervisorSnapshot['lastExit']
  let terminalError: unknown
  let terminalEntries = 0
  let abandoned = 0
  /** Lifetime restart successes are independent of attempt generation and failure-window trimming. */
  let restartCount = 0
  /** Successful execution commits start at zero; attempts and rejected replacements do not count. */
  let executionGeneration = -1
  let pendingStart: Promise<IReadyOutcome<THandle>> | undefined
  let pendingStop: Promise<void> | undefined
  let pendingDispose: Promise<void> | undefined
  let backoffTimer: IScheduledTask | undefined
  let cooldownTimer: IScheduledTask | undefined
  const restart = options.restart ?? {}
  const restartMode = restart.mode ?? RestartMode.onFailure
  const maxRestarts = restart.maxRestarts ?? 5
  const windowMs = restart.windowMs ?? 60_000
  const initialDelayMs = restart.initialDelayMs ?? 250
  const factor = restart.factor ?? 2
  const maxDelayMs = restart.maxDelayMs ?? 30_000
  const startupTimeoutMs = options.startupTimeoutMs ?? 10_000
  const reapTimeoutMs = options.stop?.reapTimeoutMs ?? 5_000

  /** Isolates listener failures and keeps every subscriber observable. */
  const emit = (event: ISupervisorEvent<THandle>): void => {
    /** Mutations during callbacks affect only later events, including nested publication. */
    const snapshot = Array.from(listeners)
    for (const listener of snapshot) {
      try {
        /** Observe only this callback's result; publishing remains synchronous and passive. */
        const result: unknown = listener(event)
        observeThenableRejection(result, inspectThenable(result), options.report)
      } catch (error) {
        options.report(error)
      }
    }
  }
  /** Notifies readiness observers whenever a stable answer may have changed. */
  const transition = (next: ISupervisorState): void => {
    if (state === next) return
    const from = state
    state = next
    emit({ type: SupervisorEventType.state, from, to: next, generation: attempts.generation })
    for (const wake of waiters) wake()
  }
  /** Clears only this supervisor's automatic retry timers. */
  const clearTimers = (): void => {
    backoffTimer?.cancel()
    backoffTimer = undefined
    cooldownTimer?.cancel()
    cooldownTimer = undefined
  }
  /** Removes expired failures before deciding the next delay or exhaustion. */
  const trimFailures = (): void => trimTimestampWindow(failures, scheduler.now(), windowMs)
  /** Both failure sites derive delay from the same already-trimmed failure window. */
  const restartDelay = (): number =>
    Math.min(maxDelayMs, initialDelayMs * factor ** (failures.length - 1))
  /** Answers readiness without causing a command or starting a unit. */
  const readyNow = (): IReadyOutcome<THandle> | undefined => {
    if (terminal.lifecycle !== LifecycleState.open || state === SupervisorState.disposed)
      return { state: SupervisorState.disposed }
    if (state === SupervisorState.ready && active?.handle)
      return { state: SupervisorState.ready, generation: active.generation, unit: active.handle }
    if (state === SupervisorState.idle) return { state: SupervisorState.idle }
    if (state === SupervisorState.stopped) return { state: SupervisorState.stopped }
    if (state === SupervisorState.terminal) return { state: SupervisorState.terminal }
    return undefined
  }
  /** Preserves an error as the primary while attaching teardown failures. */
  const withSecondary = (
    error: unknown,
    slot: IManagedSlot<TSpec, THandle, TExit, TContext>
  ): unknown => attachSecondaryErrors(error, slot.secondaryErrors)
  /** Publishes one diagnostic classification; only an actual exited fulfillment emits exit. */
  const publishExit = (
    slot: IManagedSlot<TSpec, THandle, TExit, TContext>,
    reason: (typeof ExitReason)[keyof typeof ExitReason],
    error?: unknown
  ): void => {
    if (slot.exitEmitted) return
    slot.exitEmitted = true
    /** Older units may settle after replacement; their facts cannot overwrite the newer record. */
    const observation = {
      generation: slot.generation,
      reason,
      ...(error === undefined ? {} : { error }),
      ...(slot.exitStatus ? { status: slot.exitStatus } : {}),
      ...(slot.exitObservedAt === undefined ? {} : { observedAt: slot.exitObservedAt })
    }
    if (!lastExit || lastExit.generation <= slot.generation) lastExit = observation
    if (slot.exitObservedAt !== undefined)
      emit({
        type: SupervisorEventType.exit,
        generation: slot.generation,
        reason,
        ...(error === undefined ? {} : { error }),
        ...(slot.exitStatus ? { status: slot.exitStatus } : {}),
        ...(slot.exitObservedAt === undefined ? {} : { observedAt: slot.exitObservedAt })
      })
  }
  /**
   * Turns a failed attempt's provisional `terminal` outcome into the supervisor's stable answer. A
   * backoff or a newer stop command can replace that provisional answer. Read the current stable
   * outcome, waiting if needed. Must run outside the command queue, because a retry or stop uses
   * that same queue.
   */
  const settleLaunchOutcome = (
    outcome: IReadyOutcome<THandle>
  ): IReadyOutcome<THandle> | Promise<IReadyOutcome<THandle>> =>
    outcome.state === SupervisorState.terminal && state !== SupervisorState.terminal
      ? whenReady()
      : outcome
  /**
   * Enqueues one promoting launch and publishes it as `pendingStart` until it settles. Every
   * promote site (start, backoff, cooldown) uses this, so a settled launch never lingers as a stale
   * ready outcome for later `start()` calls.
   */
  const enqueuePromoteLaunch = (cause: ILaunchCause): Promise<IReadyOutcome<THandle>> => {
    /** The launch published by this call; cleared only if no newer launch replaced it. */
    const launch: Promise<IReadyOutcome<THandle>> = commands
      .enqueue(async () => (await launchAttempt(cause, spec, true)).outcome)
      .then(settleLaunchOutcome)
      .finally(() => {
        if (pendingStart === launch) pendingStart = undefined
      })
    pendingStart = launch
    return launch
  }
  /** Terminates after the allowed failure window and optionally arms one cooldown. */
  const enterTerminal = (lastError: unknown, lastRejection?: BudgetRejection): void => {
    if (terminal.lifecycle !== LifecycleState.open) return
    clearTimers()
    const error = createSupervisionError(
      Error,
      SupervisionErrorCode.supervisionExhausted,
      SupervisionErrorText.supervisionExhausted,
      {
        cause: lastError,
        detail: {
          kind: options.profile.kind,
          failures: failures.length,
          maxRestarts,
          windowMs,
          ...(lastRejection === undefined ? {} : { lastRejection })
        }
      }
    )
    terminalError = error
    terminalEntries++
    transition(SupervisorState.terminal)
    emit({ type: SupervisorEventType.terminal, error, entry: terminalEntries })
    options.report(error)
    if (
      terminal.lifecycle === LifecycleState.open &&
      options.terminalPolicy?.mode === TerminalPolicyMode.cooldown
    ) {
      cooldownTimer = scheduler.schedule(() => {
        cooldownTimer = undefined
        if (terminal.lifecycle !== LifecycleState.open || state !== SupervisorState.terminal) return
        failures.length = 0
        void enqueuePromoteLaunch(LaunchCause.cooldown)
      }, options.terminalPolicy.afterMs)
      cooldownTimer.unref?.()
    }
  }
  /** Schedules another attempt using a bounded exponential delay. */
  const scheduleBackoff = (delayMs: number): void => {
    if (terminal.lifecycle !== LifecycleState.open) return
    transition(SupervisorState.backoff)
    backoffTimer = scheduler.schedule(() => {
      backoffTimer = undefined
      if (terminal.lifecycle !== LifecycleState.open || state !== SupervisorState.backoff) return
      void enqueuePromoteLaunch(LaunchCause.backoff)
    }, delayMs)
  }
  /** Applies the restart policy to a failed active or attempted unit. */
  const onFailure = (error: unknown, lastRejection?: BudgetRejection): void => {
    if (terminal.lifecycle !== LifecycleState.open) return
    trimFailures()
    failures.push(scheduler.now())
    if (restartMode === RestartMode.never || failures.length > maxRestarts) {
      enterTerminal(error, lastRejection)
      return
    }
    scheduleBackoff(restartDelay())
  }
  /** Stops or force-retires one unit through its lifecycle scope. */
  const retire = (
    slot: IManagedSlot<TSpec, THandle, TExit, TContext>,
    mode: UnitStopMode,
    reason?: IManagedSlot<TSpec, THandle, TExit, TContext>['failureReason'],
    error?: unknown
  ): Promise<void> => {
    if (mode === UnitStopMode.force) {
      slot.mode = mode
      slot.requestForce()
      if (slot.retired && slot.handle && !slot.disappeared)
        void forceAndReap(slot, slot.handle).catch(options.report)
    }
    if (slot.retired) return slot.scope.dispose().then(() => undefined)
    slot.retired = true
    slot.mode = mode
    slot.failureReason = reason
    slot.failureError = error
    slot.unitController.abort(error)
    return slot.scope.dispose().then(() => undefined)
  }
  /** Records an old serving unit's failure while its replacement still owns the restart decision. */
  const retireReplacingActive = (
    slot: IManagedSlot<TSpec, THandle, TExit, TContext>,
    reason: NonNullable<IManagedSlot<TSpec, THandle, TExit, TContext>['failureReason']>,
    error: Error
  ): boolean => {
    if (!replacementInProgress || active !== slot || slot.retired) return false
    active = undefined
    trimFailures()
    failures.push(scheduler.now())
    replacementOldFailure = error
    void retire(slot, UnitStopMode.force, reason, error)
    return true
  }
  /** Converts a fulfilled exit into its profile classification and releases the slot. */
  const onExit = (slot: IManagedSlot<TSpec, THandle, TExit, TContext>, status: TExit): void => {
    slot.markGone()
    slot.exitObservedAt = scheduler.now()
    try {
      slot.exitStatus = options.profile.exitStatus?.(status)
    } catch (error) {
      options.report(error)
    }
    if (slot.abandoned) {
      /** The deadline retained the lease; now the original native promise supplies real exit. */
      const error = lastExit?.generation === slot.generation ? lastExit.error : undefined
      if (lastExit?.generation === slot.generation)
        lastExit = {
          ...lastExit,
          ...(slot.exitStatus ? { status: slot.exitStatus } : {}),
          observedAt: slot.exitObservedAt
        }
      emit({
        type: SupervisorEventType.exit,
        generation: slot.generation,
        reason: ExitReason.abandoned,
        ...(error === undefined ? {} : { error }),
        ...(slot.exitStatus ? { status: slot.exitStatus } : {}),
        observedAt: slot.exitObservedAt
      })
      return
    }
    if (slot.retired) {
      const reason =
        slot.failureReason ??
        (slot.forceIssued && (slot.profile.gracefulTermination || !slot.drained)
          ? ExitReason.killed
          : ExitReason.stopped)
      publishExit(slot, reason, slot.failureError)
      return
    }
    if (candidate === slot || active !== slot) {
      const classification = options.profile.classifyExit(status)
      const error = createSupervisionError(
        Error,
        SupervisionErrorCode.exitUnexpected,
        SupervisionErrorText.exitUnexpected,
        {
          cause: classification.cause,
          detail: { kind: options.profile.kind, ...classification.detail }
        }
      )
      publishExit(slot, ExitReason.crashed, error)
      void retire(slot, UnitStopMode.force, ExitReason.launchFailed, error)
      return
    }
    const classification = options.profile.classifyExit(status)
    const reason = classification.reason
    const error =
      reason === ExitReason.exited
        ? undefined
        : createSupervisionError(
            Error,
            reason === ExitReason.resourceViolation
              ? SupervisionErrorCode.resourceLimitExceeded
              : SupervisionErrorCode.exitUnexpected,
            reason === ExitReason.resourceViolation
              ? SupervisionErrorText.resourceLimitExceeded
              : SupervisionErrorText.exitUnexpected,
            {
              cause: classification.cause,
              detail: { kind: options.profile.kind, ...classification.detail }
            }
          )
    publishExit(slot, reason, error)
    if (active !== slot) return
    active = undefined
    void retire(slot, UnitStopMode.force)
    if (replacementInProgress) {
      if (reason === ExitReason.exited) replacementOldNormalExit = true
      else {
        trimFailures()
        failures.push(scheduler.now())
        replacementOldFailure = error
      }
      return
    }
    if (reason === ExitReason.exited) {
      if (restartMode === RestartMode.always) scheduleBackoff(initialDelayMs)
      else transition(SupervisorState.stopped)
    } else onFailure(error)
  }
  /** Allocates one ordered lifecycle scope after budget admission. */
  const createSlot = (
    request: IGenerationRequest,
    lease: { release(): void }
  ): IManagedSlot<TSpec, THandle, TExit, TContext> => {
    const scope = createLifecycleScope({ errorPolicy: 'report', report: options.report, scheduler })
    const attachments = createLifecycleScope({
      errorPolicy: 'report',
      report: options.report,
      scheduler
    })
    const monitors = createLifecycleScope({
      errorPolicy: 'report',
      report: options.report,
      scheduler
    })
    const unitController = createAbortController()
    let markGone: () => void = () => undefined
    const gone = new Promise<void>((resolve) => {
      markGone = resolve
    })
    /** Kill wakes only this slot's original graceful phases; resolution is naturally idempotent. */
    let requestForce: () => void = () => undefined
    /** No second stop queue is introduced; teardown waits on this exact force signal. */
    const forceRequested = new Promise<void>((resolve) => {
      requestForce = resolve
    })
    const slot = {
      generation: request.generation,
      executionGeneration: executionGeneration + 1,
      kind: options.profile.kind,
      profile: options.profile,
      scheduler,
      report: options.report,
      drainTimeoutMs: options.stop?.drainTimeoutMs ?? 5_000,
      exitTimeoutMs: options.stop?.exitTimeoutMs ?? 5_000,
      reapTimeoutMs,
      exitObservation: options.launcher.capabilities[EXIT_OBSERVATION_CAPABILITY],
      beforeTerminate: options.stop?.beforeTerminate,
      onAbandon: (error: Error) => {
        abandoned++
        publishExit(slot, ExitReason.abandoned, error)
      },
      launch: undefined,
      handle: undefined,
      mode: UnitStopMode.force,
      forceIssued: false,
      drained: options.stop?.beforeTerminate === undefined,
      abandoned: false,
      gone,
      markGone: () => {
        slot.disappeared = true
        markGone()
      },
      disappeared: false,
      forceRequested,
      requestForce,
      forcing: undefined,
      teardown: undefined,
      secondaryErrors: [],
      request,
      scope,
      attachments,
      monitors,
      unitController,
      runtime: {
        generation: request.generation,
        scope: attachments,
        monitors,
        signal: unitController.signal
      },
      exitEmitted: false,
      retired: false
    } as IManagedSlot<TSpec, THandle, TExit, TContext>
    scope.own(lease, { force: () => releaseWhenGone(slot, () => lease.release()) })
    scope.own(attachments, {
      force: () => releaseWhenGone(slot, () => attachments.dispose().then(() => undefined))
    })
    scope.own(slot, { force: (context) => teardownUnit(slot, context) })
    scope.own(monitors, { force: () => monitors.dispose().then(() => undefined) })
    return slot
  }
  /** Launches and readies one attempt, optionally promoting it to the active unit. */
  const launchAttempt = async (
    cause: ILaunchCause,
    nextSpec: TSpec,
    promote: boolean
  ): Promise<{
    readonly outcome: IReadyOutcome<THandle>
    readonly slot?: IManagedSlot<TSpec, THandle, TExit, TContext>
    readonly error?: unknown
    readonly rejection?: BudgetRejection
  }> => {
    const request = attempts.begin()
    if (promote) transition(SupervisorState.queued)
    /** Adoption can fail before a lease or slot exists, but still belongs to launch failure policy. */
    let taken: ReturnType<NonNullable<NonNullable<typeof options.hooks>['acquireUnit']>>
    try {
      taken = options.hooks?.acquireUnit?.({ cause, spec: nextSpec })
    } catch (caught) {
      /** No unit was acquired, so there is no teardown or lease release to fabricate. */
      const error = createSupervisionError(
        Error,
        SupervisionErrorCode.launchFailed,
        SupervisionErrorText.launchFailed,
        { cause: caught, detail: { kind: options.profile.kind, phase: LaunchPhase.launch } }
      )
      if (promote && attempts.isCurrent(request.token)) onFailure(error)
      return { outcome: { state: SupervisorState.terminal }, error }
    }
    const budget = taken
      ? { kind: 'granted' as const, lease: taken.lease }
      : await options.budget.acquire(request.signal)
    if (budget.kind === 'rejected') {
      if (promote && attempts.isCurrent(request.token)) {
        if (cause === LaunchCause.backoff || cause === LaunchCause.cooldown)
          onFailure(undefined, budget.reason)
        else transition(SupervisorState.stopped)
      }
      return {
        outcome: { state: SupervisorState.stopped, rejection: budget.reason },
        rejection: budget.reason
      }
    }
    const slot = createSlot(request, budget.lease)
    candidate = slot
    if (promote) transition(SupervisorState.starting)
    let rejectWait: (reason: unknown) => void = () => undefined
    const cancelled = new Promise<never>((_, reject) => {
      rejectWait = reject
    })
    const aborted = (): void => {
      rejectWait(request.signal.reason)
    }
    request.signal.addEventListener('abort', aborted, { once: true })
    if (request.signal.aborted) aborted()
    const timer = scheduler.schedule(() => {
      /** Successful attempts never allocate the timeout error or capture its stack. */
      const timeoutError = createSupervisionError(
        Error,
        SupervisionErrorCode.startupTimeout,
        SupervisionErrorText.startupTimeout,
        { detail: { kind: options.profile.kind } }
      )
      slot.failureReason = ExitReason.startupTimeout
      slot.failureError = timeoutError
      attempts.supersede(timeoutError)
    }, startupTimeoutMs)
    slot.monitors.own(timer, { force: () => timer.cancel() })
    let phase: LaunchPhase = LaunchPhase.launch
    try {
      const base = { signal: request.signal, executionGeneration: slot.executionGeneration }
      const context = options.profile.launchContext?.(base, slot.runtime) ?? (base as TContext)
      slot.launch = taken
        ? Promise.resolve(taken.handle)
        : Promise.resolve().then(() => options.launcher.launch(nextSpec, context))
      void slot.launch.then(
        (handle) => {
          slot.handle = handle
          void handle.exited.then((status) => onExit(slot, status), options.report)
          if (slot.abandoned) void forceAndReap(slot, handle)
        },
        (error) => {
          slot.markGone()
          if (slot.abandoned) options.report(error)
        }
      )
      const handle = await Promise.race([slot.launch, cancelled])
      if (!attempts.isCurrent(request.token)) throw request.signal.reason
      phase = LaunchPhase.attach
      if (options.hooks?.afterLaunch)
        await Promise.race([
          Promise.resolve(options.hooks.afterLaunch(handle, slot.runtime)),
          cancelled
        ])
      phase = LaunchPhase.ready
      if (options.ready)
        await Promise.race([
          Promise.resolve(options.ready(handle, request.signal)),
          cancelled,
          handle.exited.then(() => {
            // onExit already classified this exact slot and retained its original task/native cause.
            throw (
              slot.failureError ??
              createSupervisionError(
                Error,
                SupervisionErrorCode.exitUnexpected,
                SupervisionErrorText.exitUnexpected,
                { detail: { kind: options.profile.kind } }
              )
            )
          })
        ])
      await Promise.resolve()
      if (slot.exitEmitted)
        // Preserve the candidate's classified failure instead of losing its original cause at ready.
        throw (
          slot.failureError ??
          createSupervisionError(
            Error,
            SupervisionErrorCode.exitUnexpected,
            SupervisionErrorText.exitUnexpected,
            { detail: { kind: options.profile.kind } }
          )
        )
      if (!attempts.isCurrent(request.token)) throw request.signal.reason
      timer.cancel()
      if (promote) {
        executionGeneration = slot.executionGeneration
        active = slot
        candidate = undefined
        if (
          cause === LaunchCause.restart ||
          cause === LaunchCause.backoff ||
          cause === LaunchCause.cooldown
        )
          restartCount += 1
        transition(SupervisorState.ready)
        if (
          cause === LaunchCause.restart ||
          cause === LaunchCause.backoff ||
          cause === LaunchCause.cooldown
        ) {
          emit({
            type: SupervisorEventType.restart,
            generation: slot.generation,
            count: restartCount,
            observedAt: scheduler.now()
          })
        }
      }
      if (options.health)
        slot.readHealth = startHealth(
          slot.monitors,
          handle,
          options.profile.kind,
          options.health,
          scheduler,
          (error) => {
            if (retireReplacingActive(slot, ExitReason.unhealthy, error)) return
            void commands.enqueue(async () => {
              if (active !== slot || slot.retired) return
              await retire(slot, UnitStopMode.force, ExitReason.unhealthy, error)
              active = undefined
              publishExit(slot, ExitReason.unhealthy, error)
              onFailure(error)
            })
          },
          options.report
        )
      options.hooks?.onReady?.(handle, slot.runtime, (reason, detail, cause) => {
        const error = createSupervisionError(
          Error,
          reason === ExitReason.unhealthy
            ? SupervisionErrorCode.unhealthy
            : SupervisionErrorCode.resourceLimitExceeded,
          reason === ExitReason.unhealthy
            ? SupervisionErrorText.unhealthy
            : SupervisionErrorText.resourceLimitExceeded,
          { cause, detail: { kind: options.profile.kind, ...detail } }
        )
        if (retireReplacingActive(slot, reason, error)) return
        void commands.enqueue(async () => {
          if (slot.retired) return
          await retire(slot, UnitStopMode.force, reason, error)
          if (active === slot) active = undefined
          publishExit(slot, reason, error)
          onFailure(error)
        })
      })
      // Startup authority ends at readiness; the serving unit now belongs to its runtime lifetime.
      attempts.complete(request.token)
      return {
        outcome: { state: SupervisorState.ready, generation: slot.generation, unit: handle },
        slot
      }
    } catch (caught) {
      const timeout = slot.failureReason === ExitReason.startupTimeout
      const superseded = request.signal.aborted && !timeout
      const error = timeout
        ? slot.failureError
        : superseded
          ? caught
          : createSupervisionError(
              Error,
              SupervisionErrorCode.launchFailed,
              SupervisionErrorText.launchFailed,
              { cause: caught, detail: { kind: options.profile.kind, phase } }
            )
      await retire(
        slot,
        UnitStopMode.force,
        timeout ? ExitReason.startupTimeout : ExitReason.launchFailed,
        error
      )
      request.signal.removeEventListener('abort', aborted)
      if (!slot.exitEmitted && !slot.abandoned)
        publishExit(
          slot,
          timeout ? ExitReason.startupTimeout : ExitReason.launchFailed,
          withSecondary(error, slot)
        )
      if (candidate === slot) candidate = undefined
      /** Timeout itself advances the generation once; a later command must still supersede it. */
      const ownsFailure =
        attempts.isCurrent(request.token) ||
        (timeout && attempts.generation === request.generation + 1)
      if (promote && ownsFailure) {
        if (superseded) transition(SupervisorState.stopped)
        else onFailure(error)
      }
      return {
        outcome: superseded
          ? { state: SupervisorState.stopped }
          : { state: SupervisorState.terminal },
        error: withSecondary(error, slot)
      }
    } finally {
      timer.cancel()
      request.signal.removeEventListener('abort', aborted)
    }
  }
  /** Rejects unit-producing commands while disposal is in progress or complete. */
  const commandError = (): Error | undefined => {
    if (terminal.lifecycle === LifecycleState.open) return undefined
    const done = terminal.lifecycle === LifecycleState.terminal
    return createSupervisionError(
      Error,
      done ? SupervisionErrorCode.scopeTerminal : SupervisionErrorCode.scopeClosed,
      done ? SupervisionErrorText.scopeTerminal : SupervisionErrorText.scopeClosed
    )
  }
  /** Stops the current attempt and unit once, keeping the promise identity for joiners. */
  const stop = (
    stopOptions?: ISupervisorStopOptions,
    mode: UnitStopMode = UnitStopMode.stop
  ): Promise<void> => {
    /** Configuration is rejected before superseding an attempt or touching a native handle. */
    const graceMs = stopOptions?.graceMs
    if (
      graceMs !== undefined &&
      (typeof graceMs !== 'number' || !Number.isFinite(graceMs) || graceMs < 0)
    )
      invalidOption('stop.graceMs', RangeError)
    if (mode === UnitStopMode.force) {
      attempts.supersede()
      for (const slot of [candidate, active])
        if (slot) void retire(slot, UnitStopMode.force).catch(options.report)
    }
    if (pendingDispose) return pendingDispose
    if (pendingStop) return pendingStop
    attempts.supersede()
    clearTimers()
    pendingStop = commands
      .enqueue(async () => {
        if (state === SupervisorState.disposed) return
        clearTimers()
        transition(SupervisorState.stopping)
        if (candidate) {
          if (graceMs !== undefined && !candidate.retired) candidate.drainTimeoutMs = graceMs
          await retire(candidate, mode)
          candidate = undefined
        }
        if (active) {
          if (graceMs !== undefined && !active.retired) active.drainTimeoutMs = graceMs
          await retire(active, mode)
          active = undefined
        }
        transition(SupervisorState.stopped)
      })
      .finally(() => {
        pendingStop = undefined
      })
    return pendingStop
  }
  /** Resets policy state and starts one fresh attempt after retiring the old unit. */
  const restartCommand = (): Promise<IReadyOutcome<THandle>> => {
    const error = commandError()
    if (error) return Promise.reject(error)
    attempts.supersede()
    clearTimers()
    failures.length = 0
    return commands
      .enqueue(async () => {
        if (active) {
          await retire(active, UnitStopMode.stop)
          active = undefined
        }
        return (await launchAttempt(LaunchCause.restart, spec, true)).outcome
      })
      .then(settleLaunchOutcome)
  }
  /** Replaces by stopping first or by switching after a candidate reaches ready. */
  const replace = (
    replacement: {
      readonly strategy?: (typeof ReplaceStrategy)[keyof typeof ReplaceStrategy]
      readonly spec?: TSpec
    } = {}
  ): Promise<IReplaceOutcome> => {
    /** Invalid strategy cannot enqueue a replacement or retire the serving unit. */
    const requestedStrategy = replacement.strategy
    if (
      requestedStrategy !== undefined &&
      !Object.values(ReplaceStrategy).includes(requestedStrategy)
    )
      invalidOption('replace.strategy')
    /** Capture the admitted strategy once before entering the asynchronous command queue. */
    const strategy = requestedStrategy ?? ReplaceStrategy.stopThenStart
    const error = commandError()
    if (error) return Promise.reject(error)
    return commands.enqueue(async (): Promise<IReplaceOutcome> => {
      if (state === SupervisorState.terminal)
        return { kind: 'rejected', reason: SupervisorState.terminal }
      if (!active) return { kind: 'rejected', reason: SupervisorState.stopped }
      const nextSpec = replacement.spec ?? spec
      let nextDegraded: readonly string[]
      try {
        options.profile.validateSpec(nextSpec)
        const nextAdmission = admitCapabilities(
          [...options.profile.requirements(nextSpec), ...(options.requires ?? [])],
          options.launcher.capabilities,
          options.isolation ?? IsolationMode.required,
          options.profile.kind
        )
        nextDegraded = nextAdmission.degraded
      } catch (failure) {
        return { kind: 'failed', error: failure }
      }
      const previous = active
      if (strategy === ReplaceStrategy.stopThenStart) {
        await retire(previous, UnitStopMode.stop)
        active = undefined
      }
      replacementInProgress = true
      replacementOldFailure = undefined
      replacementOldNormalExit = false
      let result: Awaited<ReturnType<typeof launchAttempt>>
      try {
        result = await launchAttempt(
          LaunchCause.replace,
          nextSpec,
          strategy === ReplaceStrategy.stopThenStart
        )
      } finally {
        replacementInProgress = false
      }
      if (result.rejection || result.error || !result.slot) {
        if (active === undefined && strategy === ReplaceStrategy.startThenSwitch) {
          if (replacementOldFailure !== undefined) {
            if (restartMode === RestartMode.never || failures.length > maxRestarts)
              enterTerminal(replacementOldFailure)
            else scheduleBackoff(restartDelay())
          } else if (replacementOldNormalExit) {
            if (restartMode === RestartMode.always) scheduleBackoff(initialDelayMs)
            else transition(SupervisorState.stopped)
          }
        }
        return result.rejection
          ? { kind: 'rejected', reason: result.rejection }
          : { kind: 'failed', error: result.error }
      }
      spec = nextSpec
      if (
        degraded.length !== nextDegraded.length ||
        degraded.some((value, index) => value !== nextDegraded[index])
      ) {
        degraded = nextDegraded
        emit({
          type: SupervisorEventType.degraded,
          generation: result.slot.generation,
          degraded,
          observedAt: scheduler.now()
        })
      }
      if (strategy === ReplaceStrategy.startThenSwitch) {
        executionGeneration = result.slot.executionGeneration
        active = result.slot
        candidate = undefined
        emit({
          type: SupervisorEventType.switched,
          from: previous.generation,
          to: result.slot.generation,
          unit: result.slot.handle!
        })
        transition(SupervisorState.ready)
        await retire(previous, UnitStopMode.stop)
      }
      return { kind: 'replaced', generation: result.slot.generation }
    })
  }
  /** Disposes the command axis and resolves after the same bounded stop sequence. */
  const dispose = (): Promise<void> => {
    if (pendingDispose) return pendingDispose
    if (terminal.lifecycle === LifecycleState.terminal) return Promise.resolve()
    terminal.close()
    attempts.dispose()
    clearTimers()
    pendingDispose = commands.enqueue(async () => {
      clearTimers()
      transition(SupervisorState.stopping)
      if (candidate) {
        await retire(candidate, UnitStopMode.stop)
        candidate = undefined
      }
      if (active) {
        await retire(active, UnitStopMode.stop)
        active = undefined
      }
      transition(SupervisorState.disposed)
      terminal.forceTerminal()
    })
    return pendingDispose
  }
  /** Waits for a stable readiness answer without entering the command queue. */
  const whenReady = (signal?: IAbortSignal): Promise<IReadyOutcome<THandle>> => {
    const immediate = readyNow()
    if (immediate) return Promise.resolve(immediate)
    if (signal?.aborted) return Promise.reject(signal.reason)
    return new Promise<IReadyOutcome<THandle>>((resolve, reject) => {
      const wake = (): void => {
        const answer = readyNow()
        if (!answer) return
        waiters.delete(wake)
        signal?.removeEventListener('abort', abort)
        resolve(answer)
      }
      const abort = (): void => {
        waiters.delete(wake)
        signal?.removeEventListener('abort', abort)
        reject(signal?.reason)
      }
      waiters.add(wake)
      signal?.addEventListener('abort', abort, { once: true })
      wake()
    })
  }
  return {
    get state() {
      return state
    },
    get generation() {
      return attempts.generation
    },
    start() {
      const error = commandError()
      if (error) return Promise.reject(error)
      if (state === SupervisorState.ready && active?.handle)
        return Promise.resolve({
          state: SupervisorState.ready,
          generation: active.generation,
          unit: active.handle
        })
      if (state === SupervisorState.terminal)
        return Promise.resolve({ state: SupervisorState.terminal })
      if (pendingStart) return pendingStart
      if (
        state === SupervisorState.backoff ||
        state === SupervisorState.queued ||
        state === SupervisorState.starting
      )
        return whenReady()
      if (!degradationReported) {
        degradationReported = true
        for (const diagnostic of admission.diagnostics) options.report(diagnostic)
      }
      return enqueuePromoteLaunch(LaunchCause.start)
    },
    whenReady,
    stop,
    kill: () => stop(undefined, UnitStopMode.force),
    restart: restartCommand,
    replace,
    inspect() {
      trimFailures()
      /** Capture one consistent cold health read from the current monitor. */
      const health = active?.readHealth?.()
      return {
        kind: options.profile.kind,
        state,
        generation: attempts.generation,
        ...(active?.handle
          ? { identity: active.handle.identity, unit: options.hooks?.inspectUnit?.(active.handle) }
          : {}),
        failuresInWindow: failures.length,
        restartCount,
        ...(health ? { health } : {}),
        ...(lastExit ? { lastExit } : {}),
        ...(terminalError === undefined ? {} : { terminalError }),
        terminalEntries,
        degraded,
        abandoned
      }
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    dispose
  }
}
