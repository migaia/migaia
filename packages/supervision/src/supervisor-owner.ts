/**
 * Owns supervisor commands and public-object shape; policy, attempts and slots have their own
 * modules.
 */
import { SupervisionField } from './text.ts'
import {
  LifecycleState,
  createGenerationController,
  createMutationQueue,
  createTerminalController
} from '@migaia/lifecycle'
import type { IScheduler } from '@migaia/utils/scheduler'
import type { IAbortSignal } from '@migaia/utils/promise'
import {
  LaunchCause,
  ReplaceStrategy,
  RestartMode,
  SupervisorState,
  UnitStopMode
} from './constants.ts'
import { SupervisionErrorCode } from './error-code.ts'
import { SupervisionErrorText } from './error-text.ts'
import { createSupervisionError } from './errors.ts'
import { invalidOption } from './options.ts'
import { TimestampWindow } from './timestamp-window.ts'
import { LaunchAttempt } from './supervisor-attempt.ts'
import { transition, readyNow } from './supervisor-events.ts'
import { clearTimers, trimFailures } from './supervisor-policy.ts'
import { ReadinessWaiter } from './supervisor-readiness.ts'
import { replaceUnit } from './supervisor-replace.ts'
import { retire } from './supervisor-slot.ts'
import type { ISupervisorContext } from './supervisor-context.ts'
import type {
  ILaunchContext,
  IReadyOutcome,
  IReplaceOutcome,
  ISupervisor,
  ISupervisorEvent,
  ISupervisorOptions,
  ISupervisorSnapshot,
  ISupervisorStopOptions,
  IUnitHandle
} from './types.ts'

/** Owns command Promise identity and the explicit state consumed by internal responsibility modules. */
export class SupervisorOwner<
  TSpec,
  THandle extends IUnitHandle<TExit>,
  TExit,
  TContext extends ILaunchContext
> {
  /** Every mutable supervisor fact has this one owner; attempts and native units remain lazy. */
  #context: ISupervisorContext<TSpec, THandle, TExit, TContext>

  /** Detached public callback keeps the original function name and command receiver. */
  readonly restartCommand = (): Promise<IReadyOutcome<THandle>> => this.#restartCommand()

  /** Captures admitted options in their original order, without constructing per-unit resources. */
  constructor(
    options: ISupervisorOptions<TSpec, THandle, TExit, TContext>,
    scheduler: IScheduler,
    admission: { readonly degraded: readonly string[]; readonly diagnostics: readonly Error[] }
  ) {
    /**
     * Lifecycle primitives are created before reading retry options, matching original admission
     * order.
     */
    const commands = createMutationQueue({ scheduler, admissionDiagnosticMs: false })
    /** Attempt generation is independent of committed native execution ordinals. */
    const attempts = createGenerationController({ scheduler })
    /** Terminal state gates commands before queued disposal begins. */
    const terminal = createTerminalController()
    /** Subscriber membership exists before the caller's specification and retry getters are read. */
    const listeners = new Set<(event: ISupervisorEvent<THandle>) => void>()
    /** Stable readiness observers are removed on fulfillment or caller cancellation. */
    const waiters = new Set<() => void>()
    /** Cursor-backed history replaces the original timestamp array without eager entries. */
    const failures = new TimestampWindow()
    /** Read the original specification before retry settings, preserving construction-time capture. */
    const spec = options.spec
    /** Retry options are captured once, matching the original factory's construction semantics. */
    const restart = options.restart ?? {}
    this.#context = {
      options,
      scheduler,
      admission,
      commands,
      attempts,
      terminal,
      listeners,
      listenerSnapshot: undefined,
      waiters,
      failures,
      state: SupervisorState.idle,
      active: undefined,
      candidate: undefined,
      replacementInProgress: false,
      replacementOldFailure: undefined,
      replacementOldNormalExit: false,
      spec,
      degraded: admission.degraded,
      degradationReported: false,
      lastExit: undefined,
      terminalError: undefined,
      terminalEntries: 0,
      abandoned: 0,
      restartCount: 0,
      executionGeneration: -1,
      pendingStart: undefined,
      pendingStop: undefined,
      pendingDispose: undefined,
      backoffTimer: undefined,
      cooldownTimer: undefined,
      restartMode: restart.mode ?? RestartMode.onFailure,
      maxRestarts: restart.maxRestarts ?? 5,
      windowMs: restart.windowMs ?? 60_000,
      initialDelayMs: restart.initialDelayMs ?? 250,
      factor: restart.factor ?? 2,
      maxDelayMs: restart.maxDelayMs ?? 30_000,
      startupTimeoutMs: options.startupTimeoutMs ?? 10_000,
      reapTimeoutMs: options.stop?.reapTimeoutMs ?? 5_000,
      launch: (cause) => this.enqueuePromoteLaunch(cause)
    }
  }

  /**
   * Preserves the original unfrozen plain object and own property order. These short callbacks are
   * the required public shape boundary; command and policy behavior stays in the owning methods.
   */
  publicObject(): ISupervisor<THandle, TSpec> {
    /** Getters retain state even when descriptors are invoked with another receiver. */
    const context = this.#context
    return {
      get state() {
        return context.state
      },
      get generation() {
        return context.attempts.generation
      },
      start: () => this.start(),
      whenReady: (signal) => this.whenReady(signal),
      stop: (options) => this.stop(options),
      kill: () => this.stop(undefined, UnitStopMode.force),
      restart: this.restartCommand,
      replace: (replacement = {}) => this.replace(replacement),
      inspect: () => this.inspect(),
      subscribe: (listener) => this.subscribe(listener),
      dispose: () => this.dispose()
    }
  }

  /** Starts once or joins the original in-flight command without creating a new attempt. */
  start(): Promise<IReadyOutcome<THandle>> {
    /** The current command axis and serving slot answer before any work is submitted. */
    const context = this.#context
    /** Closed and terminal lifecycle failures remain Promise rejections. */
    const error = this.commandError()
    if (error) return Promise.reject(error)
    if (context.state === SupervisorState.ready && context.active?.handle)
      return Promise.resolve({
        state: SupervisorState.ready,
        generation: context.active.generation,
        unit: context.active.handle
      })
    if (context.state === SupervisorState.terminal)
      return Promise.resolve({ state: SupervisorState.terminal })
    if (context.pendingStart) return context.pendingStart
    if (
      context.state === SupervisorState.backoff ||
      context.state === SupervisorState.queued ||
      context.state === SupervisorState.starting
    )
      return this.whenReady()
    if (!context.degradationReported) {
      context.degradationReported = true
      for (const diagnostic of context.admission.diagnostics) context.options.report(diagnostic)
    }
    return this.enqueuePromoteLaunch(LaunchCause.start)
  }

  /** Observes stable readiness outside the command queue; cancellation affects only this waiter. */
  whenReady(signal?: IAbortSignal): Promise<IReadyOutcome<THandle>> {
    /** Immediate answers do not allocate an observer or insert another asynchronous boundary. */
    const immediate = readyNow(this.#context)
    if (immediate) return Promise.resolve(immediate)
    if (signal?.aborted) return Promise.reject(signal.reason)
    return new ReadinessWaiter(this.#context, signal).promise
  }

  /** Admits strategy before queueing or touching the serving unit, then serializes one transaction. */
  replace(
    replacement: { readonly strategy?: ReplaceStrategy; readonly spec?: TSpec } = {}
  ): Promise<IReplaceOutcome> {
    /** Invalid strategy must not enqueue work or retire the active handle. */
    const strategy = replacement.strategy
    // ReplaceStrategy contains exactly two compile-time keys; this admission bound cannot grow at runtime.
    if (strategy !== undefined && !Object.values(ReplaceStrategy).includes(strategy))
      invalidOption(SupervisionField.replaceStrategy)
    /** Capture the admitted strategy before caller mutation or asynchronous queue execution. */
    const admitted = strategy ?? ReplaceStrategy.stopThenStart
    /** The lifecycle rejection is preserved after strategy admission, in its original order. */
    const error = this.commandError()
    if (error) return Promise.reject(error)
    return this.#context.commands.enqueue(() => replaceUnit(this.#context, replacement, admitted))
  }

  /** Reads policy and health without scheduling checks or starting units. */
  inspect(): ISupervisorSnapshot {
    /** Snapshot fields come from one current owner state. */
    const context = this.#context
    trimFailures(context)
    /** Capture one consistent cold health read from the current original monitor. */
    const health = context.active?.readHealth?.()
    return {
      kind: context.options.profile.kind,
      state: context.state,
      generation: context.attempts.generation,
      ...(context.active?.handle
        ? {
            identity: context.active.handle.identity,
            unit: context.options.hooks?.inspectUnit?.(context.active.handle)
          }
        : {}),
      failuresInWindow: context.failures.length,
      restartCount: context.restartCount,
      ...(health ? { health } : {}),
      ...(context.lastExit ? { lastExit: context.lastExit } : {}),
      ...(context.terminalError === undefined ? {} : { terminalError: context.terminalError }),
      terminalEntries: context.terminalEntries,
      degraded: context.degraded,
      abandoned: context.abandoned
    }
  }

  /** Subscription membership is owned by the supervisor until the returned callback removes it. */
  subscribe(listener: (event: ISupervisorEvent<THandle>) => void): () => void {
    if (!this.#context.listeners.has(listener)) {
      this.#context.listeners.add(listener)
      this.#context.listenerSnapshot = undefined
    }
    return () => this.#removeListener(listener)
  }

  /** Current publication retains its immutable snapshot; subsequent events observe removal. */
  #removeListener(listener: (event: ISupervisorEvent<THandle>) => void): void {
    if (this.#context.listeners.delete(listener)) this.#context.listenerSnapshot = undefined
  }

  /** Rejects unit-producing commands with the original closing or terminal error identity. */
  commandError(): Error | undefined {
    /** The command reads one owned context throughout synchronous and queued work. */
    const context = this.#context
    if (context.terminal.lifecycle === LifecycleState.open) return undefined
    /** Completion distinguishes SCOPE_TERMINAL from a still-closing supervisor. */
    const done = context.terminal.lifecycle === LifecycleState.terminal
    return createSupervisionError(
      Error,
      done ? SupervisionErrorCode.scopeTerminal : SupervisionErrorCode.scopeClosed,
      done ? SupervisionErrorText.scopeTerminal : SupervisionErrorText.scopeClosed
    )
  }
  /** Resolves provisional launch failure against current stable state outside the command queue. */
  settleLaunchOutcome(
    outcome: IReadyOutcome<THandle>
  ): IReadyOutcome<THandle> | Promise<IReadyOutcome<THandle>> {
    /** The command reads one owned context throughout synchronous and queued work. */
    const context = this.#context
    return outcome.state === SupervisorState.terminal && context.state !== SupervisorState.terminal
      ? this.whenReady()
      : outcome
  }

  /** Shares a promoting start until settlement, clearing only that exact published launch Promise. */
  enqueuePromoteLaunch(cause: LaunchCause): Promise<IReadyOutcome<THandle>> {
    /** The command reads one owned context throughout synchronous and queued work. */
    const context = this.#context
    /** The launch published by this call; cleared only if no newer launch replaced it. */
    const launch: Promise<IReadyOutcome<THandle>> = context.commands
      .enqueue(
        async () => (await new LaunchAttempt(context, cause, context.spec, true).run()).outcome
      )
      .then((outcome) => this.settleLaunchOutcome(outcome))
      .finally(() => {
        if (context.pendingStart === launch) context.pendingStart = undefined
      })
    context.pendingStart = launch
    return launch
  }
  /** Stops once, shares the exact Promise and permits force to upgrade an existing teardown. */
  stop(
    stopOptions?: ISupervisorStopOptions,
    mode: UnitStopMode = UnitStopMode.stop
  ): Promise<void> {
    /** The command reads one owned context throughout synchronous and queued work. */
    const context = this.#context
    /** Configuration is rejected before superseding an attempt or touching a native handle. */
    const graceMs = stopOptions?.graceMs
    if (
      graceMs !== undefined &&
      (typeof graceMs !== 'number' || !Number.isFinite(graceMs) || graceMs < 0)
    )
      invalidOption(SupervisionField.stopGraceMs, RangeError)
    if (mode === UnitStopMode.force) {
      context.attempts.supersede()
      for (const slot of [context.candidate, context.active])
        if (slot) void retire(context, slot, UnitStopMode.force).catch(context.options.report)
    }
    if (context.pendingDispose) return context.pendingDispose
    if (context.pendingStop) return context.pendingStop
    context.attempts.supersede()
    clearTimers(context)
    context.pendingStop = context.commands
      .enqueue(async () => {
        if (context.state === SupervisorState.disposed) return
        clearTimers(context)
        transition(context, SupervisorState.stopping)
        if (context.candidate) {
          if (graceMs !== undefined && !context.candidate.retired)
            context.candidate.drainTimeoutMs = graceMs
          await retire(context, context.candidate, mode)
          context.candidate = undefined
        }
        if (context.active) {
          if (graceMs !== undefined && !context.active.retired)
            context.active.drainTimeoutMs = graceMs
          await retire(context, context.active, mode)
          context.active = undefined
        }
        transition(context, SupervisorState.stopped)
      })
      .finally(() => {
        context.pendingStop = undefined
      })
    return context.pendingStop
  }
  /** Clears policy history and retries only after the serving unit completes its original teardown. */
  #restartCommand(): Promise<IReadyOutcome<THandle>> {
    /** The command reads one owned context throughout synchronous and queued work. */
    const context = this.#context
    /** Rejected lifecycle admission cannot supersede the active attempt or cancel retry timers. */
    const error = this.commandError()
    if (error) return Promise.reject(error)
    context.attempts.supersede()
    clearTimers(context)
    context.failures.clear()
    return context.commands
      .enqueue(async () => {
        if (context.active) {
          await retire(context, context.active, UnitStopMode.stop)
          context.active = undefined
        }
        return (await new LaunchAttempt(context, LaunchCause.restart, context.spec, true).run())
          .outcome
      })
      .then((outcome) => this.settleLaunchOutcome(outcome))
  }
  /** Closes commands synchronously and joins one bounded, serialized retirement sequence. */
  dispose(): Promise<void> {
    /** The command reads one owned context throughout synchronous and queued work. */
    const context = this.#context
    if (context.pendingDispose) return context.pendingDispose
    if (context.terminal.lifecycle === LifecycleState.terminal) return Promise.resolve()
    context.terminal.close()
    context.attempts.dispose()
    clearTimers(context)
    context.pendingDispose = context.commands.enqueue(async () => {
      clearTimers(context)
      transition(context, SupervisorState.stopping)
      if (context.candidate) {
        await retire(context, context.candidate, UnitStopMode.stop)
        context.candidate = undefined
      }
      if (context.active) {
        await retire(context, context.active, UnitStopMode.stop)
        context.active = undefined
      }
      transition(context, SupervisorState.disposed)
      context.terminal.forceTerminal()
    })
    return context.pendingDispose
  }
}
