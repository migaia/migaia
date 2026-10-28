/** Dependency freshness and coalesced refresh; all graph edges and idle scheduling stay in reactive. */
import { LifecycleState } from '@migaia/lifecycle'
import type { IResourceContext } from './resource-context.ts'
import { ResourceStatus } from './state-constants.ts'
import { resourceIsFresh, recordPassiveSchedulerFailure } from './resource-cache.ts'
import { observeResourcePromise, startResourceRequest } from './resource-request.ts'
import { scheduleResourceSuspension } from './resource-suspension.ts'

/** Installs observation hooks with only graph state in their shared lexical environment. */
export function attachResourceObservationHooks<T>(context: IResourceContext<T>): void {
  context.stateSignal.addObservedHooks({
    onObserved: () => {
      context.suspensionGeneration++
    },
    onUnobserved: () => {
      // Suspended renders have not committed a subscription yet. Aborting
      // here would reject the exact Promise React is waiting for.
      scheduleResourceSuspension(context)
    }
  })
}

/** Revalidates suspended dependencies and starts only the existing idle/stale passive paths. */
export function ensureResourceFresh<T>(context: IResourceContext<T>): void {
  if (context.requestPending || context.paused) return
  /** Passive errors and cancellation remain stable until explicit restart. */
  const state = context.stateSignal.peek()
  /** Dependency invalidation is independent of time expiration. */
  let dependencyChanged = false
  if (state.status === ResourceStatus.success) {
    /** Tracker owns the saved dependency versions and any edge reattachment. */
    const tracker = context.tracking
    if (tracker.isSuspended()) {
      if (tracker.revalidate()) scheduleResourceSuspension(context)
      else {
        context.expiresAt = 0
        dependencyChanged = true
      }
    }
  }
  /** Freshness is sampled only for success state, after dependency revalidation. */
  let fresh = true
  if (state.status === ResourceStatus.success) {
    try {
      fresh = resourceIsFresh(context) && !dependencyChanged
    } catch (error) {
      recordPassiveSchedulerFailure(context, error)
      return
    }
  }
  if (state.status === ResourceStatus.idle || (state.status === ResourceStatus.success && !fresh))
    observeResourcePromise(startResourceRequest(context))
}

/** Coalesces invalidations on the existing reactive idle lane rather than a private microtask. */
export function scheduleResourceDependencyRefresh<T>(
  context: IResourceContext<T>,
  force: boolean
): void {
  if (context.terminal.lifecycle !== LifecycleState.open) return
  context.forceRefresh ||= force
  if (context.refreshScheduled) return
  context.refreshScheduled = true
  context.tracking.deferIdle(() => refreshResourceDependencies(context))
}

/** Executes one admitted idle refresh and contains its synchronous public-state failure. */
function refreshResourceDependencies<T>(context: IResourceContext<T>): void {
  if (!context.refreshScheduled || context.terminal.lifecycle !== LifecycleState.open) return
  context.refreshScheduled = false
  /** A disconnected dependency forces refresh even if no retained version changed. */
  const mustRefresh = context.forceRefresh
  context.forceRefresh = false
  try {
    if (!mustRefresh && !context.tracking.hasStaleDependencies()) return
    observeResourcePromise(startResourceRequest(context))
  } catch (error) {
    context.requestPending = false
    context.expiresAt = 0
    context.stateSignal.value = { status: ResourceStatus.error, error }
  }
}
