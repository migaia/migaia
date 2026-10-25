/**
 * Publishes the idempotency flow, bounded store factory and outcome-query contracts. Native setup
 * creates the actual lookup/store installation; transport readiness, invocation fingerprints and
 * business execution remain with their respective existing owners.
 */
import { defineBuiltinFlowFeature } from '../../sdk/flow-feature.js'
import type { IRpcFlowFeature } from '../../sdk/types.js'
import { RpcIdempotencyFlow } from './flow.js'
import { RpcIdempotencyPluginName } from './constants.js'
import type { IRpcIdempotencyOptions, IRpcOutcomeLookup } from './types.js'

export { createRpcIdempotencyStore } from './store.js'
export type {
  IRpcIdempotencyClaim,
  IRpcIdempotencyLookup,
  IRpcIdempotencyOutcome,
  IRpcIdempotencyStore,
  IRpcIdempotencyStoreOptions
} from './store.js'
export type { IRpcIdempotencyOptions, IRpcOutcomeLookup } from './types.js'

/** Install the single claim/seal/query owner with body fingerprints in the object's own key order. */
export function idempotency<const N extends string = string>(
  options: IRpcIdempotencyOptions & Readonly<{ namespaces?: readonly N[] }> = {}
): IRpcFlowFeature<Readonly<{ outcome: IRpcOutcomeLookup }>, N> {
  /** Original store and scope capabilities are retained, rather than copied into host configuration. */
  const captured = { ...options }
  return defineBuiltinFlowFeature('idempotency', {
    name: RpcIdempotencyPluginName,
    namespaces: captured.namespaces,
    setup: (context) => new RpcIdempotencyFlow(captured, context).value
  })
}

export default idempotency
