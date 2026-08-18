import type { ILifecycleScheduler } from '@migaia/lifecycle';

/** Opaque identity token representing one injected scheduler time domain. */
type ISchedulerDomainToken = object;

/** Keeps source objects mapped to their stable logger time-domain token without strong ownership. */
const sourceDomains = new WeakMap<object, ISchedulerDomainToken>();
/** Keeps lifecycle snapshots mapped to the source token consumed by ProcessPlugin admission. */
const snapshotDomains = new WeakMap<object, ISchedulerDomainToken>();

/**
 * Associates a lifecycle snapshot with the identity of its injected scheduler source. Separate
 * snapshots from one source therefore remain in one time domain without retaining the source
 * through a strong reference.
 */
export function registerLoggerSchedulerDomain(
  source: object,
  snapshot: ILifecycleScheduler
): ILifecycleScheduler {
  /** Reuses source or snapshot identity so repeated lifecycle snapshots share one time domain. */
  const domain = snapshotDomains.get(source) ?? sourceDomains.get(source) ?? {};
  sourceDomains.set(source, domain);
  snapshotDomains.set(snapshot, domain);
  return snapshot;
}

/** Returns the retained time-domain token for a logger scheduler snapshot. */
export function getLoggerSchedulerDomain(scheduler: ILifecycleScheduler): object | undefined {
  return snapshotDomains.get(scheduler);
}
