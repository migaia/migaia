/** Supply complete strategies through the existing native policy installation owner. */
import type { IRpcCallFeature } from '@migaia/rpc-contract/interfaces'
import { defineLinkPolicy } from '../../sdk/define.ts'
import type { IRpcFlowPlugin } from '../../sdk/types.ts'
import type { IFeatureOutputs } from '@migaia/plugin-host'

/** Stable native identity lets ordinary installation reject conflicting chain defaults. */
export const RpcLinkPolicyName = 'rpc-link-policy'

/** Only complete timeout/retry instances contribute behavior; omission enables no strategy. */
export type IRpcLinkPolicyOptions<
  F extends Readonly<Record<string, IRpcCallFeature>> = Readonly<Record<string, IRpcCallFeature>>
> = Readonly<{
  features: F
}>

/** Publish defaults without another flow stage or a copy of either strategy algorithm. */
export function linkPolicy<const F extends Readonly<Record<string, IRpcCallFeature>>>(
  options: IRpcLinkPolicyOptions<F>
): IRpcFlowPlugin<Readonly<{ features: IFeatureOutputs<F> }>> {
  return defineLinkPolicy({ name: RpcLinkPolicyName, features: options.features })
}

export default linkPolicy
