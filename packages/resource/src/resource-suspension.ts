/**
 * Idle suspension ownership; observation epochs invalidate obsolete callbacks without another
 * scheduler.
 */
import { LifecycleState } from '@migaia/lifecycle'
import type { IResourceContext } from './resource-context.ts'

/** Schedules the existing graph suspension lane only when unobserved suspension is enabled. */
export function scheduleResourceSuspension<T>(context: IResourceContext<T>): void {
  if (context.keepAlive || context.terminal.lifecycle !== LifecycleState.open) return
  /** Captured observation epoch prevents an old idle callback from detaching newer observers. */
  const generation = ++context.suspensionGeneration
  context.tracking.deferIdle(() => suspendResource(context, generation))
}

/** Retains dependency versions while detaching edges after the last observer leaves. */
function suspendResource<T>(context: IResourceContext<T>, generation: number): void {
  if (
    context.terminal.lifecycle !== LifecycleState.open ||
    context.keepAlive ||
    context.stateSignal.subs.size > 0 ||
    generation !== context.suspensionGeneration
  )
    return
  context.tracking.suspend()
}
