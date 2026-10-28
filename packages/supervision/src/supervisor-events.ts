/** Owns synchronous event snapshots, readiness observations and native exit publication. */
import type { ISupervisorContext } from './supervisor-context.ts'
import type { ILaunchContext, IUnitHandle } from './types.ts'
import { LifecycleState } from '@migaia/lifecycle'
import { inspectThenable, observeThenableRejection } from '@migaia/utils/function'
import {
  SupervisorState,
  SupervisorEventType,
  type SupervisorState as ISupervisorState,
  type ExitReason
} from './constants.ts'
import type { IReadyOutcome, ISupervisorEvent } from './types.ts'
import type { IManagedSlot } from './supervisor-slot.ts'
/** Isolates listener failures while mutations affect only later, including nested, publication. */
export function emit<
  TSpec,
  THandle extends IUnitHandle<TExit>,
  TExit,
  TContext extends ILaunchContext
>(
  context: ISupervisorContext<TSpec, THandle, TExit, TContext>,
  event: ISupervisorEvent<THandle>
): void {
  /** Mutations during callbacks affect only later events, including nested publication. */
  const snapshot = (context.listenerSnapshot ??= Array.from(context.listeners))
  for (const listener of snapshot) {
    try {
      /** Observe only this callback's result; publishing remains synchronous and passive. */
      const result: unknown = listener(event)
      observeThenableRejection(result, inspectThenable(result), context.options.report)
    } catch (error) {
      context.options.report(error)
    }
  }
}

/** Publishes a changed state synchronously, then wakes observers that can now answer readiness. */
export function transition<
  TSpec,
  THandle extends IUnitHandle<TExit>,
  TExit,
  TContext extends ILaunchContext
>(context: ISupervisorContext<TSpec, THandle, TExit, TContext>, next: ISupervisorState): void {
  if (context.state === next) return
  /** State event records the original state even if a listener reenters the supervisor. */
  const from = context.state
  context.state = next
  emit(context, {
    type: SupervisorEventType.state,
    from,
    to: next,
    generation: context.attempts.generation
  })
  for (const wake of context.waiters) wake()
}

/** Answers stable readiness without submitting a command or starting a unit. */
export function readyNow<
  TSpec,
  THandle extends IUnitHandle<TExit>,
  TExit,
  TContext extends ILaunchContext
>(
  context: ISupervisorContext<TSpec, THandle, TExit, TContext>
): IReadyOutcome<THandle> | undefined {
  if (
    context.terminal.lifecycle !== LifecycleState.open ||
    context.state === SupervisorState.disposed
  )
    return { state: SupervisorState.disposed }
  if (context.state === SupervisorState.ready && context.active?.handle)
    return {
      state: SupervisorState.ready,
      generation: context.active.generation,
      unit: context.active.handle
    }
  if (context.state === SupervisorState.idle) return { state: SupervisorState.idle }
  if (context.state === SupervisorState.stopped) return { state: SupervisorState.stopped }
  if (context.state === SupervisorState.terminal) return { state: SupervisorState.terminal }
  return undefined
}

/** Records one classification; only actual exited fulfillment publishes a native exit event. */
export function publishExit<
  TSpec,
  THandle extends IUnitHandle<TExit>,
  TExit,
  TContext extends ILaunchContext
>(
  context: ISupervisorContext<TSpec, THandle, TExit, TContext>,
  slot: IManagedSlot<TSpec, THandle, TExit, TContext>,
  reason: (typeof ExitReason)[keyof typeof ExitReason],
  error?: unknown
): void {
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
  if (!context.lastExit || context.lastExit.generation <= slot.generation)
    context.lastExit = observation
  if (slot.exitObservedAt !== undefined)
    emit(context, {
      type: SupervisorEventType.exit,
      generation: slot.generation,
      reason,
      ...(error === undefined ? {} : { error }),
      ...(slot.exitStatus ? { status: slot.exitStatus } : {}),
      ...(slot.exitObservedAt === undefined ? {} : { observedAt: slot.exitObservedAt })
    })
}
