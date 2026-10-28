// @ts-expect-error use the canonical ICapabilityState name.
import type { ICapabilityStateValue } from '../src/index.ts'
// @ts-expect-error use GraphReadinessState's value/type namespace.
import type { IGraphReadinessState } from '../src/index.ts'
// @ts-expect-error use GraphBindingReleaseReason's value/type namespace.
import type { IGraphBindingReleaseReason } from '../src/graph/dynamic.ts'
import type { ICapabilityState, GraphReadinessState } from '../src/index.ts'
import type { GraphBindingReleaseReason } from '../src/graph/dynamic.ts'

/** Former names are intentionally unavailable from their old package projections. */
export type IRetiredAuditTypes = [
  ICapabilityStateValue,
  IGraphReadinessState,
  IGraphBindingReleaseReason
]
/** Canonical domains continue to express exactly the same supported states and reasons. */
const states: [ICapabilityState, GraphReadinessState, GraphBindingReleaseReason] = [
  'off',
  'ready',
  'dispose'
]
void states
