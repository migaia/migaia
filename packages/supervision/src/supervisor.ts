import {
  createAbortController,
  createGenerationController,
  createLifecycleScope,
  createMutationQueue,
  createTerminalController,
  type IAbortController,
  type IAbortSignal,
  type IGenerationRequest,
  type ILifecycleScope
} from '@migaia/lifecycle'
import { resolveScheduler, resolveSchedulerOption } from '@migaia/lifecycle/scheduler'
import { systemScheduler, type IScheduledTask } from '@migaia/utils/scheduler'
import { attachSecondaryErrors } from '@migaia/utils/error'
import { admitCapabilities } from './admission.js'
import {
  ExitReason,
  LaunchCause,
  ReplaceStrategy,
  RestartMode,
  SupervisorState,
  type BudgetRejection,
  type LaunchCause as ILaunchCause,
  type SupervisorState as ISupervisorState
} from './constants.js'
import { SupervisionErrorCode } from './error-code.js'
import { SupervisionErrorText } from './error-text.js'
import { createSupervisionError } from './errors.js'
import { startHealth } from './health.js'
import { validateSupervisorOptions } from './options.js'
import { forceAndReap, releaseWhenGone, teardownUnit, type IUnitSlot } from './unit-teardown.js'
import type {
  ILaunchContext,
  IReadyOutcome,
  IReplaceOutcome,
  ISupervisor,
  ISupervisorEvent,
  ISupervisorOptions,
  ISupervisorSnapshot,
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
  failureReason?: 'startup-timeout' | 'launch-failed' | 'unhealthy' | 'resource-violation'
  failureError?: unknown
  exitEmitted: boolean
  retired: boolean
}

/** Creates a runtime-neutral supervisor around one profile and its shared budget. */
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
    options.isolation ?? 'required',
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
    for (const listener of listeners) {
      try {
        listener(event)
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
    emit({ type: 'state', from, to: next, generation: attempts.generation })
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
  const trimFailures = (): void => {
    const now = scheduler.now()
    while (failures.length && now - failures[0]! >= windowMs) failures.shift()
  }
  /** Answers readiness without causing a command or starting a unit. */
  const readyNow = (): IReadyOutcome<THandle> | undefined => {
    if (terminal.lifecycle !== 'open' || state === SupervisorState.disposed)
      return { state: 'disposed' }
    if (state === SupervisorState.ready && active?.handle)
      return { state: 'ready', generation: active.generation, unit: active.handle }
    if (state === SupervisorState.idle) return { state: 'idle' }
    if (state === SupervisorState.stopped) return { state: 'stopped' }
    if (state === SupervisorState.terminal) return { state: 'terminal' }
    return undefined
  }
  /** Preserves an error as the primary while attaching teardown failures. */
  const withSecondary = (
    error: unknown,
    slot: IManagedSlot<TSpec, THandle, TExit, TContext>
  ): unknown => attachSecondaryErrors(error, slot.secondaryErrors)
  /** Publishes exactly one exit observation for a unit generation. */
  const publishExit = (
    slot: IManagedSlot<TSpec, THandle, TExit, TContext>,
    reason: (typeof ExitReason)[keyof typeof ExitReason],
    error?: unknown
  ): void => {
    if (slot.exitEmitted) return
    slot.exitEmitted = true
    lastExit = { generation: slot.generation, reason, ...(error === undefined ? {} : { error }) }
    emit({
      type: 'exit',
      generation: slot.generation,
      reason,
      ...(error === undefined ? {} : { error })
    })
  }
  /** Terminates after the allowed failure window and optionally arms one cooldown. */
  const enterTerminal = (lastError: unknown, lastRejection?: BudgetRejection): void => {
    if (terminal.lifecycle !== 'open') return
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
    emit({ type: 'terminal', error, entry: terminalEntries })
    options.report(error)
    if (terminal.lifecycle === 'open' && options.terminalPolicy?.mode === 'cooldown') {
      cooldownTimer = scheduler.schedule(() => {
        cooldownTimer = undefined
        if (terminal.lifecycle !== 'open' || state !== SupervisorState.terminal) return
        failures.length = 0
        pendingStart = commands.enqueue(() =>
          launchAttempt(LaunchCause.cooldown, spec, true).then((result) => result.outcome)
        )
      }, options.terminalPolicy.afterMs)
      cooldownTimer.unref?.()
    }
  }
  /** Schedules another attempt using a bounded exponential delay. */
  const scheduleBackoff = (delayMs: number): void => {
    if (terminal.lifecycle !== 'open') return
    transition(SupervisorState.backoff)
    backoffTimer = scheduler.schedule(() => {
      backoffTimer = undefined
      if (terminal.lifecycle !== 'open' || state !== SupervisorState.backoff) return
      pendingStart = commands.enqueue(() =>
        launchAttempt(LaunchCause.backoff, spec, true).then((result) => result.outcome)
      )
    }, delayMs)
  }
  /** Applies the restart policy to a failed active or attempted unit. */
  const onFailure = (error: unknown, lastRejection?: BudgetRejection): void => {
    if (terminal.lifecycle !== 'open') return
    trimFailures()
    failures.push(scheduler.now())
    if (restartMode === RestartMode.never || failures.length > maxRestarts) {
      enterTerminal(error, lastRejection)
      return
    }
    scheduleBackoff(Math.min(maxDelayMs, initialDelayMs * factor ** (failures.length - 1)))
  }
  /** Stops or force-retires one unit through its lifecycle scope. */
  const retire = (
    slot: IManagedSlot<TSpec, THandle, TExit, TContext>,
    mode: 'stop' | 'force',
    reason?: IManagedSlot<TSpec, THandle, TExit, TContext>['failureReason'],
    error?: unknown
  ): Promise<void> => {
    if (slot.retired) return slot.scope.dispose().then(() => undefined)
    slot.retired = true
    slot.mode = mode
    slot.failureReason = reason
    slot.failureError = error
    slot.unitController.abort(error)
    return slot.scope.dispose().then(() => undefined)
  }
  /** Converts a fulfilled exit into its profile classification and releases the slot. */
  const onExit = (slot: IManagedSlot<TSpec, THandle, TExit, TContext>, status: TExit): void => {
    slot.markGone()
    if (slot.abandoned) return
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
      void retire(slot, 'force', 'launch-failed', error)
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
    void retire(slot, 'force')
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
    const slot = {
      generation: request.generation,
      kind: options.profile.kind,
      profile: options.profile,
      scheduler,
      report: options.report,
      drainTimeoutMs: options.stop?.drainTimeoutMs ?? 5_000,
      exitTimeoutMs: options.stop?.exitTimeoutMs ?? 5_000,
      reapTimeoutMs,
      beforeTerminate: options.stop?.beforeTerminate,
      onAbandon: (error: Error) => {
        abandoned++
        publishExit(slot, ExitReason.abandoned, error)
      },
      launch: undefined,
      handle: undefined,
      mode: 'force',
      forceIssued: false,
      drained: options.stop?.beforeTerminate === undefined,
      abandoned: false,
      gone,
      markGone,
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
    const taken = options.hooks?.acquireUnit?.({ cause, spec: nextSpec })
    const budget = taken
      ? { kind: 'granted' as const, lease: taken.lease }
      : await options.budget.acquire(request.signal)
    if (budget.kind === 'rejected') {
      if (promote && attempts.isCurrent(request.token)) {
        if (cause === LaunchCause.backoff || cause === LaunchCause.cooldown)
          onFailure(undefined, budget.reason)
        else transition(SupervisorState.stopped)
      }
      return { outcome: { state: 'stopped', rejection: budget.reason }, rejection: budget.reason }
    }
    const slot = createSlot(request, budget.lease)
    if (!promote) candidate = slot
    else transition(SupervisorState.starting)
    let rejectWait: (reason: unknown) => void = () => undefined
    const cancelled = new Promise<never>((_, reject) => {
      rejectWait = reject
    })
    const aborted = (): void => {
      rejectWait(request.signal.reason)
    }
    request.signal.addEventListener('abort', aborted, { once: true })
    if (request.signal.aborted) aborted()
    const timeoutError = createSupervisionError(
      Error,
      SupervisionErrorCode.startupTimeout,
      SupervisionErrorText.startupTimeout,
      { detail: { kind: options.profile.kind } }
    )
    const timer = scheduler.schedule(() => {
      slot.failureReason = 'startup-timeout'
      slot.failureError = timeoutError
      attempts.supersede(timeoutError)
    }, startupTimeoutMs)
    slot.monitors.own(timer, { force: () => timer.cancel() })
    let phase: 'launch' | 'attach' | 'ready' = 'launch'
    try {
      const base = { signal: request.signal }
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
      phase = 'attach'
      if (options.hooks?.afterLaunch)
        await Promise.race([
          Promise.resolve(options.hooks.afterLaunch(handle, slot.runtime)),
          cancelled
        ])
      phase = 'ready'
      if (options.ready)
        await Promise.race([
          Promise.resolve(options.ready(handle, request.signal)),
          cancelled,
          handle.exited.then(() => {
            throw createSupervisionError(
              Error,
              SupervisionErrorCode.exitUnexpected,
              SupervisionErrorText.exitUnexpected,
              { detail: { kind: options.profile.kind } }
            )
          })
        ])
      await Promise.resolve()
      if (slot.exitEmitted)
        throw createSupervisionError(
          Error,
          SupervisionErrorCode.exitUnexpected,
          SupervisionErrorText.exitUnexpected,
          { detail: { kind: options.profile.kind } }
        )
      if (!attempts.isCurrent(request.token)) throw request.signal.reason
      timer.cancel()
      if (promote) {
        active = slot
        transition(SupervisorState.ready)
      }
      if (options.health)
        startHealth(
          slot.monitors,
          handle,
          options.profile.kind,
          options.health,
          scheduler,
          (error) => {
            if (replacementInProgress && active === slot && !slot.retired) {
              active = undefined
              trimFailures()
              failures.push(scheduler.now())
              replacementOldFailure = error
              void retire(slot, 'force', 'unhealthy', error)
              return
            }
            void commands.enqueue(async () => {
              if (active !== slot || slot.retired) return
              await retire(slot, 'force', 'unhealthy', error)
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
          reason === 'unhealthy'
            ? SupervisionErrorCode.unhealthy
            : SupervisionErrorCode.resourceLimitExceeded,
          reason === 'unhealthy'
            ? SupervisionErrorText.unhealthy
            : SupervisionErrorText.resourceLimitExceeded,
          { cause, detail: { kind: options.profile.kind, ...detail } }
        )
        if (replacementInProgress && active === slot && !slot.retired) {
          active = undefined
          trimFailures()
          failures.push(scheduler.now())
          replacementOldFailure = error
          void retire(slot, 'force', reason, error)
          return
        }
        void commands.enqueue(async () => {
          if (slot.retired) return
          await retire(slot, 'force', reason, error)
          if (active === slot) active = undefined
          publishExit(slot, reason, error)
          onFailure(error)
        })
      })
      return { outcome: { state: 'ready', generation: slot.generation, unit: handle }, slot }
    } catch (caught) {
      const timeout = slot.failureReason === 'startup-timeout'
      const superseded = request.signal.aborted && !timeout
      const error = timeout
        ? timeoutError
        : superseded
          ? caught
          : createSupervisionError(
              Error,
              SupervisionErrorCode.launchFailed,
              SupervisionErrorText.launchFailed,
              { cause: caught, detail: { kind: options.profile.kind, phase } }
            )
      await retire(slot, 'force', timeout ? 'startup-timeout' : 'launch-failed', error)
      request.signal.removeEventListener('abort', aborted)
      if (!slot.exitEmitted && !slot.abandoned)
        publishExit(
          slot,
          timeout ? ExitReason.startupTimeout : ExitReason.launchFailed,
          withSecondary(error, slot)
        )
      if (candidate === slot) candidate = undefined
      if (promote && attempts.isCurrent(request.token)) {
        if (superseded) transition(SupervisorState.stopped)
        else onFailure(error)
      }
      return {
        outcome: superseded ? { state: 'stopped' } : { state: 'terminal' },
        error: withSecondary(error, slot)
      }
    } finally {
      timer.cancel()
      request.signal.removeEventListener('abort', aborted)
    }
  }
  /** Rejects unit-producing commands while disposal is in progress or complete. */
  const commandError = (): Error | undefined => {
    if (terminal.lifecycle === 'open') return undefined
    const done = terminal.lifecycle === 'terminal'
    return createSupervisionError(
      Error,
      done ? SupervisionErrorCode.scopeTerminal : SupervisionErrorCode.scopeClosed,
      done ? SupervisionErrorText.scopeTerminal : SupervisionErrorText.scopeClosed
    )
  }
  /** Stops the current attempt and unit once, keeping the promise identity for joiners. */
  const stop = (): Promise<void> => {
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
          await retire(candidate, 'stop')
          candidate = undefined
        }
        if (active) {
          await retire(active, 'stop')
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
    return commands.enqueue(async () => {
      if (active) {
        await retire(active, 'stop')
        active = undefined
      }
      return (await launchAttempt(LaunchCause.restart, spec, true)).outcome
    })
  }
  /** Replaces by stopping first or by switching after a candidate reaches ready. */
  const replace = (
    replacement: {
      readonly strategy?: (typeof ReplaceStrategy)[keyof typeof ReplaceStrategy]
      readonly spec?: TSpec
    } = {}
  ): Promise<IReplaceOutcome> => {
    const error = commandError()
    if (error) return Promise.reject(error)
    return commands.enqueue(async (): Promise<IReplaceOutcome> => {
      if (state === SupervisorState.terminal) return { kind: 'rejected', reason: 'terminal' }
      if (!active) return { kind: 'rejected', reason: 'stopped' }
      const nextSpec = replacement.spec ?? spec
      let nextDegraded: readonly string[]
      try {
        options.profile.validateSpec(nextSpec)
        const nextAdmission = admitCapabilities(
          [...options.profile.requirements(nextSpec), ...(options.requires ?? [])],
          options.launcher.capabilities,
          options.isolation ?? 'required',
          options.profile.kind
        )
        nextDegraded = nextAdmission.degraded
      } catch (failure) {
        return { kind: 'failed', error: failure }
      }
      const previous = active
      const strategy = replacement.strategy ?? ReplaceStrategy.stopThenStart
      if (strategy === ReplaceStrategy.stopThenStart) {
        await retire(previous, 'stop')
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
            else
              scheduleBackoff(
                Math.min(maxDelayMs, initialDelayMs * factor ** (failures.length - 1))
              )
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
      degraded = nextDegraded
      if (strategy === ReplaceStrategy.startThenSwitch) {
        active = result.slot
        candidate = undefined
        emit({
          type: 'switched',
          from: previous.generation,
          to: result.slot.generation,
          unit: result.slot.handle!
        })
        transition(SupervisorState.ready)
        await retire(previous, 'stop')
      }
      return { kind: 'replaced', generation: result.slot.generation }
    })
  }
  /** Disposes the command axis and resolves after the same bounded stop sequence. */
  const dispose = (): Promise<void> => {
    if (pendingDispose) return pendingDispose
    if (terminal.lifecycle === 'terminal') return Promise.resolve()
    terminal.close()
    attempts.dispose()
    clearTimers()
    pendingDispose = commands.enqueue(async () => {
      clearTimers()
      transition(SupervisorState.stopping)
      if (candidate) {
        await retire(candidate, 'stop')
        candidate = undefined
      }
      if (active) {
        await retire(active, 'stop')
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
          state: 'ready',
          generation: active.generation,
          unit: active.handle
        })
      if (state === SupervisorState.terminal) return Promise.resolve({ state: 'terminal' })
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
      pendingStart = commands
        .enqueue(async () => (await launchAttempt(LaunchCause.start, spec, true)).outcome)
        .finally(() => {
          pendingStart = undefined
        })
      return pendingStart
    },
    whenReady,
    stop,
    restart: restartCommand,
    replace,
    inspect() {
      trimFailures()
      return {
        kind: options.profile.kind,
        state,
        generation: attempts.generation,
        ...(active?.handle
          ? { identity: active.handle.identity, unit: options.hooks?.inspectUnit?.(active.handle) }
          : {}),
        failuresInWindow: failures.length,
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
