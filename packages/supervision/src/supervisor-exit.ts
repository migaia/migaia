/** Owns native exit classification and old-unit failures observed during a replacement. */
import type { ISupervisorContext } from './supervisor-context.ts'
import type { ILaunchContext, IUnitHandle } from './types.ts'
import {
  ExitReason,
  UnitStopMode,
  RestartMode,
  SupervisorState,
  SupervisorEventType
} from './constants.ts'
import { createSupervisionError } from './errors.ts'
import { SupervisionErrorCode } from './error-code.ts'
import { SupervisionErrorText } from './error-text.ts'
import { emit, publishExit, transition } from './supervisor-events.ts'
import { trimFailures, scheduleBackoff, onFailure } from './supervisor-policy.ts'
import { retire, type IManagedSlot } from './supervisor-slot.ts'
/** Retains old-unit failure while the pending replacement owns the next restart decision. */
export function retireReplacingActive<
  TSpec,
  THandle extends IUnitHandle<TExit>,
  TExit,
  TContext extends ILaunchContext
>(
  context: ISupervisorContext<TSpec, THandle, TExit, TContext>,
  slot: IManagedSlot<TSpec, THandle, TExit, TContext>,
  reason: NonNullable<IManagedSlot<TSpec, THandle, TExit, TContext>['failureReason']>,
  error: Error
): boolean {
  if (!context.replacementInProgress || context.active !== slot || slot.retired) return false
  context.active = undefined
  trimFailures(context)
  context.failures.append(context.scheduler.now())
  context.replacementOldFailure = error
  void retire(context, slot, UnitStopMode.force, reason, error)
  return true
}

/** Captures actual disappearance, classifies it once and routes policy through the owning slot. */
export function onExit<
  TSpec,
  THandle extends IUnitHandle<TExit>,
  TExit,
  TContext extends ILaunchContext
>(
  context: ISupervisorContext<TSpec, THandle, TExit, TContext>,
  slot: IManagedSlot<TSpec, THandle, TExit, TContext>,
  status: TExit
): void {
  slot.markGone()
  slot.exitObservedAt = context.scheduler.now()
  try {
    slot.exitStatus = context.options.profile.exitStatus?.(status)
  } catch (error) {
    context.options.report(error)
  }
  if (slot.abandoned) {
    /** The deadline retained the lease; now the original native promise supplies real exit. */
    const error =
      context.lastExit?.generation === slot.generation ? context.lastExit.error : undefined
    if (context.lastExit?.generation === slot.generation)
      context.lastExit = {
        ...context.lastExit,
        ...(slot.exitStatus ? { status: slot.exitStatus } : {}),
        observedAt: slot.exitObservedAt
      }
    emit(context, {
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
    /** Requested retirement keeps its explicit failure; ordinary stop derives graceful/force facts. */
    const reason =
      slot.failureReason ??
      (slot.forceIssued && (slot.profile.gracefulTermination || !slot.drained)
        ? ExitReason.killed
        : ExitReason.stopped)
    publishExit(context, slot, reason, slot.failureError)
    return
  }
  if (context.candidate === slot || context.active !== slot) {
    /** Candidate exit before readiness is always a launch failure, retaining the native cause. */
    const classification = context.options.profile.classifyExit(status)
    /** A coded native Error preserves the profile's original cause and detail. */
    const error = createSupervisionError(
      Error,
      SupervisionErrorCode.exitUnexpected,
      SupervisionErrorText.exitUnexpected,
      {
        cause: classification.cause,
        detail: { kind: context.options.profile.kind, ...classification.detail }
      }
    )
    publishExit(context, slot, ExitReason.crashed, error)
    void retire(context, slot, UnitStopMode.force, ExitReason.launchFailed, error)
    return
  }
  /** Serving exits use the canonical profile once, independent of current attempt authority. */
  const classification = context.options.profile.classifyExit(status)
  /** Clean exit differs from restart-worthy failures without introducing an error code for state. */
  const reason = classification.reason
  /** A clean exit has no error; all failures retain the profile's original cause and details. */
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
            detail: { kind: context.options.profile.kind, ...classification.detail }
          }
        )
  publishExit(context, slot, reason, error)
  if (context.active !== slot) return
  context.active = undefined
  void retire(context, slot, UnitStopMode.force)
  if (context.replacementInProgress) {
    if (reason === ExitReason.exited) context.replacementOldNormalExit = true
    else {
      trimFailures(context)
      context.failures.append(context.scheduler.now())
      context.replacementOldFailure = error
    }
    return
  }
  if (reason === ExitReason.exited) {
    if (context.restartMode === RestartMode.always) scheduleBackoff(context, context.initialDelayMs)
    else transition(context, SupervisorState.stopped)
  } else onFailure(context, error)
}
