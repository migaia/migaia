/** Owns the failure window, bounded backoff, terminal exhaustion and optional cooldown. */
import type { ISupervisorContext } from './supervisor-context.js'
import type { ILaunchContext, IUnitHandle } from './types.js'
import { LifecycleState } from '@migaia/lifecycle'
import {
  TerminalPolicyMode,
  SupervisorState,
  SupervisorEventType,
  LaunchCause,
  RestartMode,
  type BudgetRejection
} from './constants.js'
import { createSupervisionError } from './errors.js'
import { SupervisionErrorCode } from './error-code.js'
import { SupervisionErrorText } from './error-text.js'
import { emit, transition } from './supervisor-events.js'
/** Cancels and removes only this supervisor's automatic retry timers. */
export function clearTimers<
  TSpec,
  THandle extends IUnitHandle<TExit>,
  TExit,
  TContext extends ILaunchContext
>(context: ISupervisorContext<TSpec, THandle, TExit, TContext>): void {
  context.backoffTimer?.cancel()
  context.backoffTimer = undefined
  context.cooldownTimer?.cancel()
  context.cooldownTimer = undefined
}

/** Removes expired timestamps before delay, exhaustion or inspection reads the failure count. */
export function trimFailures<
  TSpec,
  THandle extends IUnitHandle<TExit>,
  TExit,
  TContext extends ILaunchContext
>(context: ISupervisorContext<TSpec, THandle, TExit, TContext>): void {
  return context.failures.trim(context.scheduler.now(), context.windowMs)
}

/** Both failure sites derive delay from the same already-trimmed window and configured cap. */
export function restartDelay<
  TSpec,
  THandle extends IUnitHandle<TExit>,
  TExit,
  TContext extends ILaunchContext
>(context: ISupervisorContext<TSpec, THandle, TExit, TContext>): number {
  return Math.min(
    context.maxDelayMs,
    context.initialDelayMs * context.factor ** (context.failures.length - 1)
  )
}

/** Reports one exhausted entry and optionally schedules one unref'd cooldown retry. */
export function enterTerminal<
  TSpec,
  THandle extends IUnitHandle<TExit>,
  TExit,
  TContext extends ILaunchContext
>(
  context: ISupervisorContext<TSpec, THandle, TExit, TContext>,
  lastError: unknown,
  lastRejection?: BudgetRejection
): void {
  if (context.terminal.lifecycle !== LifecycleState.open) return
  clearTimers(context)
  /** Exhaustion retains the original unit failure or budget rejection on its public diagnostic. */
  const error = createSupervisionError(
    Error,
    SupervisionErrorCode.supervisionExhausted,
    SupervisionErrorText.supervisionExhausted,
    {
      cause: lastError,
      detail: {
        kind: context.options.profile.kind,
        failures: context.failures.length,
        maxRestarts: context.maxRestarts,
        windowMs: context.windowMs,
        ...(lastRejection === undefined ? {} : { lastRejection })
      }
    }
  )
  context.terminalError = error
  context.terminalEntries++
  transition(context, SupervisorState.terminal)
  emit(context, { type: SupervisorEventType.terminal, error, entry: context.terminalEntries })
  context.options.report(error)
  if (
    context.terminal.lifecycle === LifecycleState.open &&
    context.options.terminalPolicy?.mode === TerminalPolicyMode.cooldown
  ) {
    context.cooldownTimer = context.scheduler.schedule(() => {
      context.cooldownTimer = undefined
      if (
        context.terminal.lifecycle !== LifecycleState.open ||
        context.state !== SupervisorState.terminal
      )
        return
      context.failures.clear()
      void context.launch(LaunchCause.cooldown)
    }, context.options.terminalPolicy.afterMs)
    context.cooldownTimer.unref?.()
  }
}

/** Schedules a retry only while the original command lifecycle remains open. */
export function scheduleBackoff<
  TSpec,
  THandle extends IUnitHandle<TExit>,
  TExit,
  TContext extends ILaunchContext
>(context: ISupervisorContext<TSpec, THandle, TExit, TContext>, delayMs: number): void {
  if (context.terminal.lifecycle !== LifecycleState.open) return
  transition(context, SupervisorState.backoff)
  context.backoffTimer = context.scheduler.schedule(() => {
    context.backoffTimer = undefined
    if (
      context.terminal.lifecycle !== LifecycleState.open ||
      context.state !== SupervisorState.backoff
    )
      return
    void context.launch(LaunchCause.backoff)
  }, delayMs)
}

/** Records one failed attempt or active unit and applies the original exhaustion boundary. */
export function onFailure<
  TSpec,
  THandle extends IUnitHandle<TExit>,
  TExit,
  TContext extends ILaunchContext
>(
  context: ISupervisorContext<TSpec, THandle, TExit, TContext>,
  error: unknown,
  lastRejection?: BudgetRejection
): void {
  if (context.terminal.lifecycle !== LifecycleState.open) return
  trimFailures(context)
  context.failures.append(context.scheduler.now())
  if (context.restartMode === RestartMode.never || context.failures.length > context.maxRestarts) {
    enterTerminal(context, error, lastRejection)
    return
  }
  scheduleBackoff(context, restartDelay(context))
}
