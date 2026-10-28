/**
 * Owns the replacement transaction; only success commits specification, degradation and serving
 * ownership.
 */
import { OutcomeKind } from './text.ts'
import { admitCapabilities } from './admission.ts'
import {
  IsolationMode,
  ReplaceStrategy,
  RestartMode,
  SupervisorState,
  SupervisorEventType,
  LaunchCause,
  UnitStopMode
} from './constants.ts'
import { LaunchAttempt, type IAttemptOutcome } from './supervisor-attempt.ts'
import { emit, transition } from './supervisor-events.ts'
import { enterTerminal, restartDelay, scheduleBackoff } from './supervisor-policy.ts'
import { retire } from './supervisor-slot.ts'
import type { ISupervisorContext } from './supervisor-context.ts'
import type { ILaunchContext, IReplaceOutcome, IUnitHandle } from './types.ts'
/** Preserves ordered degradation comparison for growable custom-profile capability lists in O(n). */
function sameDegraded(previous: readonly string[], next: readonly string[]): boolean {
  if (previous.length !== next.length) return false
  for (let index = 0; index < previous.length; index++)
    if (previous[index] !== next[index]) return false
  return true
}
/** Runs one already-admitted replacement on the existing mutation queue. */
export async function replaceUnit<
  TSpec,
  THandle extends IUnitHandle<TExit>,
  TExit,
  TContext extends ILaunchContext
>(
  context: ISupervisorContext<TSpec, THandle, TExit, TContext>,
  replacement: { readonly strategy?: ReplaceStrategy; readonly spec?: TSpec },
  strategy: ReplaceStrategy
): Promise<IReplaceOutcome> {
  if (context.state === SupervisorState.terminal)
    return { kind: OutcomeKind.rejected, reason: SupervisorState.terminal }
  if (!context.active) return { kind: OutcomeKind.rejected, reason: SupervisorState.stopped }
  /** The proposed specification is validated before touching the old serving unit. */
  const nextSpec = replacement.spec ?? context.spec
  /** New degradation becomes observable only after successful candidate readiness. */
  let nextDegraded: readonly string[]
  try {
    context.options.profile.validateSpec(nextSpec)
    /** Reuses the same package-owned capability admission as construction. */
    const nextAdmission = admitCapabilities(
      [...context.options.profile.requirements(nextSpec), ...(context.options.requires ?? [])],
      context.options.launcher.capabilities,
      context.options.isolation ?? IsolationMode.required,
      context.options.profile.kind
    )
    nextDegraded = nextAdmission.degraded
  } catch (failure) {
    return { kind: OutcomeKind.failed, error: failure }
  }
  /** The original slot remains authoritative until switch-first promotion commits. */
  const previous = context.active
  if (strategy === ReplaceStrategy.stopThenStart) {
    await retire(context, previous, UnitStopMode.stop)
    context.active = undefined
  }
  context.replacementInProgress = true
  context.replacementOldFailure = undefined
  context.replacementOldNormalExit = false
  /** Replacement alone owns this provisional candidate result and old-unit retry decision. */
  let result: IAttemptOutcome<TSpec, THandle, TExit, TContext>
  try {
    result = await new LaunchAttempt(
      context,
      LaunchCause.replace,
      nextSpec,
      strategy === ReplaceStrategy.stopThenStart
    ).run()
  } finally {
    context.replacementInProgress = false
  }
  if (result.rejection || result.error || !result.slot) {
    if (context.active === undefined && strategy === ReplaceStrategy.startThenSwitch) {
      if (context.replacementOldFailure !== undefined) {
        if (
          context.restartMode === RestartMode.never ||
          context.failures.length > context.maxRestarts
        )
          enterTerminal(context, context.replacementOldFailure)
        else scheduleBackoff(context, restartDelay(context))
      } else if (context.replacementOldNormalExit) {
        if (context.restartMode === RestartMode.always)
          scheduleBackoff(context, context.initialDelayMs)
        else transition(context, SupervisorState.stopped)
      }
    }
    return result.rejection
      ? { kind: OutcomeKind.rejected, reason: result.rejection }
      : { kind: OutcomeKind.failed, error: result.error }
  }
  context.spec = nextSpec
  if (
    context.degraded.length !== nextDegraded.length ||
    !sameDegraded(context.degraded, nextDegraded)
  ) {
    context.degraded = nextDegraded
    emit(context, {
      type: SupervisorEventType.degraded,
      generation: result.slot.generation,
      degraded: context.degraded,
      observedAt: context.scheduler.now()
    })
  }
  if (strategy === ReplaceStrategy.startThenSwitch) {
    context.executionGeneration = result.slot.executionGeneration
    context.active = result.slot
    context.candidate = undefined
    emit(context, {
      type: SupervisorEventType.switched,
      from: previous.generation,
      to: result.slot.generation,
      unit: result.slot.handle!
    })
    transition(context, SupervisorState.ready)
    await retire(context, previous, UnitStopMode.stop)
  }
  return { kind: OutcomeKind.replaced, generation: result.slot.generation }
}
