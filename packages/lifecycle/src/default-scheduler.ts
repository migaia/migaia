import { systemScheduler, type IScheduler } from '@migaia/utils/scheduler'
import { resolveScheduler } from './scheduler.js'

/**
 * The package default scheduler: the utils system scheduler admitted once at module load (LC-P2),
 * not re-snapshotted on every `boundedWait`, graceful race, generation controller and mutation
 * queue. Admission and per-call validation stay identical to an injected scheduler, so delay and
 * time errors keep their lifecycle `INVALID_OPTION` identity. Internal to the package.
 */
export const defaultLifecycleScheduler: IScheduler = resolveScheduler(systemScheduler)
