/**
 * Owns reverse subscription edges and their notification-entry snapshots. The tracker owns
 * dependency collection and topology tokens; this module owns edge lifecycle hooks and trace
 * order.
 */
import type { IObservable, IObserver, IRuntime } from './types.ts'
import { internalsOf, type IRuntimeInternals } from './internals.ts'
import { assertReactiveOwnedBy } from './ownership.ts'
import { describeObservable, describeObserver, emitTraceSafely } from './diagnostics.ts'
import {
  ReactiveNodeKind,
  ReactiveErrorPhase,
  ReactiveTracePhase,
  ReactiveTraceReason,
  ReactiveTraceType
} from './trace-constants.ts'
import {
  mutableSubs,
  mutableDeps,
  mutableDepVersions,
  snapshotSubs,
  invalidateSubsSnapshot
} from './node-internals.ts'

/** Preserves notification-entry membership when extension callbacks reconnect during marking. */
export function markSubscribers(observable: IObservable): void {
  for (const subscriber of snapshotSubs(observable, observable.subs)) subscriber.markDirty()
}

/** Emits edge diagnostics at the caller's mutation point without changing graph control flow. */
function traceDependency(
  runtime: IRuntimeInternals,
  observable: IObservable,
  observer: IObserver,
  phase: typeof ReactiveTracePhase.connect | typeof ReactiveTracePhase.disconnect,
  reason?:
    | typeof ReactiveTraceReason.retrack
    | typeof ReactiveTraceReason.invalidate
    | typeof ReactiveTraceReason.dispose
): void {
  emitTraceSafely(
    {
      timestamp: runtime.timestamp,
      emitTrace: runtime.emitTrace,
      reportError: (error) =>
        observer.runtime.reportError(error, {
          phase: ReactiveErrorPhase.traceListener,
          observer,
          observable
        })
    },
    (timestamp) => ({
      type: ReactiveTraceType.dependency,
      timestamp,
      phase,
      observable: describeObservable(observable),
      observer: describeObserver(observer),
      ...(reason === undefined ? {} : { reason })
    })
  )
}

/** Installs one owned reverse edge in O(1), then preserves first-observed and trace ordering. */
export function subscribeObservable(
  runtimeOwner: IRuntime,
  observable: IObservable,
  observer: IObserver
): void {
  assertReactiveOwnedBy(observable, runtimeOwner, ReactiveNodeKind.observable)
  assertReactiveOwnedBy(observer, runtimeOwner, ReactiveNodeKind.observer)
  /** Host services are resolved before any user lifecycle hook can run. */
  const runtime = internalsOf(runtimeOwner)
  /** The canonical Set supplies both membership admission and the previous observation state. */
  const subscribers = mutableSubs(observable, observable.subs)
  /** First observation alone admits the observable's resource-acquisition hook. */
  const wasUnobserved = subscribers.size === 0
  subscribers.add(observer)
  invalidateSubsSnapshot(observable)
  if (wasUnobserved) {
    try {
      observable.onObserved?.()
    } catch (error) {
      observer.runtime.reportError(error, {
        phase: ReactiveErrorPhase.lifecycleHook,
        observer: describeObserver(observer),
        observable: describeObservable(observable)
      })
    }
  }
  if (runtime.traceEnabled())
    traceDependency(runtime, observable, observer, ReactiveTracePhase.connect)
}

/** Removes one reverse edge in O(1); trace emission precedes the last-unobserved hook. */
export function unsubscribeObservable(
  runtimeOwner: IRuntime,
  observable: IObservable,
  observer: IObserver
): void {
  assertReactiveOwnedBy(observable, runtimeOwner, ReactiveNodeKind.observable)
  /** Deletion invalidates the cached snapshot before any user hook or trace listener runs. */
  const subscribers = mutableSubs(observable, observable.subs)
  if (!subscribers.delete(observer)) return
  invalidateSubsSnapshot(observable)
  /** Missing subscriptions return before consulting the owning runtime's trace services. */
  const runtime = internalsOf(runtimeOwner)
  if (runtime.traceEnabled())
    traceDependency(
      runtime,
      observable,
      observer,
      ReactiveTracePhase.disconnect,
      ReactiveTraceReason.retrack
    )
  if (subscribers.size === 0) {
    try {
      observable.onUnobserved?.()
    } catch (error) {
      observer.runtime.reportError(error, {
        phase: ReactiveErrorPhase.lifecycleHook,
        observer: describeObserver(observer),
        observable: describeObservable(observable)
      })
    }
  }
}

/**
 * Detaches an observable's entry subscribers in O(n). Every forward edge disappears before any
 * disconnect callback runs; callbacks retain the original insertion-order snapshot.
 */
export function disconnectSubscribers(
  runtime: IRuntimeInternals,
  observable: IObservable,
  reason: typeof ReactiveTraceReason.invalidate | typeof ReactiveTraceReason.dispose
): void {
  /** This snapshot survives trace listeners and disconnect callbacks that reconnect graph nodes. */
  const observers = [...mutableSubs(observable, observable.subs)]
  invalidateSubsSnapshot(observable)
  mutableSubs(observable, observable.subs).clear()
  for (const observer of observers) {
    mutableDeps(observer, observer.deps).delete(observable)
    mutableDepVersions(observer, observer.depVersions).delete(observable)
    if (runtime.traceEnabled())
      traceDependency(runtime, observable, observer, ReactiveTracePhase.disconnect, reason)
  }
  for (const observer of observers) {
    try {
      observer.onDependencyDisconnected(observable)
    } catch (error) {
      observer.runtime.reportError(error, {
        phase: ReactiveErrorPhase.dependencyDisconnect,
        observer: describeObserver(observer),
        observable: describeObservable(observable)
      })
    }
  }
}
