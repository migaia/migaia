/** Attach trusted cold launch facts to the original native context without wrapping its identity. */
import type { IRpcGeneration } from '@migaia/rpc-contract/protocol'

/** Native owners supply only actual parent identity and the original reserved execution ordinal. */
export type IRpcLaunchFacts = Readonly<{
  parent: Readonly<{ name: string; instanceId: string }>
  generation: IRpcGeneration
  /** The source's selected registration name supplies the native child bootstrap label. */
  childName?: string
}>

/** Exact launch requests carry metadata only until their original native acquisition settles. */
const launchFacts = new WeakMap<object, IRpcLaunchFacts>()

/** Original native launchers read their real request; copied contexts carry no attached facts. */
export function readRpcLaunchFacts(context: object): IRpcLaunchFacts | undefined {
  return launchFacts.get(context)
}

/** Preserve the original context, Promise result and failure while releasing this metadata receipt. */
export async function withRpcLaunchFacts<T>(
  context: object,
  facts: IRpcLaunchFacts,
  launch: () => Promise<T>
): Promise<T> {
  /** Nested original launcher forwarding restores the enclosing acquisition's exact facts. */
  const previous = launchFacts.get(context)
  launchFacts.set(context, facts)
  try {
    return await launch()
  } finally {
    if (previous) launchFacts.set(context, previous)
    else launchFacts.delete(context)
  }
}
