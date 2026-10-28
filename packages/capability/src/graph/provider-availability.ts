/** Owns required-provider availability scans shared by static and dynamic graph startup. */
import { CapabilityGraphNodeState, type ICapabilityGraphNodeState } from './state-constants.ts'

/** Finds the first unavailable required edge in declaration order, inspecting each edge once. */
export function unavailableRequiredProvider(
  dependencies: readonly { readonly provider: string; readonly required: boolean }[],
  nodes: ReadonlyMap<string, { readonly state: ICapabilityGraphNodeState }>,
  available?: ReadonlySet<string>
): string | undefined {
  for (const edge of dependencies)
    if (
      edge.required &&
      !available?.has(edge.provider) &&
      nodes.get(edge.provider)?.state !== CapabilityGraphNodeState.ready
    )
      return edge.provider
  return undefined
}
