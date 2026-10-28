import { createEventChannel } from '../src/index.ts'
import type { IEventProjectionPlan } from '../src/value-projection.ts'

/** Internal Hub projection plans must not become public factory parameters. */
declare const plan: IEventProjectionPlan
// @ts-expect-error public callers configure valueConfig, never an internal parsed plan.
createEventChannel<number>({}, plan)
