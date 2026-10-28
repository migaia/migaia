/**
 * Publishes the idempotency flow, bounded store factory and outcome-query contracts. Native setup
 * creates the actual lookup/store installation; transport readiness, invocation fingerprints and
 * business execution remain with their respective existing owners.
 */
import { defineBuiltinFlowFeature } from '../../sdk/flow-feature.ts'
import type { IRpcFlowFeature } from '../../sdk/types.ts'
import { RpcIdempotencyFlow } from './flow.ts'
import { RpcIdempotencyPluginName } from './constants.ts'
import type { IRpcIdempotencyOptions, IRpcOutcomeLookup } from './types.ts'

export { createRpcIdempotencyStore } from './store.ts'
export type {
  IRpcIdempotencyClaim,
  IRpcIdempotencyLookup,
  IRpcIdempotencyOutcome,
  IRpcIdempotencyStore,
  IRpcIdempotencyStoreOptions
} from './store.ts'
export type { IRpcIdempotencyOptions, IRpcOutcomeLookup } from './types.ts'

/** Install the single claim/seal/query owner with body fingerprints in the object's own key order. */
export function idempotencyFeature(
  options: IRpcIdempotencyOptions = {}
): IRpcFlowFeature<Readonly<{ outcome: IRpcOutcomeLookup }>> {
  /** Original store and scope capabilities are retained, rather than copied into host configuration. */
  const captured = { ...options }
  return defineBuiltinFlowFeature('idempotency', {
    name: RpcIdempotencyPluginName,
    setup: (context) => new RpcIdempotencyFlow(captured, context).value
  })
}

export default idempotencyFeature
