/**
 * Owns one launch attempt, its cancellation listener and timeout; serving-unit lifetime remains in
 * its slot.
 */
import { OutcomeKind, ABORT_EVENT } from './text.js'
import type { IGenerationRequest } from '@migaia/lifecycle'
import { attachSecondaryErrors } from '@migaia/utils/error'
import {
  ExitReason,
  LaunchCause,
  LaunchPhase,
  SupervisorEventType,
  SupervisorState,
  UnitStopMode,
  type BudgetRejection
} from './constants.js'
import { SupervisionErrorCode } from './error-code.js'
import { SupervisionErrorText } from './error-text.js'
import { createSupervisionError } from './errors.js'
import { startHealth } from './health.js'
import { emit, publishExit, transition } from './supervisor-events.js'
import { onExit, retireReplacingActive } from './supervisor-exit.js'
import { onFailure } from './supervisor-policy.js'
import { ManagedSlot, retire, type IManagedSlot } from './supervisor-slot.js'
import { forceAndReap } from './unit-teardown.js'
import type { ISupervisorContext } from './supervisor-context.js'
import type { ILaunchContext, IReadyOutcome, IUnitHandle } from './types.js'

/** The original provisional outcome and optional owned candidate are consumed by the command owner. */
export type IAttemptOutcome<
  TSpec,
  THandle extends IUnitHandle<TExit>,
  TExit,
  TContext extends ILaunchContext
> = {
  readonly outcome: IReadyOutcome<THandle>
  readonly slot?: IManagedSlot<TSpec, THandle, TExit, TContext>
  readonly error?: unknown
  readonly rejection?: BudgetRejection
}

/** An attempt is allocated on demand; its monitor and abort listener are removed by run's finally. */
export class LaunchAttempt<
  TSpec,
  THandle extends IUnitHandle<TExit>,
  TExit,
  TContext extends ILaunchContext
> {
  /** Supervisor policy and serving ownership are explicit rather than a captured factory frame. */
  #context: ISupervisorContext<TSpec, THandle, TExit, TContext>
  /** The lifecycle generation remains the sole authority for startup cancellation. */
  #request: IGenerationRequest
  /** This attempt retains its original cause and specification across asynchronous launch. */
  #cause: LaunchCause
  /** Only successful promotion commits this specification. */
  #spec: TSpec
  /** Stop-first and explicit starts promote; switch-first candidates wait for their transaction. */
  #promote: boolean
  /** Rejection settles the same cancellation Promise observed by launch, attach and readiness. */
  #rejectWait!: (reason: unknown) => void
  /** Listener identity is stable from registration to finally removal. */
  #aborted!: () => void

  /** Begins the original generation synchronously, before the acquire hook can reenter. */
  constructor(
    context: ISupervisorContext<TSpec, THandle, TExit, TContext>,
    cause: LaunchCause,
    spec: TSpec,
    promote: boolean
  ) {
    this.#context = context
    this.#cause = cause
    this.#spec = spec
    this.#promote = promote
    this.#request = context.attempts.begin()
    if (promote) transition(context, SupervisorState.queued)
  }

  /**
   * Executes the indivisible startup transaction with its original await points. Acquisition,
   * synchronous hooks, readiness, promotion and rollback must retain this order; callback behavior
   * and resource ownership are delegated to named jobs without adding Promise boundaries.
   */
  async run(): Promise<IAttemptOutcome<TSpec, THandle, TExit, TContext>> {
    /** One original supervisor context remains authoritative throughout this transaction. */
    const context = this.#context
    /** This token authorizes startup only, never the lifetime of a serving unit. */
    const request = this.#request
    /** Adoption can fail before a lease or slot exists. */
    let taken: ReturnType<NonNullable<NonNullable<typeof context.options.hooks>['acquireUnit']>>
    try {
      taken = context.options.hooks?.acquireUnit?.({ cause: this.#cause, spec: this.#spec })
    } catch (caught) {
      /** No unit was acquired, so there is no teardown or lease release to fabricate. */
      const error = createSupervisionError(
        Error,
        SupervisionErrorCode.launchFailed,
        SupervisionErrorText.launchFailed,
        { cause: caught, detail: { kind: context.options.profile.kind, phase: LaunchPhase.launch } }
      )
      if (this.#promote && context.attempts.isCurrent(request.token)) onFailure(context, error)
      return { outcome: { state: SupervisorState.terminal }, error }
    }
    /** Adopted handles already own a lease; ordinary launches enter the existing budget. */
    const budget = taken
      ? { kind: OutcomeKind.granted, lease: taken.lease }
      : await context.options.budget.acquire(request.signal)
    if (budget.kind === OutcomeKind.rejected) {
      if (this.#promote && context.attempts.isCurrent(request.token)) {
        if (this.#cause === LaunchCause.backoff || this.#cause === LaunchCause.cooldown)
          onFailure(context, undefined, budget.reason)
        else transition(context, SupervisorState.stopped)
      }
      return {
        outcome: { state: SupervisorState.stopped, rejection: budget.reason },
        rejection: budget.reason
      }
    }
    /** A slot exists only after budget admission and preserves the original release sequence. */
    const slot = new ManagedSlot(context, request, budget.lease)
    context.candidate = slot
    if (this.#promote) transition(context, SupervisorState.starting)
    /** Launch, attachment and readiness race this exact original cancellation Promise. */
    const cancelled = new Promise<never>((_, reject) => {
      this.#rejectWait = reject
    })
    this.#aborted = () => this.#rejectWait(this.#request.signal.reason)
    request.signal.addEventListener(ABORT_EVENT, this.#aborted, { once: true })
    if (request.signal.aborted) this.#aborted()
    /** Timeout errors and their stacks are allocated only if the original timer actually fires. */
    const timer = context.scheduler.schedule(() => this.#timeout(slot), context.startupTimeoutMs)
    slot.monitors.own(timer, { force: () => timer.cancel() })
    /** Failure wrapping identifies the original stage without changing native error identity. */
    let phase: LaunchPhase = LaunchPhase.launch
    try {
      /** The profile can enrich the existing runtime-neutral launch context synchronously. */
      const base = { signal: request.signal, executionGeneration: slot.executionGeneration }
      /** No extra Promise or microtask is added before the launcher's original invocation. */
      const launchContext =
        context.options.profile.launchContext?.(base, slot.runtime) ?? (base as TContext)
      slot.launch = taken
        ? Promise.resolve(taken.handle)
        : Promise.resolve().then(() => context.options.launcher.launch(this.#spec, launchContext))
      void slot.launch.then(
        (handle) => this.#launched(slot, handle),
        (error) => this.#launchRejected(slot, error)
      )
      /** Readiness observes the launch Promise already watched for actual native exit. */
      const handle = await Promise.race([slot.launch, cancelled])
      if (!context.attempts.isCurrent(request.token)) throw request.signal.reason
      phase = LaunchPhase.attach
      if (context.options.hooks?.afterLaunch)
        await Promise.race([
          Promise.resolve(context.options.hooks.afterLaunch(handle, slot.runtime)),
          cancelled
        ])
      phase = LaunchPhase.ready
      if (context.options.ready)
        await Promise.race([
          Promise.resolve(context.options.ready(handle, request.signal)),
          cancelled,
          handle.exited.then(() => this.#unexpectedExit(slot))
        ])
      await Promise.resolve()
      if (slot.exitEmitted) this.#unexpectedExit(slot)
      if (!context.attempts.isCurrent(request.token)) throw request.signal.reason
      timer.cancel()
      this.#ready(slot, handle)
      // Startup authority ends at readiness; serving lifetime belongs to the runtime slot.
      context.attempts.complete(request.token)
      return {
        outcome: { state: SupervisorState.ready, generation: slot.generation, unit: handle },
        slot
      }
    } catch (caught) {
      /** Timeout advances the token itself; an unrelated command still wins supersession. */
      const timeout = slot.failureReason === ExitReason.startupTimeout
      /** Caller cancellation preserves its exact original rejection value. */
      const superseded = request.signal.aborted && !timeout
      /** Cleanup augments this primary failure rather than replacing it. */
      const error = timeout
        ? slot.failureError
        : superseded
          ? caught
          : createSupervisionError(
              Error,
              SupervisionErrorCode.launchFailed,
              SupervisionErrorText.launchFailed,
              { cause: caught, detail: { kind: context.options.profile.kind, phase } }
            )
      await retire(
        context,
        slot,
        UnitStopMode.force,
        timeout ? ExitReason.startupTimeout : ExitReason.launchFailed,
        error
      )
      request.signal.removeEventListener(ABORT_EVENT, this.#aborted)
      if (!slot.exitEmitted && !slot.abandoned)
        publishExit(
          context,
          slot,
          timeout ? ExitReason.startupTimeout : ExitReason.launchFailed,
          attachSecondaryErrors(error, slot.secondaryErrors)
        )
      if (context.candidate === slot) context.candidate = undefined
      /** A timeout owns its one generation advance unless a later command superseded it. */
      const ownsFailure =
        context.attempts.isCurrent(request.token) ||
        (timeout && context.attempts.generation === request.generation + 1)
      if (this.#promote && ownsFailure) {
        if (superseded) transition(context, SupervisorState.stopped)
        else onFailure(context, error)
      }
      return {
        outcome: superseded
          ? { state: SupervisorState.stopped }
          : { state: SupervisorState.terminal },
        error: attachSecondaryErrors(error, slot.secondaryErrors)
      }
    } finally {
      timer.cancel()
      request.signal.removeEventListener(ABORT_EVENT, this.#aborted)
    }
  }

  /** Marks timeout before superseding startup so rollback preserves STARTUP_TIMEOUT. */
  #timeout(slot: IManagedSlot<TSpec, THandle, TExit, TContext>): void {
    /** Successful startup never allocates this error or captures its stack. */
    const error = createSupervisionError(
      Error,
      SupervisionErrorCode.startupTimeout,
      SupervisionErrorText.startupTimeout,
      { detail: { kind: this.#context.options.profile.kind } }
    )
    slot.failureReason = ExitReason.startupTimeout
    slot.failureError = error
    this.#context.attempts.supersede(error)
  }

  /** Exit observation is installed before startup waits for the launched handle. */
  #launched(slot: IManagedSlot<TSpec, THandle, TExit, TContext>, handle: THandle): void {
    /** Capture only the explicit long-lived owner context and slot, not the attempt. */
    const context = this.#context
    slot.handle = handle
    void handle.exited.then((status) => onExit(context, slot, status), context.options.report)
    if (slot.abandoned) void forceAndReap(slot, handle)
  }

  /** A rejected late launch is actual disappearance and reports its original rejection. */
  #launchRejected(slot: IManagedSlot<TSpec, THandle, TExit, TContext>, error: unknown): void {
    slot.markGone()
    if (slot.abandoned) this.#context.options.report(error)
  }

  /** Preserves the classification already recorded by the actual exited observer. */
  #unexpectedExit(slot: IManagedSlot<TSpec, THandle, TExit, TContext>): never {
    throw (
      slot.failureError ??
      createSupervisionError(
        Error,
        SupervisionErrorCode.exitUnexpected,
        SupervisionErrorText.exitUnexpected,
        { detail: { kind: this.#context.options.profile.kind } }
      )
    )
  }

  /** Promotes synchronously, then attaches original health and profile monitoring callbacks. */
  #ready(slot: IManagedSlot<TSpec, THandle, TExit, TContext>, handle: THandle): void {
    /** Monitor callbacks retain only their explicit supervisor and slot owners. */
    const context = this.#context
    if (this.#promote) {
      context.executionGeneration = slot.executionGeneration
      context.active = slot
      context.candidate = undefined
      /** Only these three original causes count successful restarts. */
      const restarted =
        this.#cause === LaunchCause.restart ||
        this.#cause === LaunchCause.backoff ||
        this.#cause === LaunchCause.cooldown
      if (restarted) context.restartCount += 1
      transition(context, SupervisorState.ready)
      if (restarted)
        emit(context, {
          type: SupervisorEventType.restart,
          generation: slot.generation,
          count: context.restartCount,
          observedAt: context.scheduler.now()
        })
    }
    if (context.options.health)
      slot.readHealth = startHealth(
        slot.monitors,
        handle,
        context.options.profile.kind,
        context.options.health,
        context.scheduler,
        (error) => healthFailed(context, slot, error),
        context.options.report
      )
    context.options.hooks?.onReady?.(handle, slot.runtime, (reason, detail, cause) =>
      unitFailed(context, slot, reason, detail, cause)
    )
  }
}

/** Health retains the original old-unit replacement path and queued retirement predicate. */
function healthFailed<
  TSpec,
  THandle extends IUnitHandle<TExit>,
  TExit,
  TContext extends ILaunchContext
>(
  context: ISupervisorContext<TSpec, THandle, TExit, TContext>,
  slot: IManagedSlot<TSpec, THandle, TExit, TContext>,
  error: Error
): void {
  if (retireReplacingActive(context, slot, ExitReason.unhealthy, error)) return
  void context.commands.enqueue(async () => {
    if (context.active !== slot || slot.retired) return
    await retire(context, slot, UnitStopMode.force, ExitReason.unhealthy, error)
    context.active = undefined
    publishExit(context, slot, ExitReason.unhealthy, error)
    onFailure(context, error)
  })
}

/** Profile failure constructs its original coded error before entering the mutation queue. */
function unitFailed<
  TSpec,
  THandle extends IUnitHandle<TExit>,
  TExit,
  TContext extends ILaunchContext
>(
  context: ISupervisorContext<TSpec, THandle, TExit, TContext>,
  slot: IManagedSlot<TSpec, THandle, TExit, TContext>,
  reason: typeof ExitReason.unhealthy | typeof ExitReason.resourceViolation,
  detail?: Readonly<Record<string, unknown>>,
  cause?: unknown
): void {
  /** The original cause and detail are attached without rebuilding the primary error. */
  const error = createSupervisionError(
    Error,
    reason === ExitReason.unhealthy
      ? SupervisionErrorCode.unhealthy
      : SupervisionErrorCode.resourceLimitExceeded,
    reason === ExitReason.unhealthy
      ? SupervisionErrorText.unhealthy
      : SupervisionErrorText.resourceLimitExceeded,
    { cause, detail: { kind: context.options.profile.kind, ...detail } }
  )
  if (retireReplacingActive(context, slot, reason, error)) return
  void context.commands.enqueue(async () => {
    if (slot.retired) return
    await retire(context, slot, UnitStopMode.force, reason, error)
    if (context.active === slot) context.active = undefined
    publishExit(context, slot, reason, error)
    onFailure(context, error)
  })
}
