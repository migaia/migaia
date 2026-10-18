/** Runtime scheduler boundary; deterministic test controls belong to the explicit testing entry. */
export { deferTask, systemScheduler, systemWallClock } from './internal/scheduler.js'
export type { IScheduledTask, IScheduler, IWallClock } from './internal/scheduler.js'
