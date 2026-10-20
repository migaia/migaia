import { createEventChannel } from '../src/index.js'
import type { IEventProjectionPlan } from '../src/value-projection.js'

/** Internal Hub projection plans must not become public factory parameters. */
declare const plan: IEventProjectionPlan
// @ts-expect-error public callers configure valueConfig, never an internal parsed plan.
createEventChannel<number>({}, plan)
