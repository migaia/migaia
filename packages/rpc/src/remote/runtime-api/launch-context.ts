import type { IRuntimePeerSourceContext } from './peer.js'

/** A supervised process has its existing local unit label in addition to the parent's safe offer. */
type IRuntimeLaunchContext = IRuntimePeerSourceContext & Readonly<{ childName?: string }>

/**
 * Exact original launch-request identity carries only cold bootstrap metadata, never lifetime
 * state.
 */
const runtimeLaunchContexts = new WeakMap<object, IRuntimeLaunchContext>()

/** Platform deep adapters read only metadata attached to this genuine supervisor launch request. */
export function readRuntimeLaunchContext(context: object): IRuntimeLaunchContext | undefined {
  return runtimeLaunchContexts.get(context)
}

/**
 * A caller-selected original launcher keeps its context and behavior while bootstrap learns the
 * offer.
 */
export async function withRuntimeLaunchContext<T>(
  context: object,
  runtime: IRuntimeLaunchContext,
  launch: () => Promise<T>
): Promise<T> {
  runtimeLaunchContexts.set(context, runtime)
  try {
    return await launch()
  } finally {
    runtimeLaunchContexts.delete(context)
  }
}
