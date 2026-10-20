// @ts-expect-error use the canonical ICapabilityState name.
import type { ICapabilityStateValue } from '../src/index.js'
// @ts-expect-error use GraphReadinessState's value/type namespace.
import type { IGraphReadinessState } from '../src/index.js'
// @ts-expect-error use GraphBindingReleaseReason's value/type namespace.
import type { IGraphBindingReleaseReason } from '../src/graph/dynamic.js'
import type { ICapabilityState, GraphReadinessState } from '../src/index.js'
import type { GraphBindingReleaseReason } from '../src/graph/dynamic.js'

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
